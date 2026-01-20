require("dotenv").config()
const { chromium } = require("playwright")

async function investigatePopup() {
  console.log("🌀 Investigating emergency popup on DTEK website...")

  const browser = await chromium.launch({ headless: false }) // Use headless: false to see what's happening
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

    console.log("\n========== SEARCHING FOR EMERGENCY POPUP ==========\n")

    // Search for modal/popup elements
    const popupSelectors = [
      '.modal',
      '.popup',
      '[role="dialog"]',
      '[role="alert"]',
      '.alert',
      '.notification',
      '[class*="modal"]',
      '[class*="popup"]',
      '[class*="dialog"]',
      '[id*="modal"]',
      '[id*="popup"]',
    ]

    for (const selector of popupSelectors) {
      const elements = await browserPage.$$(selector)
      if (elements.length > 0) {
        console.log(`\n✅ Found ${elements.length} elements matching: ${selector}`)
        for (let i = 0; i < Math.min(elements.length, 3); i++) {
          const isVisible = await elements[i].isVisible()
          const text = await elements[i].textContent()
          const html = await elements[i].innerHTML()

          console.log(`\n--- Element ${i + 1} ---`)
          console.log(`Visible: ${isVisible}`)
          console.log(`Text (first 200 chars): ${text.substring(0, 200)}`)
          if (text.includes("екстрен") || text.includes("Екстрен") || text.includes("аварійн")) {
            console.log(`🚨 EMERGENCY TEXT FOUND!`)
            console.log(`Full text: ${text}`)
            console.log(`HTML (first 500 chars): ${html.substring(0, 500)}`)
          }
        }
      }
    }

    // Search for text containing emergency keywords
    console.log("\n\n========== SEARCHING FOR EMERGENCY TEXT ==========\n")

    const emergencyKeywords = [
      "Єкстренні відключення",
      "екстренн",
      "Наразі діють екстрен",
      "Графіки відключень при цьому не діють"
    ]

    for (const keyword of emergencyKeywords) {
      try {
        const element = await browserPage.locator(`text="${keyword}"`).first()
        const count = await browserPage.locator(`text="${keyword}"`).count()

        if (count > 0) {
          console.log(`\n✅ Found "${keyword}" (${count} occurrences)`)

          const text = await element.textContent()
          const parent = await element.locator('xpath=..').first()
          const parentClass = await parent.getAttribute('class')
          const parentId = await parent.getAttribute('id')

          console.log(`  Text: ${text}`)
          console.log(`  Parent class: ${parentClass}`)
          console.log(`  Parent id: ${parentId}`)
        }
      } catch (error) {
        // Element not found
      }
    }

    // Get page screenshot
    await browserPage.screenshot({ path: 'artifacts/emergency-popup-screenshot.png', fullPage: true })
    console.log("\n📸 Screenshot saved to: artifacts/emergency-popup-screenshot.png")

    // Wait a bit to see the page
    console.log("\n⏳ Waiting 10 seconds for manual inspection...")
    await browserPage.waitForTimeout(10000)

  } catch (error) {
    console.error(`❌ Error: ${error.message}`)
  } finally {
    await browser.close()
  }
}

investigatePopup().catch((error) => console.error(error.message))
