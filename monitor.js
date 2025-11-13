require("dotenv").config()
const { chromium } = require("playwright")
const fs = require("fs")
const path = require("path")

const LAST_MESSAGE_FILE = path.resolve("artifacts", `last-message.json`)
const MESSAGE_HISTORY_FILE = path.resolve("artifacts", `message-history.json`)

const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CITY, STREET, HOUSE } =
  process.env

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

    // Wait for the page to be fully loaded and interactive
    await browserPage.waitForLoadState("networkidle", { timeout: 30000 })

    // Wait for bot protection to pass and page to fully render
    await browserPage.waitForTimeout(5000)

    // Wait for the main content to be visible
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

function checkOutage(info) {
  console.log("🌀 Checking power outage...")

  if (!info?.data) {
    throw Error("❌ Power outage info missed.")
  }

  const houseData = info?.data?.[HOUSE] || {}
  const { sub_type, start_date, end_date, type, sub_type_reason } = houseData

  // Check for immediate/emergency outages
  const hasEmergencyOutage =
    (sub_type && sub_type !== "") ||
    (start_date && start_date !== "") ||
    (end_date && end_date !== "") ||
    (type && type !== "")

  let emergencyOutage = null
  if (hasEmergencyOutage) {
    console.log("🚨 Emergency/Active outage detected!")
    emergencyOutage = {
      sub_type,
      start_date,
      end_date,
      type,
    }
  }

  // Check for scheduled outages
  let nextScheduledOutage = null
  if (info.preset?.data && info.fact?.data && sub_type_reason) {
    nextScheduledOutage = findNextScheduledOutage(info, sub_type_reason)
  }

  const isOutageDetected = hasEmergencyOutage || nextScheduledOutage !== null

  isOutageDetected
    ? console.log("🚨 Power outage detected!")
    : console.log("⚡️ No power outage!")

  return {
    isOutageDetected,
    emergencyOutage,
    nextScheduledOutage,
  }
}

