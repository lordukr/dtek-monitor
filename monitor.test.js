const { describe, it, beforeEach, afterEach } = require("node:test")
const assert = require("node:assert")

process.env.TELEGRAM_BOT_TOKEN = "test_token"
process.env.TELEGRAM_CHAT_ID = "test_chat_id"
process.env.CITY = "Test City"
process.env.STREET = "Test Street"
process.env.HOUSE = "1"

const {
  getKyivParts,
  getKyivMidnightTimestamp,
  checkOutage,
  findNextScheduledOutage,
  createMessageHash,
  isDuplicateMessage,
  detectOutagePassed,
  detectOutageCancelled,
  isAnnouncedOutageStart,
  calculateOutageDuration,
  getEmergencyTiming,
  buildOutageMessage,
  withUpdatedAt,
  sendInformationMessage,
  refreshUpdatedAt,
} = require("./monitor.js")
const {
  sendTelegramMessage,
  editTelegramMessage,
} = require("./lib/telegram.js")

// Summer (UTC+3): 2026-06-10 12:00 Kyiv
const at = (hhmm, day = "2026-06-10") => new Date(`${day}T${hhmm}:00+03:00`)
const SUMMER_MIDNIGHT = Date.parse("2026-06-10T00:00:00+03:00") / 1000

const timeZones = () => {
  const zones = {}
  for (let i = 1; i <= 24; i++) {
    const start = String(i - 1).padStart(2, "0")
    const end = String(i).padStart(2, "0")
    zones[i] = [`${start}-${end}`, `${start}:00`, `${end}:00`]
  }
  return zones
}

const timeTypes = {
  yes: "Світло є",
  no: "Світла немає",
  first: "Світла не буде перші 30 хв.",
  second: "Світла не буде другі 30 хв",
  maybe: "Можливо відключення",
}

// slots: { hour: status }
const makeInfo = (slots, houseData = {}, extra = {}) => {
  const schedule = {}
  for (let h = 1; h <= 24; h++) schedule[h] = slots[h] || "yes"
  return {
    data: {
      1: { sub_type_reason: ["GPV1.2"], ...houseData },
    },
    preset: { data: {}, time_zone: timeZones(), time_type: timeTypes },
    fact: { data: { [SUMMER_MIDNIGHT]: { "GPV1.2": schedule } } },
    ...extra,
  }
}

const quiet = () => {
  const orig = { log: console.log, warn: console.warn }
  console.log = () => {}
  console.warn = () => {}
  return orig
}

let orig
beforeEach(() => {
  orig = quiet()
})
afterEach(() => {
  console.log = orig.log
  console.warn = orig.warn
})

describe("Kyiv time helpers", () => {
  it("computes Kyiv midnight in summer and winter", () => {
    assert.strictEqual(getKyivMidnightTimestamp(at("12:00")), SUMMER_MIDNIGHT)
    assert.strictEqual(
      getKyivMidnightTimestamp(new Date("2026-01-20T10:00:00+02:00")),
      Date.parse("2026-01-20T00:00:00+02:00") / 1000
    )
  })

  it("uses the Kyiv date near UTC midnight", () => {
    // 23:30 UTC on 9 June is already 02:30 on 10 June in Kyiv
    const p = getKyivParts(new Date("2026-06-09T23:30:00Z"))
    assert.strictEqual(p.dateKey, "2026-06-10")
    assert.strictEqual(p.minutesOfDay, 150)
  })
})

