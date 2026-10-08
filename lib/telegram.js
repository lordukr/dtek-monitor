const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Call a Telegram Bot API method.
 * Retries on network errors, 429 (respecting retry_after) and 5xx responses.
 * Other 4xx errors are thrown immediately. Throws after retries are exhausted.
 *
 * @param {string} method e.g. "sendMessage"
 * @param {object} payload request body (chat_id is added automatically)
 * @param {{token: string, chatId: string, retries?: number, backoffMs?: number, sleep?: (ms: number) => Promise<void>}} options
 * @returns {Promise<object>} Telegram API response (data.ok === true)
 */
async function callTelegram(
  method,
  payload,
  { token, chatId, retries = 3, backoffMs = 2000, sleep = defaultSleep } = {}
) {
  if (!token) throw Error("❌ Missing telegram bot token.")
  if (!chatId) throw Error("❌ Missing telegram chat id.")

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    let waitMs = backoffMs * 2 ** attempt

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, ...payload }),
      })

      const data = await res.json()
      if (data?.ok) return data

      const code = data?.error_code ?? res.status
      const description = data?.description || `HTTP ${res.status}`
      lastError = new Error(`Telegram error ${code}: ${description}`)

      const retryable = code === 429 || code >= 500
      if (!retryable) throw Object.assign(lastError, { fatal: true })

      const retryAfter = data?.parameters?.retry_after
      if (code === 429 && retryAfter) waitMs = retryAfter * 1000
    } catch (error) {
      if (error.fatal) throw error
      lastError = error
    }

    if (attempt < retries) {
      console.log(
        `🔴 Telegram ${method} failed (${lastError.message}). Retry ${attempt + 1}/${retries} in ${waitMs} ms...`
      )
      await sleep(waitMs)
    }
  }

  throw lastError
}

/**
 * Send a Telegram message (HTML parse mode).
 */
async function sendTelegramMessage(text, options = {}) {
  return callTelegram("sendMessage", { text, parse_mode: "HTML" }, options)
}

/**
 * Replace the text of a previously sent message (HTML parse mode).
 */
async function editTelegramMessage(messageId, text, options = {}) {
  return callTelegram(
    "editMessageText",
    { message_id: messageId, text, parse_mode: "HTML" },
    options
  )
}

module.exports = { sendTelegramMessage, editTelegramMessage }
