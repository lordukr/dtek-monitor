require("dotenv").config()
const fs = require("fs")
const path = require("path")
const { getInfo } = require("./lib/dtek")
const {
  sendTelegramMessage,
  editTelegramMessage,
  deleteTelegramMessage,
} = require("./lib/telegram")

const MESSAGE_HISTORY_FILE = path.resolve("artifacts", `message-history.json`)

// Env vars are read lazily so they can be set after the module is loaded (tests)
function getConfig() {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CITY, STREET, HOUSE } =
    process.env
  return { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CITY, STREET, HOUSE }
}

// ---------------------------------------------------------------------------
// Time helpers (Europe/Kyiv)
// ---------------------------------------------------------------------------

const kyivFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Kyiv",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

function getKyivParts(now = new Date()) {
  const parts = {}
  for (const { type, value } of kyivFormatter.formatToParts(now)) {
    parts[type] = value
  }
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour) % 24
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    minutesOfDay: hour * 60 + minute,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  }
}

// Kyiv UTC offset in ms at the given instant (handles DST)
function getKyivOffsetMs(instant) {
  const p = getKyivParts(instant)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

// Unix timestamp (seconds) of today's 00:00 in Kyiv
function getKyivMidnightTimestamp(now = new Date()) {
  const { year, month, day } = getKyivParts(now)
  const utcMidnight = Date.UTC(year, month - 1, day)
  let guess = utcMidnight - getKyivOffsetMs(now)
  // Re-evaluate offset at the guess in case a DST switch happened between
  guess = utcMidnight - getKyivOffsetMs(new Date(guess))
  return Math.floor(guess / 1000)
}

// "HH:MM" in Kyiv
function formatKyivTime(now = new Date()) {
  const { hour, minute } = getKyivParts(now)
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

function formatKyivTimestamp(now = new Date()) {
  const time = now.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  })
  const date = now.toLocaleDateString("uk-UA", {
    timeZone: "Europe/Kyiv",
  })
  return `${time} ${date}`
}

// "HH:MM-HH:MM" -> { start, end } in minutes from midnight ("24:00" allowed)
function parseTimeRange(timeRange) {
  const [startTime, endTime] = timeRange.split("-")
  const [startHour, startMin] = startTime.split(":").map(Number)
  const [endHour, endMin] = endTime.split(":").map(Number)
  return {
    start: startHour * 60 + startMin,
    end: endHour * 60 + endMin,
  }
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0 && minutes > 0) {
    return `${hours} год ${minutes} хв`
  } else if (hours > 0) {
    return `${hours} год`
  } else {
    return `${minutes} хв`
  }
}

function calculateOutageDuration(timeRange) {
  // Parse time range like "18:30-21:00" and calculate duration
  const { start, end } = parseTimeRange(timeRange)
  return formatDuration(end - start)
}

// Parse "07:55 20.01.2026" into a Date (wall clock, no timezone)
function parseEmergencyDate(dateStr) {
  const [time, date] = dateStr.split(" ")
  const [hours, minutes] = time.split(":").map(Number)
  const [day, month, year] = date.split(".").map(Number)
  const parsed = new Date(year, month - 1, day, hours, minutes)
  if (Number.isNaN(parsed.getTime())) throw Error("Invalid date")
  return parsed
}

// Returns { duration, isActiveNow } for an emergency outage ("" / false if unknown)
function getEmergencyTiming(start_date, end_date, now = new Date()) {
  const result = { duration: "", isActiveNow: false }
  if (!start_date || !end_date) return result

  try {
    const startTime = parseEmergencyDate(start_date)
    const endTime = parseEmergencyDate(end_date)
    // Kyiv wall clock expressed as a local Date, comparable to the parsed dates
    const kyivTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })
    )
    result.isActiveNow = kyivTime >= startTime && kyivTime < endTime
    result.duration = formatDuration(
      Math.floor((endTime - startTime) / (1000 * 60))
    )
  } catch (error) {
    // If parsing fails, just skip duration calculation
  }
  return result
}

// ---------------------------------------------------------------------------
// Outage detection
// ---------------------------------------------------------------------------

