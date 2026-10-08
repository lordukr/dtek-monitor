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

const META_TAG_RE = /<meta\b[^<>]*>/gi
const CSRF_NAME_RE = /\bname\s*=\s*["']csrf-token["']/i
const CONTENT_RE = /\bcontent\s*=\s*["']([^"']*)["']/i
const INCAPSULA_RE = /_Incapsula_Resource|Incapsula incident ID/

function extractCsrfToken(html) {
  if (typeof html !== "string") return null
  for (const tag of html.matchAll(META_TAG_RE)) {
    if (!CSRF_NAME_RE.test(tag[0])) continue
    const content = CONTENT_RE.exec(tag[0])
    if (!content) continue
    const token = content[1].trim()
    if (token) return token
  }
  return null
}

function isIncapsulaChallenge(html) {
  return (
    typeof html === "string" &&
    INCAPSULA_RE.test(html) &&
    extractCsrfToken(html) === null
  )
}

const EMERGENCY_STEM = "екстрен"
const MODAL_FALLBACK_CHARS = 10_000
const MODAL_MAX_CANDIDATES = 20
const MODAL_MAX_TAG_CHARS = 2000
const MODAL_DIV_RE = /^<div\b[^<>]*\bid\s*=\s*["']modal-attention["'][^<>]*>$/i

function stripScriptsStylesComments(text) {
  const openRe = /<script\b|<style\b|<!--/gi
  let out = ""
  let pos = 0
  for (;;) {
    openRe.lastIndex = pos
    const m = openRe.exec(text)
    if (!m) return out + text.slice(pos)
    out += text.slice(pos, m.index)
    const opener = m[0].toLowerCase()
    let end
    if (opener === "<!--") {
      end = text.indexOf("-->", m.index)
      if (end !== -1) end += 3
    } else {
      const closeRe = opener === "<script" ? /<\/script\s*>/gi : /<\/style\s*>/gi
      closeRe.lastIndex = m.index
      const c = closeRe.exec(text)
      end = c ? closeRe.lastIndex : -1
    }
    if (end === -1) return out
    pos = end
  }
}

function boundDivBlock(stripped) {
  const re = /<div\b|<\/div\s*>/gi
  let depth = 0
  let m
  while ((m = re.exec(stripped))) {
    if (m[0][1] === "/") depth--
    else depth++
    if (depth <= 0) return stripped.slice(0, re.lastIndex)
  }
  return stripped.slice(0, MODAL_FALLBACK_CHARS)
}

function decodeCodePoint(whole, digits, radix) {
  const cp = parseInt(digits, radix)
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole
}

function extractAttentionModalText(html) {
  if (typeof html !== "string") return null
  let lt = -1
  let from = 0
  for (let n = 0; n < MODAL_MAX_CANDIDATES; n++) {
    const i = html.indexOf("modal-attention", from)
    if (i === -1) break
    from = i + 1
    const start = html.lastIndexOf("<", i)
    if (start === -1 || html.lastIndexOf(">", i) > start) continue
    const gt = html.indexOf(">", i)
    if (gt === -1 || gt - start > MODAL_MAX_TAG_CHARS) continue
    if (MODAL_DIV_RE.test(html.slice(start, gt + 1))) {
      lt = start
      break
    }
  }
  if (lt === -1) return null
  const block = boundDivBlock(stripScriptsStylesComments(html.slice(lt)))
  return block
    .replace(/<[^<>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d{1,8});/g, (w, d) => decodeCodePoint(w, d, 10))
    .replace(/&#x([0-9a-f]{1,8});/gi, (w, d) => decodeCodePoint(w, d, 16))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}

function detectSystemWideEmergency(html) {
  const text = extractAttentionModalText(html)
  return text !== null && text.toLowerCase().includes(EMERGENCY_STEM)
}

const excerpt = (text, max = 500) =>
  String(text).slice(0, max).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")

function buildAjaxBody({ city, street, updateFact }) {
  return new URLSearchParams([
    ["method", "getHomeNum"],
    ["data[0][name]", "city"],
    ["data[0][value]", city],
    ["data[1][name]", "street"],
    ["data[1][value]", street],
    ["data[2][name]", "updateFact"],
    ["data[2][value]", updateFact],
  ]).toString()
}

function parseAjaxResponse(status, text) {
  if (status < 200 || status > 299) {
    throw Error(`AJAX POST failed: HTTP ${status}: ${excerpt(text)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    parsed = null
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw Error(`AJAX POST returned non-JSON (HTTP ${status}): ${excerpt(text)}`)
  }
  return parsed
}

module.exports = {
  getInfo,
  extractCsrfToken,
  isIncapsulaChallenge,
  extractAttentionModalText,
  detectSystemWideEmergency,
  buildAjaxBody,
  parseAjaxResponse,
}