describe("checkOutage emergency detection", () => {
  const now = at("12:00")

  it("recognized emergency text is emergency", () => {
    const r = checkOutage(
      makeInfo({}, { sub_type: "Екстренні відключення", start_date: "", end_date: "" }),
      { house: "1", now }
    )
    assert.ok(r.emergencyOutage)
    assert.ok(r.isOutageDetected)
  })

  it("recognized scheduled text is not emergency", () => {
    const r = checkOutage(
      makeInfo(
        {},
        {
          sub_type: "Стабілізаційне відключення (Згідно графіку)",
          start_date: "10:00 10.06.2026",
          end_date: "14:00 10.06.2026",
        }
      ),
      { house: "1", now }
    )
    assert.strictEqual(r.emergencyOutage, null)
    assert.strictEqual(r.isOutageDetected, false)
  })

  it("unknown sub_type with a date window is emergency and warns", () => {
    const warnings = []
    console.warn = (...a) => warnings.push(a.join(" "))
    const r = checkOutage(
      makeInfo({}, { sub_type: "Нова формулювання", start_date: "10:00 10.06.2026" }),
      { house: "1", now }
    )
    assert.ok(r.emergencyOutage)
    assert.ok(warnings.some((w) => w.includes("Нова формулювання")))
  })

  it("unknown sub_type without dates is not emergency", () => {
    const warnings = []
    console.warn = (...a) => warnings.push(a.join(" "))
    const r = checkOutage(
      makeInfo({}, { sub_type: "Щось незрозуміле", type: "1" }),
      { house: "1", now }
    )
    assert.strictEqual(r.emergencyOutage, null)
    assert.strictEqual(warnings.length, 1)
  })

  it("system-wide popup is a fallback", () => {
    const r = checkOutage(makeInfo({}, {}, { hasSystemWideEmergency: true }), {
      house: "1",
      now,
    })
    assert.ok(r.emergencyOutage.isSystemWide)
    assert.ok(r.isOutageDetected)
  })

  it("reads HOUSE lazily from env by default", () => {
    const r = checkOutage(makeInfo({}, { sub_type: "Аварійне" }), { now })
    assert.ok(r.emergencyOutage)
  })

  it("throws without data", () => {
    assert.throws(() => checkOutage({}, { house: "1" }))
  })
})

describe("findNextScheduledOutage", () => {
  it("merges consecutive slots and relabels merged ranges", () => {
    // 17:00-20:00 via hours 18,19,20 with 16:30-17:00 'second' before
    const info = makeInfo({ 17: "second", 18: "no", 19: "no", 20: "no" })
    const r = findNextScheduledOutage(info, ["GPV1.2"], { now: at("12:00") })
    assert.strictEqual(r.nextOutage.timeRange, "16:30-20:00")
    assert.strictEqual(r.nextOutage.description, timeTypes.no)
    assert.strictEqual(r.currentOutage, null)
  })

  it("keeps the slot label for single-slot ranges", () => {
    const info = makeInfo({ 17: "second", 20: "first" })
    const r = findNextScheduledOutage(info, ["GPV1.2"], { now: at("12:00") })
    assert.strictEqual(r.nextOutage.timeRange, "16:30-17:00")
    assert.strictEqual(r.nextOutage.description, timeTypes.second)
  })

  it("does not merge across a gap (first then no)", () => {
    const info = makeInfo({ 5: "first", 6: "no" })
    const r = findNextScheduledOutage(info, ["GPV1.2"], { now: at("00:10") })
    assert.strictEqual(r.nextOutage.timeRange, "04:00-04:30")
  })

  it("selects current and next with injected time", () => {
    const info = makeInfo({ 11: "no", 12: "no", 18: "no" })
    const r = findNextScheduledOutage(info, ["GPV1.2"], { now: at("11:30") })
    assert.strictEqual(r.currentOutage.timeRange, "10:00-12:00")
    assert.strictEqual(r.nextOutage.timeRange, "17:00-18:00")
  })

  it("returns null after the last outage", () => {
    const info = makeInfo({ 3: "no" })
    assert.strictEqual(
      findNextScheduledOutage(info, ["GPV1.2"], { now: at("12:00") }),
      null
    )
  })

  it("handles 24:00 end", () => {
    const info = makeInfo({ 23: "no", 24: "no" })
    const r = findNextScheduledOutage(info, ["GPV1.2"], { now: at("23:30") })
    assert.strictEqual(r.currentOutage.timeRange, "22:00-24:00")
    assert.strictEqual(calculateOutageDuration("22:00-24:00"), "2 год")
  })

  it("prefers info.fact.today when present", () => {
    const info = makeInfo({ 14: "no" })
    const sched = info.fact.data[SUMMER_MIDNIGHT]
    info.fact.data = { 12345: sched }
    info.fact.today = 12345
    const r = findNextScheduledOutage(info, ["GPV1.2"], { now: at("12:00") })
    assert.strictEqual(r.nextOutage.timeRange, "13:00-14:00")
  })

  it("uses Kyiv date (not UTC) when computing today's key", () => {
    // 00:30 Kyiv on 10 June is 21:30 UTC on 9 June
    const info = makeInfo({ 3: "no" })
    const r = findNextScheduledOutage(info, ["GPV1.2"], { now: at("00:30") })
    assert.strictEqual(r.nextOutage.timeRange, "02:00-03:00")
  })
})

