require("dotenv").config()
const { chromium } = require("playwright")

const { CITY, STREET, HOUSE } = process.env

async function checkEmergencyPrompt() {
  console.log("🌀 Checking for emergency prompt...")

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

    // Fill in the form to get to house selection
    await browserPage.fill('input[name="city"]', CITY)
    await browserPage.waitForTimeout(1000)

    await browserPage.fill('input[name="street"]', STREET)
    await browserPage.waitForTimeout(1000)

    await browserPage.fill('input[name="houseNum"]', HOUSE)
    await browserPage.waitForTimeout(2000)

    // Check for emergency outage text on the page
    const pageContent = await browserPage.content()

    console.log("\n========== SEARCHING FOR EMERGENCY INDICATORS ==========")

    // Search for various emergency-related terms
    const searchTerms = [
      "Єкстренні відключення",
      "екстренн",
      "аварійн",
      "emergency",
      "УВАГА",
      "термінов"
    ]

    for (const term of searchTerms) {
      const regex = new RegExp(term, 'gi')
      const matches = pageContent.match(regex)
      if (matches) {
        console.log(`✅ Found "${term}": ${matches.length} occurrences`)
      } else {
        console.log(`❌ Not found: "${term}"`)
      }
    }

    // Try to find any emergency-related elements
    const emergencySelectors = [
      '.emergency',
      '.alert',
      '.warning',
      '[class*="emergency"]',
      '[class*="екстрен"]',
      '[class*="аварійн"]',
    ]

    console.log("\n========== CHECKING DOM ELEMENTS ==========")
    for (const selector of emergencySelectors) {
      const elements = await browserPage.$$(selector)
      if (elements.length > 0) {
        console.log(`✅ Found elements matching "${selector}": ${elements.length}`)
        for (let i = 0; i < Math.min(elements.length, 3); i++) {
          const text = await elements[i].textContent()
          console.log(`   Element ${i + 1}: ${text.substring(0, 100)}`)
        }
      }
    }

    // Get all visible text
    console.log("\n========== FULL PAGE TEXT (first 5000 chars) ==========")
    const bodyText = await browserPage.evaluate(() => document.body.innerText)
    console.log(bodyText.substring(0, 5000))

    console.log("\n✅ Check complete.")
  } catch (error) {
    console.error(`❌ Error: ${error.message}`)
  } finally {
    await browser.close()
  }
}

checkEmergencyPrompt().catch((error) => console.error(error.message))
