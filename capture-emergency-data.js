/**
 * RUN THIS SCRIPT WHEN AN EMERGENCY OUTAGE OCCURS
 *
 * This will capture the exact API response data from DTEK
 * so we can understand what emergency outages look like
 * and fix the detection logic.
 *
 * Usage: node capture-emergency-data.js
 */

require("dotenv").config()
const { chromium } = require("playwright")
const fs = require("fs")
const path = require("path")

const { CITY, STREET, HOUSE } = process.env

async function getInfo() {
  console.log("🌀 Fetching current outage data from DTEK...")

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

async function captureEmergencyData() {
  const info = await getInfo()
  const houseData = info?.data?.[HOUSE] || {}

  console.log("\n" + "=".repeat(60))
  console.log("EMERGENCY OUTAGE DATA CAPTURED")
  console.log("=".repeat(60))
  console.log("\nTimestamp:", new Date().toISOString())
  console.log("\nHouse Data for", HOUSE + ":")
  console.log(JSON.stringify(houseData, null, 2))

  // Save to file
  const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0]
  const filename = `emergency-capture-${timestamp}.json`
  const filepath = path.join(__dirname, "artifacts", filename)

  fs.mkdirSync(path.dirname(filepath), { recursive: true })
  fs.writeFileSync(filepath, JSON.stringify({
    timestamp: new Date().toISOString(),
    houseNumber: HOUSE,
    houseData,
    fullResponse: info
  }, null, 2))

  console.log("\n✅ Data saved to:", filename)
  console.log("\n" + "=".repeat(60))
  console.log("PLEASE SHARE THIS DATA:")
  console.log("=".repeat(60))
  console.log("\nCopy the JSON above and share it so we can fix the detection logic.")
  console.log("File location:", filepath)
  console.log("\n" + "=".repeat(60))
}

captureEmergencyData().catch((error) => console.error("❌ Error:", error.message))
