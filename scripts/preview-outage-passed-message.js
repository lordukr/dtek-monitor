/**
 * Test script to preview emergency outage-passed message format
 */

// Simulate emergency outage data
const emergencyOutagePassedInfo = {
  passedOutage: {
    sub_type: "Екстренні відключення (Аварійне без застосування графіку погодинних відключень)",
    start_date: "07:55 20.01.2026",
    end_date: "12:00 20.01.2026",
    type: "2"
  },
  isEmergency: true,
  nextOutage: {
    timeRange: "10:00-13:00",
    description: "Світла немає",
    status: "no"
  },
  queueGroup: "GPV1.2"
}

function formatEmergencyOutagePassedMessage(passedOutageInfo, updateTimestamp) {
  const { passedOutage, nextOutage, queueGroup, isEmergency } = passedOutageInfo

  const now = new Date()
  const time = now.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  })
  const date = now.toLocaleDateString("uk-UA", {
    timeZone: "Europe/Kyiv",
  })
  const updateNotificationTimestamp = `${time} ${date}`

  const messageParts = []

  // Handle emergency outage passed
  if (isEmergency) {
    const { sub_type, start_date, end_date } = passedOutage

    // Calculate duration for emergency
    let duration = ""
    if (start_date && end_date) {
      try {
        const parseDate = (dateStr) => {
          const [time, date] = dateStr.split(" ")
          const [hours, minutes] = time.split(":").map(Number)
          const [day, month, year] = date.split(".").map(Number)
          return new Date(year, month - 1, day, hours, minutes)
        }

        const startTime = parseDate(start_date)
        const endTime = parseDate(end_date)
        const durationMs = endTime - startTime
        const hours = Math.floor(durationMs / (1000 * 60 * 60))
        const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))

        if (hours > 0 && minutes > 0) {
          duration = `${hours} год ${minutes} хв`
        } else if (hours > 0) {
          duration = `${hours} год`
        } else {
          duration = `${minutes} хв`
        }
      } catch (error) {
        // ignore
      }
    }

    messageParts.push(
      "✅ Екстрене відключення завершено!",
      "",
      "ℹ️ Тип:",
      sub_type || "Невідомо",
      "",
      "🔴 Початок:",
      start_date || "Невідомо",
      "",
      "🟢 Завершено:",
      end_date || "Невідомо"
    )

    if (duration) {
      messageParts.push(
        "",
        "⏱ Тривалість:",
        duration
      )
    }
  }

  // Add next outage information if available
  if (nextOutage && nextOutage.timeRange) {
    const [startTime, endTime] = nextOutage.timeRange.split("-")
    const [startHour, startMin] = startTime.split(":").map(Number)
    const [endHour, endMin] = endTime.split(":").map(Number)

    const startInMinutes = startHour * 60 + startMin
    const endInMinutes = endHour * 60 + endMin
    const durationInMinutes = endInMinutes - startInMinutes

    const hours = Math.floor(durationInMinutes / 60)
    const minutes = durationInMinutes % 60

    let nextDuration = ""
    if (hours > 0 && minutes > 0) {
      nextDuration = `${hours} год ${minutes} хв`
    } else if (hours > 0) {
      nextDuration = `${hours} год`
    } else {
      nextDuration = `${minutes} хв`
    }

    messageParts.push(
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      "⏰ Наступне відключення",
      "",
      "🕐 Час:",
      nextOutage.timeRange,
      "",
      "⏱ Тривалість:",
      nextDuration
    )
  }

  messageParts.push(
    "",
    "⏰ Час оновлення інформації:",
    updateTimestamp || updateNotificationTimestamp,
    "",
    // "HH:MM DD.MM.YYYY" -> "HH:MM"
    `🔄 Оновлено о ${updateNotificationTimestamp.split(" ")[0]}`
  )

  return messageParts.join("\n")
}

console.log("=" .repeat(60))
console.log("PREVIEW: EMERGENCY OUTAGE-PASSED MESSAGE")
console.log("=".repeat(60) + "\n")

const message = formatEmergencyOutagePassedMessage(emergencyOutagePassedInfo, "08:18 20.01.2026")
console.log(message)

console.log("\n" + "=".repeat(60))
console.log("✅ This is the corrected message format")
console.log("=".repeat(60))
