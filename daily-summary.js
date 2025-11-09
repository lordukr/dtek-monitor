require("dotenv").config()
const { chromium } = require("playwright")

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CITY, STREET, HOUSE } =
  process.env

async function getInfo() {
  console.log("🌀 Getting info...")

  const browser = await chromium.launch({ headless: true })
  const browserContext = await browser.newContext()
  const browserPage = await browserContext.newPage()

  try {
    await browserPage.goto("https://www.dtek-krem.com.ua/ua/shutdowns", {
      waitUntil: "networkidle",
    })

    const csrfTokenTag = await browserPage.waitForSelector(
      'meta[name="csrf-token"]',
      { state: "attached" }
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

    console.log("✅ Getting info finished.")
    return info
  } catch (error) {
    throw Error(`❌ Getting info failed: ${error.message}`)
  } finally {
    await browser.close()
  }
}

function checkPlannedOutages(info) {
  console.log("🌀 Checking planned outages for today...")

  if (!info?.data) {
    throw Error("❌ Power outage info missed.")
  }

  const houseData = info?.data?.[HOUSE]
  console.log("📊 House data:", JSON.stringify(houseData, null, 2))

  const { sub_type, start_date, end_date, type } = houseData || {}

  // Check if any field has a non-empty value
  const hasOutageInfo =
    (sub_type && sub_type !== "") ||
    (start_date && start_date !== "") ||
    (end_date && end_date !== "") ||
    (type && type !== "")

  console.log("🔍 Outage fields:", { sub_type, start_date, end_date, type })
  console.log("🎯 Has outage info:", hasOutageInfo)

  if (hasOutageInfo) {
    console.log("📋 Planned outage information found!")
    return {
      hasOutage: true,
      sub_type,
      start_date,
      end_date,
      type,
    }
  } else {
    console.log("✅ No planned outages for today!")
    return {
      hasOutage: false,
    }
  }
}

async function sendDailySummary(info, outageData) {
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
    const { sub_type, start_date, end_date } = outageData
    text = [
      "🌅 <b>Доброго ранку!</b>",
      "",
      "📋 <b>Інформація про відключення на сьогодні:</b>",
      "",
      "⚠️ <b>Статус:</b>",
      "Заплановане відключення",
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
    console.log("🟢 Daily summary sent.", data)
  } catch (error) {
    console.log("🔴 Daily summary not sent.", error.message)
    throw error
  }
}

async function run() {
  const info = await getInfo()
  const outageData = checkPlannedOutages(info)
  await sendDailySummary(info, outageData)
}

run().catch((error) => console.error(error.message))
