#!/usr/bin/env node
/**
 * Analyze the DTEK attention popup (#modal-attention) and say whether it
 * reports an emergency in effect (the same check monitor.js uses).
 *
 * Usage:
 *   node scripts/analyze-popup.js --live          # fetch the popup from the DTEK site
 *   node scripts/analyze-popup.js "popup text"    # classify the given text
 *   echo "popup text" | node scripts/analyze-popup.js
 *
 * Exit code: 2 if critical, 0 otherwise (1 on errors).
 */
const { extractAttentionModalText, classifyAttentionText } = require("../lib/dtek")

const PAGE_URL = "https://www.dtek-krem.com.ua/ua/shutdowns"

const VERDICTS = {
  critical: "🚨 CRITICAL: an emergency is in effect",
  warning: "⚠️ WARNING: an emergency is possible, not in effect",
  normal: "✅ NOT CRITICAL: no emergency in effect",
}

async function fetchPopupText() {
  // Same client setup as lib/dtek.js (Chrome TLS fingerprint + cookies)
  const { Impit } = require("impit")
  const { CookieJar } = require("tough-cookie")
  const client = new Impit({ browser: "chrome", cookieJar: new CookieJar() })
  const res = await client.fetch(PAGE_URL, {
    method: "GET",
    headers: { "Accept-Language": "uk-UA" },
    timeout: 30_000,
  })
  const html = await res.text()
  if (res.status < 200 || res.status > 299) throw Error(`HTTP ${res.status}`)
  return extractAttentionModalText(html)
}

async function readStdin() {
  let data = ""
  for await (const chunk of process.stdin) data += chunk
  return data
}

async function main() {
  const args = process.argv.slice(2)
  let text
  if (args[0] === "--live") {
    text = await fetchPopupText()
    if (text === null) console.log("ℹ️ No attention popup on the page.")
  } else if (args.length) {
    text = args.join(" ")
  } else if (!process.stdin.isTTY) {
    text = await readStdin()
  } else {
    console.log('Usage: node scripts/analyze-popup.js --live | "popup text" | < file')
    process.exitCode = 1
    return
  }

  const { level, reasons } = classifyAttentionText(text)
  if (text) console.log(`📝 Popup text:\n${text.trim()}\n`)
  console.log(VERDICTS[level])
  for (const reason of reasons) console.log(`   • ${reason}`)
  process.exitCode = level === "critical" ? 2 : 0
}

main().catch((error) => {
  console.error("💥", error.message)
  process.exitCode = 1
})