function findNextScheduledOutage(info, sub_type_reason) {
  const queueGroup = sub_type_reason[0] // e.g., "GPV1.2"
  console.log(`🔢 House queue group: ${queueGroup}`)

  // Get current time in Kyiv timezone
  const now = new Date()
  const kyivTime = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/Kyiv" })
  )
  const currentHour = kyivTime.getHours()
  const currentMinute = kyivTime.getMinutes()
  const currentTimeInMinutes = currentHour * 60 + currentMinute

  console.log(
    `⏰ Current Kyiv time: ${String(currentHour).padStart(2, "0")}:${String(currentMinute).padStart(2, "0")}`
  )

  // Calculate today's timestamp using UTC date
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const day = now.getUTCDate()
  const todayTimestamp = Math.floor(Date.UTC(year, month, day, 0, 0, 0, 0) / 1000)

  // Try to get schedule for today
  let todaySchedule = info.fact?.data?.[todayTimestamp]?.[queueGroup]

  // Fallback to API's timestamp if not found
  if (!todaySchedule && info.fact?.today) {
    todaySchedule = info.fact?.data?.[info.fact.today]?.[queueGroup]
  }

  if (!todaySchedule) {
    console.log(`⚠️ No schedule found for queue ${queueGroup}`)
    return null
  }

  // Parse outage time slots
  const outageSlots = []
  const timeZones = info.preset?.time_zone || {}
  const timeTypes = info.preset?.time_type || {}

  for (let hour = 1; hour <= 24; hour++) {
    const status = todaySchedule[hour.toString()]

    if (
      status === "no" ||
      status === "first" ||
      status === "second" ||
      status === "maybe"
    ) {
      const timeInfo = timeZones[hour.toString()]
      let startTime, endTime

      if (timeInfo) {
        const baseStartTime = timeInfo[1] // e.g., "00:00"
        const baseEndTime = timeInfo[2] // e.g., "01:00"

        if (status === "first") {
          // First 30 minutes
          const [h] = baseStartTime.split(":")
          startTime = `${h}:00`
          endTime = `${h}:30`
        } else if (status === "second") {
          // Second 30 minutes
          const [h] = baseStartTime.split(":")
          startTime = `${h}:30`
          endTime = baseEndTime
        } else {
          // Full hour
          startTime = baseStartTime
          endTime = baseEndTime
        }
      } else {
        // Fallback if timeInfo not available
        const h = hour - 1
        startTime = `${String(h).padStart(2, "0")}:00`
        endTime = `${String(h + 1).padStart(2, "0")}:00`
      }

      // Convert time to minutes for comparison
      const [startHour, startMin] = startTime.split(":").map(Number)
      const [endHour, endMin] = endTime.split(":").map(Number)
      const startInMinutes = startHour * 60 + startMin
      const endInMinutes = endHour * 60 + endMin

      outageSlots.push({
        hour,
        timeRange: `${startTime}-${endTime}`,
        status,
        description: timeTypes[status] || status,
        startInMinutes,
        endInMinutes,
      })
    }
  }

  if (outageSlots.length === 0) {
    console.log("✅ No planned outages for today!")
    return null
  }

  // Merge consecutive outage slots into continuous ranges
  const mergedOutages = []
  let currentRange = null

  for (const slot of outageSlots) {
    if (!currentRange) {
      // Start a new range
      currentRange = {
        startTime: slot.timeRange.split("-")[0],
        endTime: slot.timeRange.split("-")[1],
        startInMinutes: slot.startInMinutes,
        endInMinutes: slot.endInMinutes,
        description: slot.description,
        status: slot.status,
      }
    } else if (currentRange.endInMinutes === slot.startInMinutes) {
      // Consecutive slot - extend the current range
      currentRange.endTime = slot.timeRange.split("-")[1]
      currentRange.endInMinutes = slot.endInMinutes
    } else {
      // Gap found - save current range and start new one
      mergedOutages.push({
        ...currentRange,
        timeRange: `${currentRange.startTime}-${currentRange.endTime}`,
      })
      currentRange = {
        startTime: slot.timeRange.split("-")[0],
        endTime: slot.timeRange.split("-")[1],
        startInMinutes: slot.startInMinutes,
        endInMinutes: slot.endInMinutes,
        description: slot.description,
        status: slot.status,
      }
    }
  }

  // Don't forget the last range
  if (currentRange) {
    mergedOutages.push({
      ...currentRange,
      timeRange: `${currentRange.startTime}-${currentRange.endTime}`,
    })
  }

  // Find current or next outage from merged ranges
  let currentOutage = null
  let nextOutage = null

  for (const range of mergedOutages) {
    // Check if we're currently in this outage
    if (
      range.startInMinutes <= currentTimeInMinutes &&
      range.endInMinutes > currentTimeInMinutes
    ) {
      currentOutage = range
    }
    // Check if this is an upcoming outage
    else if (
      !nextOutage &&
      range.startInMinutes > currentTimeInMinutes
    ) {
      nextOutage = range
    }

    // Stop if we found both
    if (currentOutage && nextOutage) break
  }

  // Return current outage if exists, otherwise next outage
  const selectedOutage = currentOutage || nextOutage

  if (selectedOutage) {
    const isCurrent = !!currentOutage
    console.log(
      `🔍 ${isCurrent ? "Current" : "Next"} outage: ${selectedOutage.timeRange} (${selectedOutage.description})`
    )

    return {
      queueGroup,
      currentOutage: currentOutage
        ? {
            timeRange: currentOutage.timeRange,
            description: currentOutage.description,
            status: currentOutage.status,
          }
        : null,
      nextOutage: nextOutage
        ? {
            timeRange: nextOutage.timeRange,
            description: nextOutage.description,
            status: nextOutage.status,
          }
        : null,
    }
  }

  console.log("✅ No more outages today!")
  return null
}

function loadLastMessage() {
  if (!fs.existsSync(LAST_MESSAGE_FILE)) return null

  const lastMessage = JSON.parse(
    fs.readFileSync(LAST_MESSAGE_FILE, "utf8").trim()
  )

  if (lastMessage?.date) {
    const messageDay = new Date(lastMessage.date * 1000)
      .toISOString()
      .slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)

    if (messageDay < today) {
      deleteLastMessage()
      return null
    }
  }

  return lastMessage
}

function saveLastMessage({ date, message_id } = {}) {
  fs.mkdirSync(path.dirname(LAST_MESSAGE_FILE), { recursive: true })
  fs.writeFileSync(
    LAST_MESSAGE_FILE,
    JSON.stringify({
      message_id,
      date,
    })
  )
}

function deleteLastMessage() {
  fs.rmdirSync(path.dirname(LAST_MESSAGE_FILE), { recursive: true })
}