function checkOutage(info, { house = getConfig().HOUSE, now = new Date() } = {}) {
  console.log("🌀 Checking power outage...")

  if (!info?.data) {
    throw Error("❌ Power outage info missed.")
  }

  const houseData = info?.data?.[house] || {}
  const { sub_type, start_date, end_date, type, sub_type_reason } = houseData

  // Check if this is an emergency outage
  // Emergency indicators: "Екстренні відключення", "Аварійне", "без застосування графіку"
  const isEmergencyOutageText = !!(
    sub_type &&
    (sub_type.includes("Екстренні відключення") ||
      sub_type.includes("екстренн") ||
      sub_type.includes("Аварійне") ||
      sub_type.includes("аварійн") ||
      sub_type.includes("без застосування графіку"))
  )

  // Check if this is a scheduled/stabilization outage (not emergency)
  // "Стабілізаційне відключення (Згідно графіку..." = scheduled
  const isScheduledOutageText = !!(
    !isEmergencyOutageText &&
    sub_type &&
    (sub_type.includes("Стабілізаційне відключення") ||
      sub_type.includes("стабілізаційн") ||
      (sub_type.includes("Згідно графіку погодинних") &&
        !sub_type.includes("без застосування")) ||
      sub_type.includes("According to"))
  )

  let hasEmergencyOutage
  if (isEmergencyOutageText) {
    hasEmergencyOutage = true
  } else if (isScheduledOutageText) {
    hasEmergencyOutage = false
  } else if (sub_type) {
    // Unrecognized sub_type wording: only treat as emergency if there is a
    // concrete outage window, and warn so wording changes get noticed
    console.warn(`⚠️ Unrecognized sub_type: "${sub_type}"`)
    hasEmergencyOutage = !!(start_date || end_date)
  } else {
    // No sub_type text: emergency if other fields are populated
    hasEmergencyOutage = !!(start_date || end_date || type)
  }

  // Check for system-wide emergency from popup
  const hasSystemWideEmergency = info.hasSystemWideEmergency || false

  let emergencyOutage = null
  if (hasEmergencyOutage) {
    console.log("🚨 Emergency/Active outage detected!")
    emergencyOutage = {
      sub_type,
      start_date,
      end_date,
      type,
    }
  } else if (hasSystemWideEmergency) {
    console.log("🚨 System-wide emergency detected (from popup)!")
    // Create a generic emergency outage object for system-wide emergencies
    emergencyOutage = {
      sub_type: "Екстренні відключення електроенергії (системне повідомлення)",
      start_date: "",
      end_date: "Невідомо",
      type: "system-wide",
      isSystemWide: true,
    }
  } else if (isScheduledOutageText) {
    console.log("📅 Scheduled outage in emergency field (will use schedule data)")
  }

  // Check for scheduled outages
  let nextScheduledOutage = null
  if (info.preset?.data && info.fact?.data && sub_type_reason) {
    nextScheduledOutage = findNextScheduledOutage(info, sub_type_reason, { now })
  }

  const isOutageDetected = emergencyOutage !== null || nextScheduledOutage !== null

  isOutageDetected
    ? console.log("🚨 Power outage detected!")
    : console.log("⚡️ No power outage!")

  return {
    isOutageDetected,
    emergencyOutage,
    nextScheduledOutage,
  }
}

