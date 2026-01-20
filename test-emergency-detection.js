require("dotenv").config()
const { chromium } = require("playwright")

const { CITY, STREET, HOUSE } = process.env

async function getInfo() {
  console.log("🌀 Getting info...")

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

    console.log("✅ Getting info finished.")
    return info
  } catch (error) {
    throw Error(`❌ Getting info failed: ${error.message}`)
  } finally {
    await browser.close()
  }
}

async function run() {
  const info = await getInfo()

  console.log("\n========== RAW DATA FROM WEBSITE ==========")
  console.log(JSON.stringify(info, null, 2))

  console.log("\n========== HOUSE DATA ==========")
  const houseData = info?.data?.[HOUSE] || {}
  console.log(JSON.stringify(houseData, null, 2))

  console.log("\n========== EMERGENCY OUTAGE FIELDS ==========")
  console.log("sub_type:", houseData.sub_type)
  console.log("start_date:", houseData.start_date)
  console.log("end_date:", houseData.end_date)
  console.log("type:", houseData.type)
  console.log("sub_type_reason:", houseData.sub_type_reason)

  // Check if this is a scheduled outage text
  const isScheduledOutageText = houseData.sub_type &&
    (houseData.sub_type.includes("графіку погодинних") ||
     houseData.sub_type.includes("Згідно графіку") ||
     houseData.sub_type.includes("According to"))

  console.log("\n========== DETECTION LOGIC ==========")
  console.log("isScheduledOutageText:", isScheduledOutageText)
  console.log("Has sub_type:", !!(houseData.sub_type && houseData.sub_type !== ""))
  console.log("Has start_date:", !!(houseData.start_date && houseData.start_date !== ""))
  console.log("Has end_date:", !!(houseData.end_date && houseData.end_date !== ""))
  console.log("Has type:", !!(houseData.type && houseData.type !== ""))

  const hasEmergencyOutage = !isScheduledOutageText && (
    (houseData.sub_type && houseData.sub_type !== "") ||
    (houseData.start_date && houseData.start_date !== "") ||
    (houseData.end_date && houseData.end_date !== "") ||
    (houseData.type && houseData.type !== "")
  )

  console.log("\nhasEmergencyOutage:", hasEmergencyOutage)
}

run().catch((error) => console.error(error.message))
