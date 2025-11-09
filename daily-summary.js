require("dotenv").config()
const { chromium } = require("playwright")

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CITY, STREET, HOUSE } =
  process.env

async function getInfo() {
  console.log("🌀 Getting info...")
  console.log("📍 Address details:")
  console.log(`   City: ${CITY}`)
  console.log(`   Street: ${STREET}`)
  console.log(`   House: ${HOUSE}`)

  const browser = await chromium.launch({ headless: true })
  const browserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "uk-UA",
  })
  const browserPage = await browserContext.newPage()

  try {
    console.log("🌐 Opening DTEK website...")
    await browserPage.goto("https://www.dtek-krem.com.ua/ua/shutdowns", {
      waitUntil: "networkidle",
      timeout: 60000,
    })
    console.log("✅ Page loaded successfully")

    // Wait a bit for any bot protection to pass
    console.log("⏳ Waiting for page to fully load...")
    await browserPage.waitForTimeout(3000)

    console.log("🔑 Looking for CSRF token...")
    const csrfTokenTag = await browserPage.waitForSelector(
      'meta[name="csrf-token"]',
      { state: "attached" }
    )
    const csrfToken = await csrfTokenTag.getAttribute("content")
    console.log(`✅ CSRF token found: ${csrfToken.substring(0, 20)}...`)

    console.log("📡 Sending AJAX request to DTEK API...")
    const info = await browserPage.evaluate(
      async ({ CITY, STREET, csrfToken }) => {
        const formData = new URLSearchParams()
        formData.append("method", "getHomeNum")
        formData.append("data[0][name]", "city")
        formData.append("data[0][value]", CITY)
        formData.append("data[1][name]", "street")
        formData.append("data[1][value]", STREET)
        formData.append("data[2][name]", "updateFact")
        formData.append("data[2][value]", new Date().toLocaleString("uk-UA"))

        console.log("📤 Request params:", { CITY, STREET })

        const response = await fetch("/ua/ajax", {
          method: "POST",
          headers: {
            "x-requested-with": "XMLHttpRequest",
            "x-csrf-token": csrfToken,
          },
          body: formData,
        })

        const text = await response.text()
        console.log("📡 Response status:", response.status)
        console.log("📡 Response text preview:", text.substring(0, 200))

        try {
          const json = JSON.parse(text)
          console.log("✅ JSON parsed successfully")
          console.log("📦 Response data keys:", Object.keys(json))
          return json
        } catch (e) {
          throw new Error(
            `Failed to parse JSON. Status: ${response.status}, Response: ${text.substring(0, 500)}`
          )
        }
      },
      { CITY, STREET, csrfToken }
    )

    console.log("✅ Getting info finished.")
    console.log("📦 Full API response:", JSON.stringify(info, null, 2))
    return info
  } catch (error) {
    throw Error(`❌ Getting info failed: ${error.message}`)
  } finally {
    await browser.close()
  }
}

