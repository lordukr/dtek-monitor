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

function checkImprovedEmergencyDetection(info) {
  console.log("\n========== IMPROVED EMERGENCY DETECTION ==========\n")

  const houseData = info?.data?.[HOUSE] || {}
  const { sub_type, start_date, end_date, type, sub_type_reason } = houseData

  console.log("House data:")
  console.log("  sub_type:", sub_type)
  console.log("  start_date:", start_date)
  console.log("  end_date:", end_date)
  console.log("  type:", type)
  console.log("  sub_type_reason:", sub_type_reason)

  // OLD LOGIC (current bot)
  const isScheduledOutageText = sub_type &&
    (sub_type.includes("графіку погодинних") ||
     sub_type.includes("Згідно графіку") ||
     sub_type.includes("According to"))

  const hasEmergencyOutageOld = !isScheduledOutageText && (
    (sub_type && sub_type !== "") ||
    (start_date && start_date !== "") ||
    (end_date && end_date !== "") ||
    (type && type !== "")
  )

  console.log("\n--- OLD LOGIC ---")
  console.log("isScheduledOutageText:", isScheduledOutageText)
  console.log("hasEmergencyOutage:", hasEmergencyOutageOld)

  // NEW LOGIC (proposed fix)
  // Check if emergency fields are populated
  const hasEmergencyFields =
    (sub_type && sub_type !== "") ||
    (start_date && start_date !== "") ||
    (end_date && end_date !== "") ||
    (type && type !== "")

  // Check if it's marked as according to schedule
  const markedAsScheduled = sub_type &&
    (sub_type.includes("графіку погодинних") ||
     sub_type.includes("Згідно графіку") ||
     sub_type.includes("According to"))

  // Check if type indicates emergency (type "2" seems to be emergency/stabilization)
  const isEmergencyType = type === "2" || type === "1"

  // OPTION 1: Treat type "2" as always emergency
  const hasEmergencyOption1 = hasEmergencyFields && isEmergencyType

  // OPTION 2: If emergency fields are populated and it's NOT explicitly about hourly schedule, it's emergency
  // UNLESS it says "Згідно графіку погодинних" which means it's referring to the schedule grid
  const hasEmergencyOption2 = hasEmergencyFields && !markedAsScheduled

  // OPTION 3: Type "2" or type "1" is ALWAYS treated as emergency regardless of text
  const hasEmergencyOption3 = isEmergencyType && hasEmergencyFields

  console.log("\n--- NEW LOGIC OPTIONS ---")
  console.log("hasEmergencyFields:", hasEmergencyFields)
  console.log("markedAsScheduled:", markedAsScheduled)
  console.log("isEmergencyType (type 1 or 2):", isEmergencyType)
  console.log("\nOPTION 1 (type 2 = emergency):", hasEmergencyOption1)
  console.log("OPTION 2 (not marked as scheduled):", hasEmergencyOption2)
  console.log("OPTION 3 (type 1/2 always emergency):", hasEmergencyOption3)

  console.log("\n========== RECOMMENDATION ==========")
  if (hasEmergencyOption1) {
    console.log("✅ This SHOULD be detected as EMERGENCY (type 2 indicates stabilization outage)")
    console.log("   Even though it mentions schedule, type '2' means it's an actual outage event")
  } else if (hasEmergencyOption2) {
    console.log("✅ This SHOULD be detected as EMERGENCY (emergency fields populated, not scheduled)")
  } else {
    console.log("❌ This appears to be a scheduled outage only")
  }
}

async function run() {
  const info = await getInfo()
  checkImprovedEmergencyDetection(info)
}

run().catch((error) => console.error(error.message))
