/**
 * Test script to preview the new emergency message format
 * without actually sending it to Telegram
 */

require("dotenv").config()
const { chromium } = require("playwright")

const { CITY, STREET, HOUSE } = process.env

async function getInfo() {
  const browser = await chromium.launch({ headless: true })
  const browserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "uk-UA",
  })
  const browserPage = await browserContext.newPage()

  try {
    await browserPage.goto("https://www.dtek-krem.com.ua/ua/shutdowns", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })

    await browserPage.waitForLoadState("networkidle", { timeout: 30000 })
    await browserPage.waitForTimeout(5000)
    await browserPage.waitForSelector('.form__input', { timeout: 10000 })

    const csrfTokenTag = await browserPage.waitForSelector(
      'meta[name="csrf-token"]',
      { state: "attached", timeout: 10000 }
    )
    const csrfToken = await csrfTokenTag.getAttribute("content")

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

        const response = await fetch("/ua/ajax", {
          method: "POST",
          headers: {
            "x-requested-with": "XMLHttpRequest",
            "x-csrf-token": csrfToken,
          },
          body: formData,
        })

        return await response.json()
      },
      { CITY, STREET, csrfToken }
    )

    return info
  } finally {
    await browser.close()
  }
}

function checkOutage(info) {
  const houseData = info?.data?.[HOUSE] || {}
  const { sub_type, start_date, end_date, type, sub_type_reason } = houseData

  const isEmergencyOutageText = sub_type &&
    (sub_type.includes("Екстренні відключення") ||
     sub_type.includes("екстренн") ||
     sub_type.includes("Аварійне") ||
     sub_type.includes("аварійн") ||
     sub_type.includes("без застосування графіку"))

  const hasEmergencyOutage = isEmergencyOutageText && (
    (sub_type && sub_type !== "") ||
    (start_date && start_date !== "") ||
    (end_date && end_date !== "") ||
    (type && type !== "")
  )

  let emergencyOutage = null
  if (hasEmergencyOutage) {
    emergencyOutage = { sub_type, start_date, end_date, type }
  }

  return { emergencyOutage, info }
}

function formatEmergencyMessage(emergencyOutage, updateTimestamp) {
  const { sub_type, start_date, end_date } = emergencyOutage

  const now = new Date()
  const kyivTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })
  )

  let isActiveNow = false
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
      isActiveNow = kyivTime >= startTime && kyivTime < endTime

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

  const time = now.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  })
  const date = now.toLocaleDateString("uk-UA", {
    timeZone: "Europe/Kyiv",
  })
  const updateNotificationTimestamp = `${time} ${date}`

  const messageParts = [
    "🚨🚨🚨 ЕКСТРЕНЕ ВІДКЛЮЧЕННЯ! 🚨🚨🚨",
    "",
    isActiveNow ? "⚠️ ЗАРАЗ АКТИВНЕ!" : "⚠️ УВАГА! Аварійне відключення!",
    "",
    "ℹ️ Тип:",
    sub_type || "Невідомо",
    "",
    "🔴 Початок:",
    start_date || "Невідомо",
    "",
    "🟢 Очікуване відновлення:",
    end_date || "Невідомо"
  ]

  if (duration) {
    messageParts.push(
      "",
      "⏱ Тривалість:",
      duration
    )
  }

  messageParts.push(
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "⏰ Час оновлення інформації:",
    updateTimestamp || updateNotificationTimestamp,
    "⏰ Час оновлення повідомлення:",
    updateNotificationTimestamp
  )

  return messageParts.join("\n")
}

async function run() {
  console.log("🌀 Fetching current outage data...\n")
  const info = await getInfo()
  const { emergencyOutage } = checkOutage(info)

  if (emergencyOutage) {
    console.log("✅ Emergency outage detected!")
    console.log("\n" + "=".repeat(60))
    console.log("PREVIEW: NEW EMERGENCY MESSAGE FORMAT")
    console.log("=".repeat(60) + "\n")

    const message = formatEmergencyMessage(emergencyOutage, info.updateTimestamp)
    console.log(message)

    console.log("\n" + "=".repeat(60))
    console.log("\n✅ This is how the new message will look in Telegram")
  } else {
    console.log("❌ No emergency outage currently active")
  }
}

run().catch((error) => console.error(error.message))
