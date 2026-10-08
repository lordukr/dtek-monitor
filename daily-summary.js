require("dotenv").config()
const { getInfo: fetchDtekInfo } = require("./lib/dtek")
const { sendTelegramMessage } = require("./lib/telegram")

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CITY, STREET, HOUSE } =
  process.env

async function getInfo() {
  console.log("📍 Address details:")
  console.log(`   City: ${CITY}`)
  console.log(`   Street: ${STREET}`)
  console.log(`   House: ${HOUSE}`)

  const info = await fetchDtekInfo({ city: CITY, street: STREET })
  console.log("📦 Full API response:", JSON.stringify(info, null, 2))
  return info
}

function checkPlannedOutages(info) {
  console.log("🌀 Checking planned outages for today...")
  process.stdout.write("🔍 Info object structure check:\n")
  process.stdout.write(`   - info exists: ${!!info}\n`)
  process.stdout.write(`   - info.data exists: ${!!info?.data}\n`)
  process.stdout.write(`   - info.preset exists: ${!!info?.preset}\n`)
  process.stdout.write(`   - info.fact exists: ${!!info?.fact}\n`)

  if (!info?.data) {
    throw Error("❌ Power outage info missed.")
  }

  console.log(`🏠 Looking for house number: "${HOUSE}"`)
  console.log(`📋 Available houses in data:`, Object.keys(info.data || {}))

  const houseData = info?.data?.[HOUSE]
  console.log("📊 House data:", JSON.stringify(houseData, null, 2))

  const { sub_type, start_date, end_date, type, sub_type_reason } =
    houseData || {}

  console.log("🔍 Basic outage fields:", {
    sub_type,
    start_date,
    end_date,
    type,
    sub_type_reason,
  })

  // Check for immediate/emergency outages (sub_type, start_date, end_date filled)
  const hasEmergencyOutage =
    (sub_type && sub_type !== "") ||
    (start_date && start_date !== "") ||
    (end_date && end_date !== "") ||
    (type && type !== "")

  let emergencyOutage = null
  if (hasEmergencyOutage) {
    console.log("🚨 Emergency/Active outage detected!")
    emergencyOutage = {
      sub_type,
      start_date,
      end_date,
      type,
    }
  }

  // Check for scheduled outages in preset/fact data (always check, even if emergency exists)
  console.log("📅 Checking schedule data...")

  if (!info.preset?.data || !info.fact?.data || !sub_type_reason) {
    console.log("⚠️ No schedule data available")
    // Return emergency outage if exists, otherwise no outage
    if (emergencyOutage) {
      return {
        hasOutage: true,
        emergencyOutage,
        scheduledOutage: null,
      }
    }
    return { hasOutage: false }
  }

  const queueGroup = sub_type_reason[0] // e.g., "GPV1.2"
  console.log(`🔢 House queue group: ${queueGroup}`)

  // Calculate today's timestamp using UTC date (not Kyiv time)
  // This matches when the script runs: 00:10 UTC on Nov 10 = check Nov 10 schedule
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()

  // Get Unix timestamp for start of day (00:00:00) in UTC
  const todayTimestamp = Math.floor(Date.UTC(year, month, day, 0, 0, 0, 0) / 1000)

  console.log(`📆 Current UTC date: ${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
  console.log(`📆 Calculated timestamp: ${todayTimestamp}`)
  console.log(
    `   (Represents: ${new Date(todayTimestamp * 1000).toUTCString()})`
  )
  console.log(`📆 API's today timestamp: ${info.fact?.today}`)
  console.log(
    `   (API represents: ${new Date((info.fact?.today || 0) * 1000).toUTCString()})`
  )

  // Log all available timestamps in fact.data to help debug
  if (info.fact?.data) {
    console.log(
      "📋 Available timestamps in fact.data:",
      Object.keys(info.fact.data)
    )
  }

  // Try to get schedule for today using calculated timestamp
  let todaySchedule = info.fact?.data?.[todayTimestamp]?.[queueGroup]

  // If not found with calculated timestamp, try API's timestamp as fallback
  if (!todaySchedule && info.fact?.today) {
    console.log("⚠️ Schedule not found with calculated timestamp, trying API timestamp...")
    todaySchedule = info.fact?.data?.[info.fact.today]?.[queueGroup]
  }
  console.log(
    `📋 Today's schedule for ${queueGroup}:`,
    JSON.stringify(todaySchedule, null, 2)
  )

  if (!todaySchedule) {
    console.log(`⚠️ No schedule found for queue ${queueGroup}`)
    // Return emergency outage if exists, otherwise no outage
    if (emergencyOutage) {
      return {
        hasOutage: true,
        emergencyOutage,
        scheduledOutage: null,
      }
    }
    return { hasOutage: false }
  }

  // Parse outage time slots
  const outageSlots = []
  const timeZones = info.preset?.time_zone || {}
  const timeTypes = info.preset?.time_type || {}

  console.log("⏰ Analyzing hourly schedule...")
  for (let hour = 1; hour <= 24; hour++) {
    const status = todaySchedule[hour.toString()]
    const timeInfo = timeZones[hour.toString()]

    if (
      status === "no" ||
      status === "first" ||
      status === "second" ||
      status === "maybe"
    ) {
      const timeRange = timeInfo ? timeInfo[0] : `${hour - 1}-${hour}`
      console.log(
        `   ⚡ Hour ${hour} (${timeRange}): ${status} - ${timeTypes[status] || status}`
      )
      outageSlots.push({
        hour,
        timeRange,
        status,
        description: timeTypes[status] || status,
      })
    }
  }

  if (outageSlots.length > 0) {
    console.log(`📋 Found ${outageSlots.length} outage time slots!`)
    console.log("📝 Outage periods:", outageSlots)

    // Group consecutive slots
    // Only split when there's a time gap (e.g., "first" ends at :30 but next slot starts at :00)
    const periods = []
    let currentPeriod = null

    outageSlots.forEach((slot) => {
      if (!currentPeriod) {
        currentPeriod = { start: slot.hour, end: slot.hour, slots: [slot] }
      } else if (slot.hour === currentPeriod.end + 1) {
        const lastSlot = currentPeriod.slots[currentPeriod.slots.length - 1]

        // Check if we should split the period:
        // Only split if there's an actual time gap between periods
        // - If last slot was "first" (ends at XX:30) AND current slot is NOT "second" (starts at XX:00), split
        // - If last slot was "first" (ends at XX:30) AND current slot IS "second" (starts at XX:30), DON'T split - they're continuous!
        const lastSlotEndsAtHalf = lastSlot.status === "first"
        const currentSlotStartsAtHalf = slot.status === "second"

        // Split only if last slot ended at :30 but current doesn't start at :30
        // This creates a gap from XX:30 to XX:00 (next hour)
        const shouldSplit = lastSlotEndsAtHalf && !currentSlotStartsAtHalf

        if (shouldSplit) {
          periods.push(currentPeriod)
          currentPeriod = { start: slot.hour, end: slot.hour, slots: [slot] }
        } else {
          currentPeriod.end = slot.hour
          currentPeriod.slots.push(slot)
        }
      } else {
        periods.push(currentPeriod)
        currentPeriod = { start: slot.hour, end: slot.hour, slots: [slot] }
      }
    })
    if (currentPeriod) periods.push(currentPeriod)

    console.log("📊 Grouped outage periods:")
    periods.forEach((period, i) => {
      let startTime = timeZones[period.start.toString()]?.[1] || "?"
      let endTime = timeZones[period.end.toString()]?.[2] || "?"

      // Adjust start time if first slot is "second"
      const firstSlot = period.slots[0]
      if (firstSlot.status === "second" && startTime !== "?") {
        const [hour] = startTime.split(":")
        startTime = `${hour}:30`
      }

      // Adjust end time if last slot is "first"
      const lastSlot = period.slots[period.slots.length - 1]
      if (lastSlot.status === "first" && endTime !== "?") {
        // "first" means first 30 minutes, so outage ends at XX:30
        const lastSlotTime = timeZones[lastSlot.hour.toString()]?.[1] || "?"
        if (lastSlotTime !== "?") {
          const [hour] = lastSlotTime.split(":")
          endTime = `${hour}:30`
        }
      }

      console.log(`   Period ${i + 1}: ${startTime} - ${endTime}`)
    })

    const scheduledOutage = {
      queueGroup,
      outageSlots,
      periods,
      scheduleDescription: formatScheduleDescription(periods, timeZones),
    }

    // Return both emergency and scheduled outages
    return {
      hasOutage: true,
      emergencyOutage,
      scheduledOutage,
    }
  }

  console.log("✅ No planned outages for today!")
  // Return emergency outage if exists, otherwise no outage
  if (emergencyOutage) {
    return {
      hasOutage: true,
      emergencyOutage,
      scheduledOutage: null,
    }
  }
  return { hasOutage: false }
}

function formatScheduleDescription(periods, timeZones) {
  return periods
    .map((period) => {
      let startTime = timeZones[period.start.toString()]?.[1] || "?"
      let endTime = timeZones[period.end.toString()]?.[2] || "?"

      // Adjust start time if first slot is "second"
      const firstSlot = period.slots[0]
      if (firstSlot.status === "second" && startTime !== "?") {
        const [hour] = startTime.split(":")
        startTime = `${hour}:30`
      }

      // Adjust end time if last slot is "first"
      const lastSlot = period.slots[period.slots.length - 1]
      if (lastSlot.status === "first" && endTime !== "?") {
        // "first" means first 30 minutes, so outage ends at XX:30
        const lastSlotTime = timeZones[lastSlot.hour.toString()]?.[1]
        if (lastSlotTime) {
          const [hour] = lastSlotTime.split(":")
          endTime = `${hour}:30`
        }
      }

      return `${startTime}-${endTime}`
    })
    .join(", ")
}

function getDetailedTimeRange(slot, timeZones) {
  const baseTime = timeZones[slot.hour.toString()]
  if (!baseTime) return `${slot.hour - 1}:00-${slot.hour}:00`

  const startHour = baseTime[1] // e.g., "00:00"
  const endHour = baseTime[2] // e.g., "01:00"

  if (slot.status === "first") {
    // First 30 minutes: 00:00-00:30
    const [hour] = startHour.split(":")
    return `${hour}:00-${hour}:30`
  } else if (slot.status === "second") {
    // Second 30 minutes: 00:30-01:00
    const [hour] = startHour.split(":")
    return `${hour}:30-${endHour}`
  } else {
    // Full hour
    return `${startHour}-${endHour}`
  }
}

async function sendDailySummary(info, outageData) {
  console.log("📨 Preparing to send Telegram message...")
  console.log(`   Bot token present: ${!!TELEGRAM_BOT_TOKEN}`)
  console.log(`   Chat ID: ${TELEGRAM_CHAT_ID}`)

  if (!TELEGRAM_BOT_TOKEN)
    throw Error("❌ Missing telegram bot token or chat id.")
  if (!TELEGRAM_CHAT_ID) throw Error("❌ Missing telegram chat id.")

  const now = new Date()
  const time = now.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  })
  const date = now.toLocaleDateString("uk-UA", {
    timeZone: "Europe/Kyiv",
  })
  const timestamp = `${time} ${date}`

  let text

  if (outageData.hasOutage) {
    console.log("📝 Creating message for OUTAGE DETECTED")

    const { emergencyOutage, scheduledOutage } = outageData
    const messageParts = ["🌅 <b>Доброго ранку!</b>", ""]

    // Add emergency outage section if exists
    if (emergencyOutage) {
      const { sub_type, start_date, end_date } = emergencyOutage
      messageParts.push(
        "🚨 <b>УВАГА! Аварійне відключення!</b>",
        "",
        "ℹ️ <b>Причина:</b>",
        (sub_type || "Невідома") + ".",
        "",
        "🔴 <b>Час початку:</b>",
        start_date || "Невідомий",
        "",
        "🟢 <b>Час відновлення:</b>",
        end_date || "Невідомий"
      )

      // Add separator if we also have scheduled outages
      if (scheduledOutage) {
        messageParts.push("", "━━━━━━━━━━━━━━━━━━━━")
      }
    }

    // Add scheduled outage section if exists
    if (scheduledOutage) {
      const { queueGroup, periods } = scheduledOutage
      const periodDetails = periods
        .map((period) => {
          let startTime =
            info.preset?.time_zone?.[period.start.toString()]?.[1] || "?"
          let endTime =
            info.preset?.time_zone?.[period.end.toString()]?.[2] || "?"

          // Adjust start time if first slot is "second"
          const firstSlot = period.slots[0]
          if (firstSlot.status === "second" && startTime !== "?") {
            const [hour] = startTime.split(":")
            startTime = `${hour}:30`
          }

          // Adjust end time if last slot is "first"
          const lastSlot = period.slots[period.slots.length - 1]
          if (lastSlot.status === "first" && endTime !== "?") {
            // "first" means first 30 minutes, so outage ends at XX:30
            const lastSlotTime =
              info.preset?.time_zone?.[lastSlot.hour.toString()]?.[1]
            if (lastSlotTime) {
              const [hour] = lastSlotTime.split(":")
              endTime = `${hour}:30`
            }
          }

          return `   • ${startTime} - ${endTime}`
        })
        .join("\n")

      messageParts.push(
        "",
        "⚠️ <b>Заплановані відключення на сьогодні</b>",
        "",
        "📊 <b>Черга:</b>",
        queueGroup,
        "",
        "⏰ <b>Періоди відключення:</b>",
        periodDetails,
        "",
        "💡 <b>Порада:</b>",
        "Зарядіть пристрої та підготуйтеся заздалегідь"
      )
    }

    messageParts.push(
      "",
      "⏰ <b>Час формування повідомлення:</b>",
      timestamp
    )

    text = messageParts.join("\n")
  } else {
    console.log("📝 Creating message for NO OUTAGES")
    text = [
      "🌅 <b>Доброго ранку!</b>",
      "",
      "✅ <b>Відмінні новини!</b>",
      "",
      "Планових відключень електроенергії на сьогодні не заплановано.",
      "",
      "⚡️ Можете планувати свій день без обмежень!",
      "",
      "⏰ <b>Час формування повідомлення:</b>",
      timestamp,
    ].join("\n")
  }

  console.log("🌀 Sending daily summary...")
  console.log("📄 Message preview:")
  console.log(text.split("\n").slice(0, 5).join("\n") + "...")

  try {
    const data = await sendTelegramMessage(text, {
      token: TELEGRAM_BOT_TOKEN,
      chatId: TELEGRAM_CHAT_ID,
    })

    console.log("🟢 Daily summary sent successfully!")
    console.log(`   Message ID: ${data.result?.message_id}`)
    if (data.result?.chat) {
      console.log(
        `   Chat: ${data.result.chat.first_name} ${data.result.chat.last_name || ""}`
      )
    }
    if (data.result?.date) {
      console.log(
        `   Timestamp: ${new Date(data.result.date * 1000).toLocaleString("uk-UA")}`
      )
    }

    return data
  } catch (error) {
    console.log("🔴 Daily summary not sent.", error.message)
    throw error
  }
}

async function run() {
  console.log("=" + "=".repeat(60))
  console.log("🚀 DTEK Daily Summary Script Started")
  console.log("=" + "=".repeat(60))
  console.log(`⏰ Current time: ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`)
  console.log("")

  try {
    const info = await getInfo()

    let outageData
    try {
      outageData = checkPlannedOutages(info)
    } catch (error) {
      console.error("❌ Error in checkPlannedOutages:", error)
      console.error("Stack trace:", error.stack)
      throw error
    }

    await sendDailySummary(info, outageData)

    console.log("")
    console.log("=" + "=".repeat(60))
    console.log("✅ Script completed successfully")
    console.log("=" + "=".repeat(60))
  } catch (error) {
    console.log("")
    console.log("=" + "=".repeat(60))
    console.error("❌ Script failed:", error.message)
    console.log("=" + "=".repeat(60))
    throw error
  }
}

// Only run if this is the main module
if (require.main === module) {
  run().catch((error) => {
    console.error("💥 Fatal error:", error)
    process.exitCode = 1
  })
}

// Export functions for testing
module.exports = {
  checkPlannedOutages,
  formatScheduleDescription,
  getDetailedTimeRange,
}
