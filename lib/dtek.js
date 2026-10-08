const BASE_URL = "https://www.dtek-krem.com.ua"
const PAGE_URL = BASE_URL + "/ua/shutdowns"
const AJAX_URL = BASE_URL + "/ua/ajax"
const REQUEST_TIMEOUT_MS = 30_000
const MAX_PAGE_CHARS = 5_000_000
const ERROR_PREFIX = "❌ Getting info failed: "

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

function createDefaultClient() {
  // Lazy: impit and tough-cookie never load in tests.
  const { Impit } = require("impit")
  const { CookieJar } = require("tough-cookie")
  // Exactly these two options; TLS verification is never disabled. One client per call.
  return new Impit({ browser: "chrome", cookieJar: new CookieJar() })
}

// Covers impit TimeoutError and its subclasses ConnectTimeout/ReadTimeout/WriteTimeout/PoolTimeout.
const isTimeoutError = (err) =>
  /timeout/i.test(err?.name ?? "") || /timeout/i.test(err?.constructor?.name ?? "")

async function callClient(client, url, init, label, timeoutMs) {
  try {
    const res = await client.fetch(url, init)
    // The body is read inside the same classification, so a stalled or reset body is labelled.
    return { status: res.status, text: await res.text() }
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(`${label} timed out after ${timeoutMs / 1000}s`, { cause: err })
    }
    throw new Error(`${label} network error (${err?.name}): ${err?.message}`, { cause: err })
  }
}

function pageTitle(html) {
  const i = html.search(/<title\b/i)
  if (i === -1) return ""
  const gt = html.indexOf(">", i)
  if (gt === -1) return ""
  const end = html.indexOf("<", gt + 1)
  return excerpt(html.slice(gt + 1, end === -1 ? gt + 1001 : Math.min(end, gt + 1001)), 120)
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchInfo(
  { city, street },
  { client, timeoutMs = REQUEST_TIMEOUT_MS, now = () => new Date() } = {}
) {
  console.log("🌀 Getting info...")
  try {
    client = client ?? createDefaultClient()

    const { status, text: html } = await callClient(
      client,
      PAGE_URL,
      { method: "GET", headers: { "Accept-Language": "uk-UA" }, timeout: timeoutMs },
      "page GET",
      timeoutMs
    )

    if (html.length > MAX_PAGE_CHARS) {
      throw new Error(`Page GET returned oversized body (HTTP ${status}, ${html.length} chars)`)
    }
    const title = pageTitle(html)
    const T = title ? `; title: ${title}` : ""
    const token = extractCsrfToken(html)
    if (!token && isIncapsulaChallenge(html)) {
      const incident = excerpt((/incident ID:?\s*([\w-]{1,64})/i.exec(html) || [])[1] ?? "", 64)
      const I = incident ? `; incident ID ${incident}` : ""
      throw new Error(
        `Blocked by Incapsula on page GET (HTTP ${status}, ${html.length} bytes): ` +
          `challenge or block page returned instead of the shutdowns page${I}${T}`
      )
    }
    if (status < 200 || status > 299) {
      throw new Error(`Page GET failed: HTTP ${status}: ${excerpt(html)}`)
    }
    if (!token) {
      throw new Error(`CSRF token not found on page (HTTP ${status}, ${html.length} bytes)${T}`)
    }

    const modalText = extractAttentionModalText(html)
    const hasSystemWideEmergency = detectSystemWideEmergency(html)
    if (hasSystemWideEmergency) {
      console.log("🚨 System-wide emergency popup detected!")
    } else if (modalText !== null) {
      console.log(`ℹ️ modal-attention present, no emergency wording: ${excerpt(modalText, 120)}`)
    }

    const res = await callClient(
      client,
      AJAX_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
          "x-csrf-token": token,
        },
        body: buildAjaxBody({ city, street, updateFact: now().toLocaleString("uk-UA") }),
        timeout: timeoutMs,
      },
      "AJAX POST",
      timeoutMs
    )

    const info = parseAjaxResponse(res.status, res.text)
    info.hasSystemWideEmergency = hasSystemWideEmergency
    console.log("✅ Getting info finished.")
    return info
  } catch (error) {
    throw new Error(ERROR_PREFIX + error.message, { cause: error })
  }
}

const getInfo = async ({ city, street }) => fetchInfo({ city, street })

module.exports = {
  getInfo,
  fetchInfo,
  extractCsrfToken,
  isIncapsulaChallenge,
  extractAttentionModalText,
  detectSystemWideEmergency,
  buildAjaxBody,
  parseAjaxResponse,
}