function findNextScheduledOutage(info, sub_type_reason, { now = new Date() } = {}) {
  const queueGroup = sub_type_reason[0] // e.g., "GPV1.2"
  console.log(`🔢 House queue group: ${queueGroup}`)

  // Get current time in Kyiv timezone
  const kyiv = getKyivParts(now)
  const currentTimeInMinutes = kyiv.minutesOfDay

  console.log(
    `⏰ Current Kyiv time: ${String(kyiv.hour).padStart(2, "0")}:${String(kyiv.minute).padStart(2, "0")}`
  )

  // DTEK keys the schedule by Kyiv-midnight unix timestamps.
  // Prefer the API's own "today", otherwise compute Kyiv midnight.
  const candidateKeys = []
  if (info.fact?.today) candidateKeys.push(info.fact.today)
  candidateKeys.push(getKyivMidnightTimestamp(now))

  let todaySchedule
  for (const key of candidateKeys) {
    todaySchedule = info.fact?.data?.[key]?.[queueGroup]
    if (todaySchedule) break
  }

  if (!todaySchedule) {
    console.log(`⚠️ No schedule found for queue ${queueGroup}`)
    return null
  }

  // Parse outage time slots
  const outageSlots = []
  const timeZones = info.preset?.time_zone || {}
  const timeTypes = info.preset?.time_type || {}

  for (let hour = 1; hour <= 24; hour++) {
    const status = todaySchedule[hour.toString()]

    if (
      status === "no" ||
      status === "first" ||
      status === "second" ||
      status === "maybe"
    ) {
      const timeInfo = timeZones[hour.toString()]
      let startTime, endTime

      if (timeInfo) {
        const baseStartTime = timeInfo[1] // e.g., "00:00"
        const baseEndTime = timeInfo[2] // e.g., "01:00"

        if (status === "first") {
          // First 30 minutes
          const [h] = baseStartTime.split(":")
          startTime = `${h}:00`
          endTime = `${h}:30`
        } else if (status === "second") {
          // Second 30 minutes
          const [h] = baseStartTime.split(":")
          startTime = `${h}:30`
          endTime = baseEndTime
        } else {
          // Full hour
          startTime = baseStartTime
          endTime = baseEndTime
        }
      } else {
        // Fallback if timeInfo not available
        const h = hour - 1
        startTime = `${String(h).padStart(2, "0")}:00`
        endTime = `${String(h + 1).padStart(2, "0")}:00`
      }

      const { start: startInMinutes, end: endInMinutes } = parseTimeRange(
        `${startTime}-${endTime}`
      )

      outageSlots.push({
        hour,
        timeRange: `${startTime}-${endTime}`,
        status,
        description: timeTypes[status] || status,
        startInMinutes,
        endInMinutes,
      })
    }
  }

  if (outageSlots.length === 0) {
    console.log("✅ No planned outages for today!")
    return null
  }

  // Merge consecutive outage slots into continuous ranges
  const mergedOutages = []
  let currentRange = null

  const finishRange = (range) => {
    // A merged multi-slot range must not keep the first slot's label
    // (e.g. "Світла не буде другі 30 хв" for 16:30-20:00)
    const merged = range.slotCount > 1
    const { slotCount, ...rest } = range
    mergedOutages.push({
      ...rest,
      ...(merged
        ? {
            status: "no",
            description: timeTypes.no || "Світла не буде",
          }
        : {}),
      timeRange: `${range.startTime}-${range.endTime}`,
    })
  }

  const startRange = (slot) => ({
    startTime: slot.timeRange.split("-")[0],
    endTime: slot.timeRange.split("-")[1],
    startInMinutes: slot.startInMinutes,
    endInMinutes: slot.endInMinutes,
    description: slot.description,
    status: slot.status,
    slotCount: 1,
  })

  for (const slot of outageSlots) {
    if (!currentRange) {
      currentRange = startRange(slot)
    } else if (currentRange.endInMinutes === slot.startInMinutes) {
      // Consecutive slot - extend the current range
      currentRange.endTime = slot.timeRange.split("-")[1]
      currentRange.endInMinutes = slot.endInMinutes
      currentRange.slotCount++
    } else {
      // Gap found - save current range and start new one
      finishRange(currentRange)
      currentRange = startRange(slot)
    }
  }

  // Don't forget the last range
  if (currentRange) {
    finishRange(currentRange)
  }

  // Find current or next outage from merged ranges
  let currentOutage = null
  let nextOutage = null

  for (const range of mergedOutages) {
    // Check if we're currently in this outage
    if (
      range.startInMinutes <= currentTimeInMinutes &&
      range.endInMinutes > currentTimeInMinutes
    ) {
      currentOutage = range
    }
    // Check if this is an upcoming outage
    else if (!nextOutage && range.startInMinutes > currentTimeInMinutes) {
      nextOutage = range
    }

    // Stop if we found both
    if (currentOutage && nextOutage) break
  }

  // Return current outage if exists, otherwise next outage
  const selectedOutage = currentOutage || nextOutage

  if (selectedOutage) {
    const isCurrent = !!currentOutage
    console.log(
      `🔍 ${isCurrent ? "Current" : "Next"} outage: ${selectedOutage.timeRange} (${selectedOutage.description})`
    )

    const pick = (o) =>
      o
        ? {
            timeRange: o.timeRange,
            description: o.description,
            status: o.status,
          }
        : null

    return {
      queueGroup,
      currentOutage: pick(currentOutage),
      nextOutage: pick(nextOutage),
    }
  }

  console.log("✅ No more outages today!")
  return null
}

function loadMessageHistory() {
  if (!fs.existsSync(MESSAGE_HISTORY_FILE)) return null

  try {
    const lastMessage = JSON.parse(
      fs.readFileSync(MESSAGE_HISTORY_FILE, "utf8").trim()
    )
    return lastMessage
  } catch (error) {
    console.log("⚠️ Failed to load message history:", error.message)
    return null
  }
}

function saveMessageHistory(entry, outageData = null) {
  // Always overwrite with just the latest entry
  const historyEntry = outageData ? { ...entry, outageData } : entry
  fs.mkdirSync(path.dirname(MESSAGE_HISTORY_FILE), { recursive: true })
  fs.writeFileSync(MESSAGE_HISTORY_FILE, JSON.stringify(historyEntry, null, 2))
}

function createMessageHash(outageData) {
  const { emergencyOutage, nextScheduledOutage } = outageData

  // Create a compact hash representing only the critical timing information
  // This ensures we don't send duplicates for the same time ranges
  const parts = []

  if (emergencyOutage) {
    // Extract only start and end times, ignore sub_type description
    const startTime = emergencyOutage.start_date || ""
    const endTime = emergencyOutage.end_date || ""
    parts.push(`E:${startTime}|${endTime}`)
    // When emergency exists, we don't include scheduled outages in hash
    // This way if emergency ends, hash changes and triggers notification
  } else if (nextScheduledOutage) {
    // Only include scheduled outage info if NO emergency
    const { queueGroup, currentOutage, nextOutage } = nextScheduledOutage
    parts.push(`S:${queueGroup}`)

    // Only include time ranges, not descriptions
    if (currentOutage) {
      parts.push(`C:${currentOutage.timeRange}`)
    }
    if (nextOutage) {
      parts.push(`N:${nextOutage.timeRange}`)
    }
  }

  return parts.join("|")
}