describe("hash and duplicates", () => {
  const sched = {
    queueGroup: "GPV1.2",
    currentOutage: { timeRange: "10:00-12:00" },
    nextOutage: { timeRange: "17:00-18:00" },
  }

  it("hashes scheduled outages by time ranges only", () => {
    assert.strictEqual(
      createMessageHash({ emergencyOutage: null, nextScheduledOutage: sched }),
      "S:GPV1.2|C:10:00-12:00|N:17:00-18:00"
    )
  })

  it("emergency hash ignores sub_type and schedule", () => {
    const h = createMessageHash({
      emergencyOutage: { sub_type: "x", start_date: "a", end_date: "b" },
      nextScheduledOutage: sched,
    })
    assert.strictEqual(h, "E:a|b")
  })

  it("detects duplicates via injected last entry", () => {
    const data = { emergencyOutage: null, nextScheduledOutage: sched }
    const hash = createMessageHash(data)
    assert.strictEqual(isDuplicateMessage(data, { hash }), true)
    assert.strictEqual(isDuplicateMessage(data, { hash: "other" }), false)
    assert.strictEqual(isDuplicateMessage(data, null), false)
  })
})

describe("detectOutagePassed / detectOutageCancelled", () => {
  const sched = (current, next) => ({
    queueGroup: "GPV1.2",
    currentOutage: current ? { timeRange: current } : null,
    nextOutage: next ? { timeRange: next } : null,
  })
  const entry = (outageData, extra = {}) => ({
    timestamp: at("10:00").toISOString(),
    outageData,
    ...extra,
  })
  const none = { emergencyOutage: null, nextScheduledOutage: null }

  it("scheduled current outage passed", () => {
    const last = entry({ emergencyOutage: null, nextScheduledOutage: sched("10:00-12:00", null) })
    const r = detectOutagePassed(none, { lastEntry: last, now: at("12:05") })
    assert.strictEqual(r.isEmergency, false)
    assert.strictEqual(r.passedOutage.timeRange, "10:00-12:00")
    assert.strictEqual(r.queueGroup, "GPV1.2")
  })

  it("does not repeat passed notification", () => {
    const last = entry(
      { emergencyOutage: null, nextScheduledOutage: sched("10:00-12:00", null) },
      { type: "outage-passed" }
    )
    assert.strictEqual(
      detectOutagePassed(none, { lastEntry: last, now: at("12:05") }),
      null
    )
  })

  it("emergency passed", () => {
    const emergency = { sub_type: "Аварійне", start_date: "a", end_date: "b" }
    const last = entry({ emergencyOutage: emergency, nextScheduledOutage: null })
    const r = detectOutagePassed(none, { lastEntry: last, now: at("12:05") })
    assert.strictEqual(r.isEmergency, true)
    assert.strictEqual(r.passedOutage, emergency)
  })

  it("future outage disappearing is cancelled, not passed", () => {
    const last = entry({ emergencyOutage: null, nextScheduledOutage: sched(null, "17:00-18:00") })
    const now = at("12:00")
    assert.strictEqual(detectOutagePassed(none, { lastEntry: last, now }), null)
    const c = detectOutageCancelled(none, { lastEntry: last, now })
    assert.strictEqual(c.cancelledOutage.timeRange, "17:00-18:00")
    assert.strictEqual(c.queueGroup, "GPV1.2")
  })

  it("delayed run: ended outage is passed, not cancelled", () => {
    const last = entry({ emergencyOutage: null, nextScheduledOutage: sched(null, "14:00-16:00") })
    const now = at("18:00")
    assert.strictEqual(detectOutageCancelled(none, { lastEntry: last, now }), null)
    const p = detectOutagePassed(none, { lastEntry: last, now })
    assert.strictEqual(p.passedOutage.timeRange, "14:00-16:00")
    assert.strictEqual(p.isEmergency, false)
    assert.strictEqual(p.nextOutage, null)
  })

  it("delayed run: already started counts as passed", () => {
    const last = entry({ emergencyOutage: null, nextScheduledOutage: sched(null, "14:00-24:00") })
    const now = at("15:00")
    assert.strictEqual(detectOutageCancelled(none, { lastEntry: last, now }), null)
    assert.ok(detectOutagePassed(none, { lastEntry: last, now }))
  })

  it("no cancelled/passed for yesterday's ranges", () => {
    const last = entry({ emergencyOutage: null, nextScheduledOutage: sched("22:00-24:00", "23:00-24:00") })
    last.timestamp = at("23:00", "2026-06-09").toISOString()
    const now = at("00:30")
    assert.strictEqual(detectOutageCancelled(none, { lastEntry: last, now }), null)
    assert.strictEqual(detectOutagePassed(none, { lastEntry: last, now }), null)
  })

  it("no cancelled for yesterday's future range either", () => {
    const last = entry({ emergencyOutage: null, nextScheduledOutage: sched(null, "23:00-24:00") })
    last.timestamp = at("20:00", "2026-06-09").toISOString()
    assert.strictEqual(
      detectOutageCancelled(none, { lastEntry: last, now: at("00:10") }),
      null
    )
  })

  it("returns null without history", () => {
    assert.strictEqual(detectOutagePassed(none, { lastEntry: null }), null)
    assert.strictEqual(detectOutageCancelled(none, { lastEntry: null }), null)
  })

  it("does not repeat cancellation", () => {
    const last = entry(
      { emergencyOutage: null, nextScheduledOutage: sched(null, "17:00-18:00") },
      { type: "outage-cancelled" }
    )
    assert.strictEqual(
      detectOutageCancelled(none, { lastEntry: last, now: at("12:00") }),
      null
    )
  })
})