function checkPlannedOutages(info) {
  console.log("🌀 Checking planned outages for today...")
  console.log("🔍 Info object structure check:")
  console.log(`   - info exists: ${!!info}`)
  console.log(`   - info.data exists: ${!!info?.data}`)
  console.log(`   - info.preset exists: ${!!info?.preset}`)
  console.log(`   - info.fact exists: ${!!info?.fact}`)

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

  if (hasEmergencyOutage) {
    console.log("🚨 Emergency/Active outage detected!")
    return {
      hasOutage: true,
      isEmergency: true,
      sub_type,
      start_date,
      end_date,
      type,
    }
  }

  // Check for scheduled outages in preset/fact data
  console.log("📅 Checking schedule data...")

  if (!info.preset?.data || !info.fact?.data || !sub_type_reason) {
    console.log("⚠️ No schedule data available")
    return { hasOutage: false }
  }

  const queueGroup = sub_type_reason[0] // e.g., "GPV1.2"
  console.log(`🔢 House queue group: ${queueGroup}`)

  // Calculate today's timestamp - convert current date to Unix timestamp (start of day in Kyiv timezone)
  // This is critical because GitHub Actions runs in UTC, but we need Kyiv time
  // Example: 23:00 UTC on Nov 9 = 01:00 on Nov 10 in Kyiv (UTC+2), so we need Nov 10's data
  const now = new Date()

  // Get the date components in Kyiv timezone using Intl.DateTimeFormat
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const parts = formatter.formatToParts(now)
  const year = parseInt(parts.find((p) => p.type === "year").value)
  const month = parseInt(parts.find((p) => p.type === "month").value) - 1 // JS months are 0-indexed
  const day = parseInt(parts.find((p) => p.type === "day").value)

  // Create date for start of day in UTC, then adjust for Kyiv timezone
  // Kyiv is UTC+2 in winter, UTC+3 in summer
  const startOfDayUTC = Date.UTC(year, month, day, 0, 0, 0, 0)

  // Get the offset between UTC and Kyiv for this date
  const tempDate = new Date(startOfDayUTC)
  const kyivOffset = new Date(
    tempDate.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })
  ).getTime()
  const utcTime = new Date(
    tempDate.toLocaleString("en-US", { timeZone: "UTC" })
  ).getTime()
  const offset = utcTime - kyivOffset

  // Apply offset to get the correct timestamp for start of day in Kyiv
  const todayTimestamp = Math.floor((startOfDayUTC + offset) / 1000)

  console.log(`📆 API's today timestamp: ${info.fact?.today}`)
  console.log(
    `   (API date: ${new Date(info.fact?.today * 1000).toLocaleDateString("uk-UA")})`
  )
  console.log(`📆 Calculated today's timestamp: ${todayTimestamp}`)
  console.log(
    `   (Calculated date: ${new Date(todayTimestamp * 1000).toLocaleDateString("uk-UA")})`
  )
  console.log(`📆 Current Kyiv date: ${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`)

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
    // BUT: "first" and "second" statuses should NOT be combined with adjacent "no" or "maybe" slots
    const periods = []
    let currentPeriod = null

    outageSlots.forEach((slot) => {
      if (!currentPeriod) {
        currentPeriod = { start: slot.hour, end: slot.hour, slots: [slot] }
      } else if (slot.hour === currentPeriod.end + 1) {
        const lastSlot = currentPeriod.slots[currentPeriod.slots.length - 1]

        // Check if we should split the period:
        // - If last slot was "first", don't combine with next slot
        // - If last slot was "second", don't combine with next slot
        // - If current slot is "second", don't combine with previous period
        const shouldSplit =
          lastSlot.status === "first" ||
          lastSlot.status === "second" ||
          slot.status === "second"

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

    return {
      hasOutage: true,
      isEmergency: false,
      queueGroup,
      outageSlots,
      periods,
      scheduleDescription: formatScheduleDescription(periods, timeZones),
    }
  }

  console.log("✅ No planned outages for today!")
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

    if (outageData.isEmergency) {
      // Emergency outage with specific times
      const { sub_type, start_date, end_date } = outageData
      text = [
        "🌅 <b>Доброго ранку!</b>",
        "",
        "🚨 <b>УВАГА! Аварійне відключення!</b>",
        "",
        "ℹ️ <b>Причина:</b>",
        (sub_type || "Невідома") + ".",
        "",
        "🔴 <b>Час початку:</b>",
        start_date || "Невідомий",
        "",
        "🟢 <b>Час відновлення:</b>",
        end_date || "Невідомий",
        "",
        "⏰ <b>Час формування повідомлення:</b>",
        timestamp,
      ].join("\n")
    } else {
      // Scheduled outage with time periods
      const { scheduleDescription, queueGroup, periods } = outageData
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

      text = [
        "🌅 <b>Доброго ранку!</b>",
        "",
        "⚠️ <b>На сьогодні заплановані відключення</b>",
        "",
        "📊 <b>Черга:</b>",
        queueGroup,
        "",
        "⏰ <b>Періоди відключення:</b>",
        periodDetails,
        "",
        "💡 <b>Порада:</b>",
        "Зарядіть пристрої та підготуйтеся заздалегідь",
        "",
        "⏰ <b>Час формування повідомлення:</b>",
        timestamp,
      ].join("\n")
    }
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
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
        }),
      }
    )

    const data = await res.json()

    if (data.ok) {
      console.log("🟢 Daily summary sent successfully!")
      console.log(`   Message ID: ${data.result.message_id}`)
      console.log(`   Chat: ${data.result.chat.first_name} ${data.result.chat.last_name || ''}`)
      console.log(`   Timestamp: ${new Date(data.result.date * 1000).toLocaleString('uk-UA')}`)
    } else {
      console.log("⚠️ Telegram API returned error:", data)
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
    console.error("💥 Fatal error:", error.message)
    process.exit(1)
  })
}

// Export functions for testing
module.exports = {
  checkPlannedOutages,
  formatScheduleDescription,
  getDetailedTimeRange,
}