function isDuplicateMessage(outageData, lastEntry = loadMessageHistory()) {
  if (!lastEntry) return false

  const currentHash = createMessageHash(outageData)
  const lastHash = lastEntry.hash

  // If hash is different, it's not a duplicate - outage range has changed
  if (lastHash !== currentHash) {
    console.log("📝 Outage information changed - will send update")
    return false
  }

  // Same hash - this is a duplicate, skip it
  console.log("⏭️ Skipping duplicate message (same outage state)")
  return true
}

// True if the history entry was written on the same Kyiv date as `now`.
// Unknown/invalid timestamps count as a different day (no time-based decisions).
function isSameKyivDay(lastEntry, now) {
  if (!lastEntry?.timestamp) return false
  const ts = new Date(lastEntry.timestamp)
  if (Number.isNaN(ts.getTime())) return false
  return getKyivParts(ts).dateKey === getKyivParts(now).dateKey
}

function getScheduledOutage(outageData) {
  return (
    outageData?.nextScheduledOutage?.currentOutage ||
    outageData?.nextScheduledOutage?.nextOutage ||
    null
  )
}

function detectOutagePassed(
  currentOutageData,
  { lastEntry = loadMessageHistory(), now = new Date() } = {}
) {
  if (!lastEntry || !lastEntry.outageData) return null

  const previousData = lastEntry.outageData

  // Priority 1: Check if emergency outage has ended (emergency field disappeared)
  const hadEmergencyOutage = previousData.emergencyOutage
  const hasEmergencyOutage = currentOutageData.emergencyOutage

  if (hadEmergencyOutage && !hasEmergencyOutage) {
    // Don't send if we already sent an outage-passed notification for this emergency
    if (lastEntry.type === "outage-passed") {
      console.log("⏭️ Emergency outage-passed notification already sent")
      return null
    }

    console.log("✅ Emergency outage has passed!")

    // Return information about the emergency that passed
    return {
      passedOutage: hadEmergencyOutage,
      isEmergency: true,
      nextOutage:
        currentOutageData.nextScheduledOutage?.currentOutage ||
        currentOutageData.nextScheduledOutage?.nextOutage ||
        null,
      queueGroup:
        currentOutageData.nextScheduledOutage?.queueGroup ||
        previousData.nextScheduledOutage?.queueGroup,
    }
  }

  // Scheduled ranges belong to the day they were recorded on
  if (!isSameKyivDay(lastEntry, now)) return null

  // Priority 2: Check if there was a scheduled current outage previously
  const hadCurrentOutage = previousData.nextScheduledOutage?.currentOutage
  const hasCurrentOutage = currentOutageData.nextScheduledOutage?.currentOutage

  // If we had a current scheduled outage before and now we don't, it has passed
  // But only notify if there's no emergency currently active
  if (hadCurrentOutage && !hasCurrentOutage && !hasEmergencyOutage) {
    // Don't send if we already sent an outage-passed notification for this same outage
    if (lastEntry.type === "outage-passed") {
      console.log("⏭️ Outage-passed notification already sent for this outage")
      return null
    }

    console.log("✅ Scheduled outage has passed!")

    // Return information about the next outage (if any)
    return {
      passedOutage: hadCurrentOutage,
      isEmergency: false,
      nextOutage: currentOutageData.nextScheduledOutage?.nextOutage || null,
      queueGroup:
        currentOutageData.nextScheduledOutage?.queueGroup ||
        previousData.nextScheduledOutage?.queueGroup,
    }
  }

  // Priority 3: previous state only had an upcoming outage, and now there are
  // no scheduled outages at all. If that outage's start time is already behind
  // us, it happened while we weren't watching (delayed runs) - it passed,
  // it was not cancelled.
  const hadScheduledOutage = getScheduledOutage(previousData)
  const hasScheduledOutage = getScheduledOutage(currentOutageData)

  if (
    hadScheduledOutage &&
    !hasScheduledOutage &&
    !hadEmergencyOutage &&
    !hasEmergencyOutage
  ) {
    const { start } = parseTimeRange(hadScheduledOutage.timeRange)
    // No "already sent" guard needed: after sending, the saved state has no
    // scheduled outage, so this branch can't fire twice for the same outage
    if (start <= getKyivParts(now).minutesOfDay) {
      console.log("✅ Scheduled outage passed while the monitor was not running!")

      return {
        passedOutage: hadScheduledOutage,
        isEmergency: false,
        nextOutage: null,
        queueGroup: previousData.nextScheduledOutage?.queueGroup,
      }
    }
  }

  return null
}