describe("emergency helpers and message", () => {
  it("computes duration and active state", () => {
    const t = getEmergencyTiming("10:00 10.06.2026", "12:30 10.06.2026", at("11:00"))
    assert.strictEqual(t.duration, "2 год 30 хв")
    assert.strictEqual(t.isActiveNow, true)
    assert.strictEqual(
      getEmergencyTiming("10:00 10.06.2026", "12:30 10.06.2026", at("13:00")).isActiveNow,
      false
    )
    assert.deepStrictEqual(getEmergencyTiming("", "", at("11:00")), {
      duration: "",
      isActiveNow: false,
    })
  })

  it("builds a message with the active marker", () => {
    const text = buildOutageMessage(
      {},
      {
        emergencyOutage: { sub_type: "Аварійне", start_date: "10:00 10.06.2026", end_date: "12:30 10.06.2026" },
        nextScheduledOutage: null,
      },
      at("11:00")
    )
    assert.ok(text.includes("ЗАРАЗ АКТИВНЕ"))
    assert.ok(text.includes("2 год 30 хв"))
  })
})

describe("sendTelegramMessage", () => {
  const realFetch = global.fetch
  const opts = { token: "t", chatId: "c", backoffMs: 1 }
  let calls

  const stub = (responses) => {
    calls = 0
    global.fetch = async () => {
      const r = responses[Math.min(calls++, responses.length - 1)]
      if (r instanceof Error) throw r
      return { status: r.status ?? 200, json: async () => r.body }
    }
  }
  afterEach(() => {
    global.fetch = realFetch
  })

  it("returns data on success", async () => {
    stub([{ body: { ok: true, result: {} } }])
    const data = await sendTelegramMessage("hi", opts)
    assert.strictEqual(data.ok, true)
    assert.strictEqual(calls, 1)
  })

  it("retries network errors then succeeds", async () => {
    stub([new Error("boom"), new Error("boom"), { body: { ok: true } }])
    await sendTelegramMessage("hi", opts)
    assert.strictEqual(calls, 3)
  })

  it("throws after exhausting retries", async () => {
    stub([new Error("boom")])
    await assert.rejects(sendTelegramMessage("hi", { ...opts, retries: 2 }), /boom/)
    assert.strictEqual(calls, 3)
  })

  it("retries ok:false 5xx", async () => {
    stub([
      { status: 502, body: { ok: false, error_code: 502, description: "bad gateway" } },
      { body: { ok: true } },
    ])
    await sendTelegramMessage("hi", opts)
    assert.strictEqual(calls, 2)
  })

  it("respects retry_after on 429", async () => {
    stub([
      { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 3 } } },
      { body: { ok: true } },
    ])
    const waits = []
    await sendTelegramMessage("hi", { ...opts, sleep: async (ms) => waits.push(ms) })
    assert.deepStrictEqual(waits, [3000])
  })

  it("does not retry other 4xx errors", async () => {
    stub([{ status: 400, body: { ok: false, error_code: 400, description: "bad request" } }])
    await assert.rejects(sendTelegramMessage("hi", opts), /400/)
    assert.strictEqual(calls, 1)
  })

  it("requires token and chat id", async () => {
    await assert.rejects(sendTelegramMessage("hi", { chatId: "c" }), /token/)
    await assert.rejects(sendTelegramMessage("hi", { token: "t" }), /chat id/)
  })
})

