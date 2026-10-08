const { chromium } = require("playwright")

const SHUTDOWNS_URL = "https://www.dtek-krem.com.ua/ua/shutdowns"
const EMERGENCY_POPUP_TEXT = "Наразі діють екстрені відключення електроенергії"

async function getInfo({ city, street }) {
  console.log("🌀 Getting info...")

  const browser = await chromium.launch({ headless: true })
  const browserContext = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "uk-UA",
  })
  const browserPage = await browserContext.newPage()

  try {
    await browserPage.goto(SHUTDOWNS_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })

    // Wait for the page to be fully loaded and interactive
    await browserPage.waitForLoadState("networkidle", { timeout: 30000 })

    // Wait for bot protection to pass and page to fully render
    await browserPage.waitForTimeout(5000)

    // Wait for the main content to be visible
    await browserPage.waitForSelector(".form__input", { timeout: 10000 })

    const csrfTokenTag = await browserPage.waitForSelector(
      'meta[name="csrf-token"]',
      { state: "attached", timeout: 10000 }
    )
    const csrfToken = await csrfTokenTag.getAttribute("content")

    // Check for system-wide emergency popup
    const hasEmergencyPopup = await browserPage.evaluate((emergencyText) => {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      for (const dialog of dialogs) {
        const isVisible = dialog.offsetParent !== null
        const text = dialog.textContent || ""
        if (isVisible && text.includes(emergencyText)) {
          return true
        }
      }
      return false
    }, EMERGENCY_POPUP_TEXT)

    if (hasEmergencyPopup) {
      console.log("🚨 System-wide emergency popup detected!")
    }

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

        const text = await response.text()
        try {
          return JSON.parse(text)
        } catch (e) {
          throw new Error(
            `Failed to parse JSON. Status: ${response.status}, Response: ${text.substring(0, 500)}`
          )
        }
      },
      { CITY: city, STREET: street, csrfToken }
    )

    // Add emergency popup flag to response
    info.hasSystemWideEmergency = hasEmergencyPopup

    console.log("✅ Getting info finished.")
    return info
  } catch (error) {
    throw Error(`❌ Getting info failed: ${error.message}`)
  } finally {
    await browser.close()
  }
}

module.exports = { getInfo }