function loadMessageHistory() {
  if (!fs.existsSync(MESSAGE_HISTORY_FILE)) return null

  try {
    const lastMessage = JSON.parse(
      fs.readFileSync(MESSAGE_HISTORY_FILE, "utf8").trim()
    )
    return lastMessage
  } catch (error) {
    console.log("⚠️ Failed to load message history:", error.message)
    return null
  }
}

function saveMessageHistory(entry) {
  // Always overwrite with just the latest entry
  fs.mkdirSync(path.dirname(MESSAGE_HISTORY_FILE), { recursive: true })
  fs.writeFileSync(MESSAGE_HISTORY_FILE, JSON.stringify(entry, null, 2))
}

function createMessageHash(outageData) {
  const { emergencyOutage, nextScheduledOutage } = outageData

  // Create a compact hash representing the current outage state
  const parts = []

  if (emergencyOutage) {
    parts.push(
      `E:${emergencyOutage.sub_type}|${emergencyOutage.start_date}|${emergencyOutage.end_date}`
    )
  }

  if (nextScheduledOutage) {
    const { queueGroup, currentOutage, nextOutage } = nextScheduledOutage
    parts.push(`Q:${queueGroup}`)
    if (currentOutage) {
      parts.push(`C:${currentOutage.timeRange}`)
    }
    if (nextOutage) {
      parts.push(`N:${nextOutage.timeRange}`)
    }
  }

  return parts.join("|")
}

function isDuplicateMessage(outageData) {
  const lastEntry = loadMessageHistory()
  if (!lastEntry) return false

  const currentHash = createMessageHash(outageData)
  const lastHash = lastEntry.hash
  const lastSentTime = new Date(lastEntry.timestamp)
  const now = new Date()
  const diffMinutes = (now - lastSentTime) / 1000 / 60

  // If hash is different, it's not a duplicate - outage range has changed
  if (lastHash !== currentHash) {
    console.log("📝 Outage information changed - will send update")
    return false
  }

  // Same hash - check if sent recently
  if (diffMinutes < 10) {
    console.log("⏭️ Skipping duplicate message (sent within last 10 minutes)")
    return true
  }

  // Same hash but sent more than 10 minutes ago - allow resend
  console.log("🔄 Resending notification (last sent over 10 minutes ago)")
  return false
}