describe("Оновлено о footer", () => {
  const realFetch = global.fetch
  let requests

  const stub = (body) => {
    requests = []
    global.fetch = async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) })
      return { status: body.ok ? 200 : body.error_code, json: async () => body }
    }
  }
  afterEach(() => {
    global.fetch = realFetch
  })

  it("appends the Kyiv check time as the last line", () => {
    assert.strictEqual(
      withUpdatedAt("body", at("09:05")),
      "body\n\n🔄 Оновлено о 09:05"
    )
  })

  it("information messages no longer carry a separate send time", () => {
    const info = makeInfo({ 22: "no" }, {}, { updateTimestamp: "11:50 10.06.2026" })
    const text = buildOutageMessage(info, checkOutage(info, { now: at("12:00") }), at("12:00"))
    assert.doesNotMatch(text, /Час оновлення повідомлення/)
    assert.match(text, /Час оновлення інформації:<\/b>\n11:50 10\.06\.2026$/)
  })

  it("sends with the footer and returns id and body", async () => {
    stub({ ok: true, result: { message_id: 42 } })
    const { message } = await sendInformationMessage("body", at("14:30"))
    assert.deepStrictEqual(message, { id: 42, text: "body" })
    assert.match(requests[0].url, /\/sendMessage$/)
    assert.strictEqual(requests[0].body.text, "body\n\n🔄 Оновлено о 14:30")
  })

  it("throws when the information message cannot be sent", async () => {
    stub({ ok: false, error_code: 400, description: "Bad Request: chat not found" })
    await assert.rejects(sendInformationMessage("body", at("14:30")), /chat not found/)
  })

  it("edits the same message with the new time", async () => {
    stub({ ok: true, result: {} })
    const ok = await refreshUpdatedAt({ id: 42, text: "body" }, at("14:40"))
    assert.strictEqual(ok, true)
    assert.match(requests[0].url, /\/editMessageText$/)
    assert.strictEqual(requests[0].body.message_id, 42)
    assert.strictEqual(requests[0].body.chat_id, "test_chat_id")
    assert.strictEqual(requests[0].body.text, "body\n\n🔄 Оновлено о 14:40")
  })

  it("treats 'message is not modified' as success", async () => {
    stub({
      ok: false,
      error_code: 400,
      description: "Bad Request: message is not modified",
    })
    assert.strictEqual(await refreshUpdatedAt({ id: 42, text: "b" }, at("14:40")), true)
  })

  it("reports a deleted message so it can be forgotten", async () => {
    stub({
      ok: false,
      error_code: 400,
      description: "Bad Request: message to edit not found",
    })
    assert.strictEqual(await refreshUpdatedAt({ id: 42, text: "b" }, at("14:40")), false)
  })

  it("editTelegramMessage posts message_id and text", async () => {
    stub({ ok: true, result: {} })
    await editTelegramMessage(7, "hi", { token: "t", chatId: "c" })
    assert.deepStrictEqual(requests[0].body, {
      chat_id: "c",
      message_id: 7,
      text: "hi",
      parse_mode: "HTML",
    })
  })
})