function detectOutageCancelled(
  currentOutageData,
  { lastEntry = loadMessageHistory(), now = new Date() } = {}
) {
  if (!lastEntry || !lastEntry.outageData) return null

  const previousData = lastEntry.outageData

  // Check if we had any scheduled outage before (current or next)
  const hadScheduledOutage = getScheduledOutage(previousData)
  const hasScheduledOutage = getScheduledOutage(currentOutageData)

  // If we had a scheduled outage but now have none, it may have been cancelled
  if (hadScheduledOutage && !hasScheduledOutage && !previousData.emergencyOutage) {
    // Yesterday's ranges say nothing about today
    if (!isSameKyivDay(lastEntry, now)) return null

    // Only cancelled if the previous outage had not started yet; otherwise it
    // happened (or is covered by the outage-passed logic)
    const { start } = parseTimeRange(hadScheduledOutage.timeRange)
    if (start <= getKyivParts(now).minutesOfDay) return null

    // Don't send if we already sent a cancellation notification
    if (lastEntry.type === "outage-cancelled") {
      console.log("⏭️ Outage cancellation notification already sent")
      return null
    }

    console.log("✅ Scheduled outage was cancelled!")

    return {
      cancelledOutage: hadScheduledOutage,
      queueGroup: previousData.nextScheduledOutage?.queueGroup,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Messages / sending
// ---------------------------------------------------------------------------

function getTelegramOptions() {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = getConfig()
  if (!TELEGRAM_BOT_TOKEN)
    throw Error("❌ Missing telegram bot token or chat id.")
  if (!TELEGRAM_CHAT_ID) throw Error("❌ Missing telegram chat id.")
  return { token: TELEGRAM_BOT_TOKEN, chatId: TELEGRAM_CHAT_ID }
}

function appendMetadata(messageParts, info, updateNotificationTimestamp) {
  const { updateTimestamp } = info || {}
  messageParts.push(
    "",
    "⏰ <b>Час оновлення інформації:</b>",
    updateTimestamp || updateNotificationTimestamp,
    "⏰ <b>Час оновлення повідомлення:</b>",
    updateNotificationTimestamp
  )
}

function buildCancelledMessage(info, cancelledOutageInfo, now = new Date()) {
  const { cancelledOutage, queueGroup } = cancelledOutageInfo
  const updateNotificationTimestamp = formatKyivTimestamp(now)
  const cancelledDuration = calculateOutageDuration(cancelledOutage.timeRange)

  const messageParts = [
    "🎉 <b>Відключення скасовано!</b>",
    "",
    "📊 <b>Черга:</b>",
    queueGroup,
    "",
    "🕐 <b>Скасоване відключення:</b>",
    cancelledOutage.timeRange,
    "",
    "⏱ <b>Тривалість була б:</b>",
    cancelledDuration,
    "",
    "✅ <b>Електропостачання буде безперервним</b>",
  ]

  appendMetadata(messageParts, info, updateNotificationTimestamp)
  return messageParts.join("\n")
}

async function sendOutageCancelledNotification(info, cancelledOutageInfo) {
  const options = getTelegramOptions()
  const text = buildCancelledMessage(info, cancelledOutageInfo)

  console.log("🌀 Sending outage-cancelled notification...")
  const data = await sendTelegramMessage(text, options)
  console.log("🟢 Outage-cancelled notification sent.", data)

  return { success: data.ok }
}

function buildPassedMessage(info, passedOutageInfo, now = new Date()) {
  const { passedOutage, nextOutage, queueGroup, isEmergency } = passedOutageInfo
  const updateNotificationTimestamp = formatKyivTimestamp(now)

  const messageParts = []

  // Handle emergency outage passed
  if (isEmergency) {
    const { sub_type, start_date, end_date } = passedOutage
    const { duration } = getEmergencyTiming(start_date, end_date, now)

    messageParts.push(
      "✅ <b>Екстрене відключення завершено!</b>",
      "",
      "ℹ️ <b>Тип:</b>",
      sub_type || "Невідомо",
      "",
      "🔴 <b>Початок:</b>",
      start_date || "Невідомо",
      "",
      "🟢 <b>Завершено:</b>",
      end_date || "Невідомо"
    )

    if (duration) {
      messageParts.push("", "⏱ <b>Тривалість:</b>", duration)
    }
  } else {
    // Handle scheduled outage passed
    const passedDuration = calculateOutageDuration(passedOutage.timeRange)

    messageParts.push(
      "✅ <b>Відключення завершено!</b>",
      "",
      "📊 <b>Черга:</b>",
      queueGroup,
      "",
      "🕐 <b>Завершене відключення:</b>",
      passedOutage.timeRange,
      "",
      "⏱ <b>Тривалість:</b>",
      passedDuration
    )
  }

  // Add next outage information if available
  if (nextOutage) {
    // Check if nextOutage has timeRange (scheduled) or start_date/end_date (emergency)
    if (nextOutage.timeRange) {
      const nextDuration = calculateOutageDuration(nextOutage.timeRange)
      messageParts.push(
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "⏰ <b>Наступне відключення</b>",
        "",
        "🕐 <b>Час:</b>",
        nextOutage.timeRange,
        "",
        "⏱ <b>Тривалість:</b>",
        nextDuration
      )
    } else {
      // It's an emergency-style next outage
      messageParts.push(
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "⏰ <b>Наступне відключення</b>",
        "",
        "🕐 <b>Час:</b>",
        `${nextOutage.start_date || "Невідомо"} - ${nextOutage.end_date || "Невідомо"}`
      )
    }
  } else {
    messageParts.push(
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      "🎉 <b>Більше відключень сьогодні не заплановано!</b>"
    )
  }

  appendMetadata(messageParts, info, updateNotificationTimestamp)
  return messageParts.join("\n")
}

async function sendOutagePassedNotification(info, passedOutageInfo) {
  const options = getTelegramOptions()
  const text = buildPassedMessage(info, passedOutageInfo)

  console.log("🌀 Sending outage-passed notification...")
  const data = await sendTelegramMessage(text, options)
  console.log("🟢 Outage-passed notification sent.", data)

  return { success: data.ok }
}

function buildOutageMessage(info, outageData, now = new Date()) {
  const { emergencyOutage, nextScheduledOutage } = outageData
  const updateNotificationTimestamp = formatKyivTimestamp(now)

  const messageParts = []

  // Add emergency outage section if exists
  if (emergencyOutage) {
    const { sub_type, start_date, end_date } = emergencyOutage
    const { isActiveNow, duration } = getEmergencyTiming(
      start_date,
      end_date,
      now
    )

    messageParts.push(
      "🚨🚨🚨 <b>ЕКСТРЕНЕ ВІДКЛЮЧЕННЯ!</b> 🚨🚨🚨",
      "",
      isActiveNow
        ? "⚠️ <b>ЗАРАЗ АКТИВНЕ!</b>"
        : "⚠️ <b>УВАГА! Аварійне відключення!</b>",
      "",
      "ℹ️ <b>Тип:</b>",
      sub_type || "Невідомо",
      "",
      "🔴 <b>Початок:</b>",
      start_date || "Невідомо",
      "",
      "🟢 <b>Очікуване відновлення:</b>",
      end_date || "Невідомо"
    )

    if (duration) {
      messageParts.push("", "⏱ <b>Тривалість:</b>", duration)
    }

    messageParts.push("", "━━━━━━━━━━━━━━━━━━━━", "")
  }

  // Add scheduled outage section
  // Show scheduled info even if there's emergency (to show what's coming next)
  if (nextScheduledOutage) {
    const { queueGroup, currentOutage, nextOutage } = nextScheduledOutage

    // If there's emergency, show scheduled as "what's next"
    if (emergencyOutage) {
      messageParts.push("📅 <b>Планові відключення сьогодні:</b>", "")
    }

    messageParts.push("📊 <b>Черга:</b>", queueGroup, "")

    // Show current outage if exists (and no emergency)
    if (currentOutage && !emergencyOutage) {
      const currentDuration = calculateOutageDuration(currentOutage.timeRange)
      messageParts.push(
        "⚡️ <b>Поточне відключення</b>",
        "",
        "🕐 <b>Час:</b>",
        currentOutage.timeRange,
        "",
        "⏱ <b>Тривалість:</b>",
        currentDuration
      )

      // Add separator if next outage also exists
      if (nextOutage) {
        messageParts.push("", "—————————————", "")
      }
    }

    // Show next outage if exists
    if (nextOutage) {
      const nextDuration = calculateOutageDuration(nextOutage.timeRange)
      const label =
        emergencyOutage || currentOutage
          ? "⏰ <b>Наступне відключення</b>"
          : "⏰ <b>Планове відключення</b>"
      messageParts.push(
        label,
        "",
        "🕐 <b>Час:</b>",
        nextOutage.timeRange,
        "",
        "⏱ <b>Тривалість:</b>",
        nextDuration
      )
    }
  }

  appendMetadata(messageParts, info, updateNotificationTimestamp)
  return messageParts.join("\n")
}

async function sendNotification(
  info,
  outageData,
  { lastEntry = loadMessageHistory() } = {}
) {
  const options = getTelegramOptions()

  // Check for duplicate message
  if (isDuplicateMessage(outageData, lastEntry)) {
    return { wasDuplicate: true }
  }

  const now = new Date()
  const text = buildOutageMessage(info, outageData, now)

  console.log("🌀 Sending notification...")
  // Throws if the message could not be delivered - history is NOT saved then,
  // so the next run retries.
  const data = await sendTelegramMessage(text, options)
  console.log("🟢 Notification sent.", data)

  // Save to message history only after a successful send
  saveMessageHistory(
    {
      timestamp: now.toISOString(),
      hash: createMessageHash(outageData),
      sent: true,
    },
    outageData
  )

  return { wasDuplicate: false, success: data.ok }
}

// ---------------------------------------------------------------------------
// Last status check message
// ---------------------------------------------------------------------------
// After every information message a separate silent message with the time of
// the last check is sent and the previous one is deleted, so the chat only
// ever has one, always below the latest update. While nothing changes, later
// runs edit that message instead. Its id is kept in history as `statusMessageId`.

function buildStatusCheckMessage(now = new Date()) {
  return `🔄 <b>Остання перевірка статусу:</b> ${formatKyivTime(now)}`
}

// Sends a new status message. Returns its message_id, or null on failure
// (the information message is already delivered, so this must not throw).
async function sendStatusCheckMessage(now = new Date()) {
  try {
    const data = await sendTelegramMessage(buildStatusCheckMessage(now), {
      ...getTelegramOptions(),
      silent: true,
    })
    console.log("🟢 Status check message sent.")
    return data.result?.message_id ?? null
  } catch (error) {
    console.log("⚠️ Failed to send status check message:", error.message)
    return null
  }
}

// Edits the existing status message with the current check time.
// Returns false if the message is gone and its id should be forgotten.
async function updateStatusCheckMessage(messageId, now = new Date()) {
  try {
    await editTelegramMessage(messageId, buildStatusCheckMessage(now), {
      ...getTelegramOptions(),
    })
    console.log(`🔄 Status check message updated (${formatKyivTime(now)})`)
  } catch (error) {
    // Two runs within the same minute produce identical text
    if (/message is not modified/i.test(error.message)) return true
    if (/message to edit not found|message can't be edited/i.test(error.message)) {
      console.log("⚠️ Status check message no longer editable - forgetting it")
      return false
    }
    console.log("⚠️ Failed to update status check message:", error.message)
  }
  return true
}

// Best effort: a failed delete just leaves a stale status message behind
async function deleteStatusCheckMessage(messageId) {
  try {
    await deleteTelegramMessage(messageId, { ...getTelegramOptions() })
    console.log("🗑️ Previous status check message deleted.")
  } catch (error) {
    console.log("⚠️ Failed to delete previous status check message:", error.message)
  }
}

function setStatusMessageId(statusMessageId) {
  const entry = loadMessageHistory()
  if (!entry) return
  const { statusMessageId: _, ...rest } = entry
  saveMessageHistory(statusMessageId ? { ...rest, statusMessageId } : rest)
}

async function commitMessageHistory() {
  try {
    // Check if running in CI/GitHub Actions
    const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"

    if (!isCI) {
      console.log("⏭️ Skipping git commit (not running in CI)")
      return
    }

    console.log("🌀 Committing message history to git...")

    const { execSync } = require("child_process")

    // Configure git if needed
    try {
      execSync('git config user.email "noreply@github.com"', { stdio: "ignore" })
      execSync('git config user.name "GitHub Actions Bot"', { stdio: "ignore" })
    } catch (error) {
      // Git config already set
    }

    // Check if message history file exists and has changes
    if (!fs.existsSync(MESSAGE_HISTORY_FILE)) {
      console.log("⏭️ No message history file to commit")
      return
    }

    // Determine the main branch and ensure we're on it
    let mainBranch = "main"
    try {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
      }).trim()
      console.log(`📍 Current branch: ${currentBranch}`)

      // Detect if the repo uses 'master' or 'main'
      try {
        execSync("git show-ref --verify refs/heads/main", { stdio: "ignore" })
        mainBranch = "main"
      } catch {
        try {
          execSync("git show-ref --verify refs/heads/master", { stdio: "ignore" })
          mainBranch = "master"
        } catch {
          console.log("⚠️ Could not determine main branch")
        }
      }

      console.log(`📌 Main branch: ${mainBranch}`)

      if (currentBranch !== mainBranch) {
        console.log(`⚠️ Not on ${mainBranch} branch, checking out ${mainBranch}...`)
        execSync(`git checkout ${mainBranch}`, { stdio: "inherit" })
      }
    } catch (error) {
      console.log("⚠️ Could not determine or switch branch:", error.message)
    }

    // Add the message history file
    execSync("git add artifacts/message-history.json", { stdio: "inherit" })

    // Check if there are changes to commit
    try {
      execSync('git diff --cached --quiet artifacts/message-history.json')
      console.log("⏭️ No changes to commit")
      return
    } catch (error) {
      // There are changes, continue with commit
    }

    // Commit the changes first
    execSync(
      'git commit -m "chore: update message history [skip ci]"',
      { stdio: "inherit" }
    )

    // Pull latest changes from remote with rebase
    try {
      console.log("🔄 Pulling latest changes from remote...")
      execSync(`git pull origin ${mainBranch} --rebase`, { stdio: "inherit" })
    } catch (pullError) {
      console.log("⚠️ Pull failed:", pullError.message)
      // If pull fails, abort rebase and try to push anyway
      try {
        execSync("git rebase --abort", { stdio: "ignore" })
      } catch {}
    }

    // Push to the main branch
    execSync(`git push origin ${mainBranch}`, { stdio: "inherit" })
    console.log(`✅ Message history committed and pushed to ${mainBranch}`)
  } catch (error) {
    console.log("⚠️ Failed to commit message history:", error.message)
  }
}

async function run() {
  const { CITY, STREET } = getConfig()
  const info = await getInfo({ city: CITY, street: STREET })
  const outageData = checkOutage(info)

  // Shared snapshot of history/time so decisions are consistent within one run
  const lastEntry = loadMessageHistory()
  const now = new Date()

  // Check if an outage has passed
  const passedOutageInfo = detectOutagePassed(outageData, { lastEntry, now })

  // Check if an outage was cancelled
  const cancelledOutageInfo = detectOutageCancelled(outageData, {
    lastEntry,
    now,
  })

  let sentInformationMessage = false

  if (passedOutageInfo) {
    // An outage just ended - send "outage passed" notification (throws on failure)
    await sendOutagePassedNotification(info, passedOutageInfo)
    sentInformationMessage = true

    // Update message history to reflect current state (only after successful send)
    saveMessageHistory(
      {
        timestamp: new Date().toISOString(),
        hash: createMessageHash(outageData),
        sent: true,
        type: "outage-passed",
      },
      outageData
    )
  } else if (cancelledOutageInfo) {
    // An outage was cancelled - send "outage cancelled" notification (throws on failure)
    await sendOutageCancelledNotification(info, cancelledOutageInfo)
    sentInformationMessage = true

    saveMessageHistory(
      {
        timestamp: new Date().toISOString(),
        hash: createMessageHash(outageData),
        sent: true,
        type: "outage-cancelled",
      },
      outageData
    )
  } else if (outageData.isOutageDetected) {
    // Regular outage notification (nothing is sent for a duplicate)
    const result = await sendNotification(info, outageData, { lastEntry })
    sentInformationMessage = !result.wasDuplicate
  } else {
    console.log("✅ No outage detected - no notification needed")

    // Check if the state has actually changed before updating history
    const currentHash = createMessageHash(outageData)

    // Only update history if this is a new state (hash changed or first run)
    if (!lastEntry || lastEntry.hash !== currentHash) {
      console.log("📝 State changed - updating message history")
      saveMessageHistory(
        {
          timestamp: new Date().toISOString(),
          hash: currentHash,
          sent: false,
          type: "no-outage",
          // No message was sent, so keep updating the existing status message
          ...(lastEntry?.statusMessageId
            ? { statusMessageId: lastEntry.statusMessageId }
            : {}),
        },
        outageData
      )
    } else {
      console.log("⏭️ State unchanged - no history update needed")
    }
  }

  if (sentInformationMessage) {
    // New information message - move the status check message below it
    if (lastEntry?.statusMessageId) {
      await deleteStatusCheckMessage(lastEntry.statusMessageId)
    }
    setStatusMessageId(await sendStatusCheckMessage(now))
    await commitMessageHistory()
  } else if (lastEntry?.statusMessageId) {
    // Nothing new to report - just refresh the time of the last check
    const stillExists = await updateStatusCheckMessage(
      lastEntry.statusMessageId,
      now
    )
    if (!stillExists) setStatusMessageId(null)
  }
}

// Only run if this is the entry point (so tests can require this module)
if (require.main === module) {
  run().catch((error) => {
    console.error("💥 Fatal error:", error)
    process.exitCode = 1
  })
}

module.exports = {
  getKyivParts,
  getKyivMidnightTimestamp,
  parseTimeRange,
  formatDuration,
  parseEmergencyDate,
  getEmergencyTiming,
  checkOutage,
  findNextScheduledOutage,
  createMessageHash,
  isDuplicateMessage,
  detectOutagePassed,
  detectOutageCancelled,
  calculateOutageDuration,
  buildOutageMessage,
  buildPassedMessage,
  buildCancelledMessage,
  sendNotification,
  sendOutagePassedNotification,
  sendOutageCancelledNotification,
  buildStatusCheckMessage,
  sendStatusCheckMessage,
  updateStatusCheckMessage,
  deleteStatusCheckMessage,
  loadMessageHistory,
  saveMessageHistory,
  run,
}