async function sendNotification(info, outageData) {
  if (!TELEGRAM_BOT_TOKEN)
    throw Error("❌ Missing telegram bot token or chat id.")
  if (!TELEGRAM_CHAT_ID) throw Error("❌ Missing telegram chat id.")

  // Check for duplicate message
  if (isDuplicateMessage(outageData)) {
    return { wasDuplicate: true }
  }

  const { updateTimestamp } = info || {}
  const { emergencyOutage, nextScheduledOutage } = outageData

  const now = new Date()
  const time = now.toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  })
  const date = now.toLocaleDateString("uk-UA", {
    timeZone: "Europe/Kyiv",
  })
  const updateNotificationTimestamp = `${time} ${date}`

  const messageParts = []

  // Add emergency outage section if exists
  if (emergencyOutage) {
    const { sub_type, start_date, end_date } = emergencyOutage
    messageParts.push(
      "🚨 <b>УВАГА! Аварійне відключення!</b>",
      "",
      "ℹ️ <b>Причина:</b>",
      (sub_type || "Невідома") + ".",
      "",
      "🔴 <b>Час початку:</b>",
      start_date || "Невідомий",
      "",
      "🟢 <b>Час відновлення:</b>",
      end_date || "Невідомий"
    )

    // Add separator if we also have scheduled outages
    if (nextScheduledOutage) {
      messageParts.push("", "━━━━━━━━━━━━━━━━━━━━", "")
    }
  }

  // Add scheduled outage section if exists
  if (nextScheduledOutage) {
    const { queueGroup, currentOutage, nextOutage } = nextScheduledOutage

    messageParts.push("📊 <b>Черга:</b>", queueGroup, "")

    // Show current outage if exists
    if (currentOutage) {
      messageParts.push(
        "⚡️ <b>Поточне відключення</b>",
        "",
        "🕐 <b>Час:</b>",
        currentOutage.timeRange,
        "",
        "ℹ️ <b>Тип:</b>",
        currentOutage.description
      )

      // Add separator if next outage also exists
      if (nextOutage) {
        messageParts.push("", "—————————————", "")
      }
    }

    // Show next outage if exists
    if (nextOutage) {
      messageParts.push(
        "⏰ <b>Наступне відключення</b>",
        "",
        "🕐 <b>Час:</b>",
        nextOutage.timeRange,
        "",
        "ℹ️ <b>Тип:</b>",
        nextOutage.description
      )
    }
  }

  // Add metadata
  messageParts.push(
    "",
    "⏰ <b>Час оновлення інформації:</b>",
    updateTimestamp || updateNotificationTimestamp,
    "⏰ <b>Час оновлення повідомлення:</b>",
    updateNotificationTimestamp
  )

  const text = messageParts.join("\n")

  console.log("🌀 Sending notification...")

  const lastMessage = loadLastMessage() || {}

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${
        lastMessage.message_id ? "editMessageText" : "sendMessage"
      }`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
          message_id: lastMessage.message_id ?? undefined,
        }),
      }
    )

    const data = await res.json()
    console.log("🟢 Notification sent.", data)

    saveLastMessage(data.result)

    // Save to message history
    saveMessageHistory({
      timestamp: now.toISOString(),
      hash: createMessageHash(outageData),
      sent: data.ok,
    })

    return { wasDuplicate: false, success: data.ok }
  } catch (error) {
    console.log("🔴 Notification not sent.", error.message)
    deleteLastMessage()
    console.log("🌀 Try again...")
    sendNotification(info, outageData)
  }
}

async function commitMessageHistory() {
  try {
    // Check if running in CI/GitHub Actions
    const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"

    if (!isCI) {
      console.log("⏭️ Skipping git commit (not running in CI)")
      return
    }

    console.log("🌀 Committing message history to git...")

    const { execSync } = require("child_process")

    // Configure git if needed
    try {
      execSync('git config user.email "noreply@github.com"', { stdio: "ignore" })
      execSync('git config user.name "GitHub Actions Bot"', { stdio: "ignore" })
    } catch (error) {
      // Git config already set
    }

    // Check if message history file exists and has changes
    if (!fs.existsSync(MESSAGE_HISTORY_FILE)) {
      console.log("⏭️ No message history file to commit")
      return
    }

    // Determine the main branch and ensure we're on it
    let mainBranch = "main"
    try {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        encoding: "utf8",
      }).trim()
      console.log(`📍 Current branch: ${currentBranch}`)

      // Detect if the repo uses 'master' or 'main'
      try {
        execSync("git show-ref --verify refs/heads/main", { stdio: "ignore" })
        mainBranch = "main"
      } catch {
        try {
          execSync("git show-ref --verify refs/heads/master", { stdio: "ignore" })
          mainBranch = "master"
        } catch {
          console.log("⚠️ Could not determine main branch")
        }
      }

      console.log(`📌 Main branch: ${mainBranch}`)

      if (currentBranch !== mainBranch) {
        console.log(`⚠️ Not on ${mainBranch} branch, checking out ${mainBranch}...`)
        execSync(`git checkout ${mainBranch}`, { stdio: "inherit" })
      }
    } catch (error) {
      console.log("⚠️ Could not determine or switch branch:", error.message)
    }

    // Pull latest changes from remote to avoid conflicts (using merge strategy)
    try {
      console.log("🔄 Pulling latest changes from remote...")
      execSync(`git pull origin ${mainBranch} --no-rebase`, { stdio: "inherit" })
    } catch (pullError) {
      console.log("⚠️ Pull failed, will try to push anyway:", pullError.message)
    }

    // Add the message history file
    execSync("git add artifacts/message-history.json", { stdio: "inherit" })

    // Check if there are changes to commit
    try {
      execSync('git diff --cached --quiet artifacts/message-history.json')
      console.log("⏭️ No changes to commit")
    } catch (error) {
      // There are changes, commit them
      execSync(
        'git commit -m "chore: update message history [skip ci]"',
        { stdio: "inherit" }
      )

      // Push to the main branch
      execSync(`git push origin ${mainBranch}`, { stdio: "inherit" })
      console.log(`✅ Message history committed and pushed to ${mainBranch}`)
    }
  } catch (error) {
    console.log("⚠️ Failed to commit message history:", error.message)
  }
}

async function run() {
  const info = await getInfo()
  const outageData = checkOutage(info)

  if (outageData.isOutageDetected) {
    await sendNotification(info, outageData)
    // Commit message history to git if running on GitHub (only if message was sent)
    await commitMessageHistory()
  } else {
    console.log("✅ No outage detected - no notification needed")
  }
}

run().catch((error) => console.error(error.message))