describe("isAnnouncedOutageStart", () => {
  const sched = (current, next, queueGroup = "GPV1.2") => ({
    emergencyOutage: null,
    nextScheduledOutage: {
      queueGroup,
      currentOutage: current ? { timeRange: current } : null,
      nextOutage: next ? { timeRange: next } : null,
    },
  })
  const entry = (outageData) => ({ timestamp: at("20:50").toISOString(), outageData })

  it("announced next outage becoming current is the same outage", () => {
    const last = entry(sched(null, "21:00-24:00"))
    assert.strictEqual(isAnnouncedOutageStart(sched("21:00-24:00", null), last), true)
    // A later outage showing up as "next" is announced when this one passes
    assert.strictEqual(
      isAnnouncedOutageStart(sched("21:00-24:00", "23:00-24:00"), last),
      true
    )
  })

  it("a changed time range is a real change", () => {
    const last = entry(sched(null, "21:00-24:00"))
    assert.strictEqual(isAnnouncedOutageStart(sched("20:00-24:00", null), last), false)
    assert.strictEqual(isAnnouncedOutageStart(sched(null, "22:00-24:00"), last), false)
  })

  it("ignores other queues, emergencies and missing history", () => {
    const last = entry(sched(null, "21:00-24:00"))
    assert.strictEqual(
      isAnnouncedOutageStart(sched("21:00-24:00", null, "GPV2.1"), last),
      false
    )
    const emergency = { ...sched("21:00-24:00", null), emergencyOutage: { start_date: "a" } }
    assert.strictEqual(isAnnouncedOutageStart(emergency, last), false)
    assert.strictEqual(isAnnouncedOutageStart(sched("21:00-24:00", null), null), false)
  })

  it("already current outage is not a start", () => {
    const last = entry(sched("21:00-24:00", null))
    assert.strictEqual(isAnnouncedOutageStart(sched("21:00-24:00", null), last), false)
  })

  it("the silently saved current outage still produces 'outage passed'", () => {
    // State saved by run() when the outage started, then the outage ends
    const last = entry(sched("18:00-20:00", null))
    const r = detectOutagePassed(sched(null, "22:00-23:00"), {
      lastEntry: last,
      now: at("20:05"),
    })
    assert.strictEqual(r.passedOutage.timeRange, "18:00-20:00")
    assert.strictEqual(r.nextOutage.timeRange, "22:00-23:00")
  })
})
