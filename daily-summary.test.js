const { describe, it } = require("node:test")
const assert = require("node:assert")

// Mock environment variables
process.env.TELEGRAM_BOT_TOKEN = "test_token"
process.env.TELEGRAM_CHAT_ID = "test_chat_id"
process.env.CITY = "Test City"
process.env.STREET = "Test Street"
process.env.HOUSE = "1"

const {
  checkPlannedOutages,
  formatScheduleDescription,
  getDetailedTimeRange,
} = require("./daily-summary.js")

// Test fixtures
const createMockTimeZones = () => {
  const zones = {}
  for (let i = 1; i <= 24; i++) {
    const start = String(i - 1).padStart(2, "0")
    const end = String(i).padStart(2, "0")
    zones[i.toString()] = [
      `${start}-${end}`,
      `${start}:00`,
      `${end}:00`,
    ]
  }
  return zones
}

const createMockTimeTypes = () => ({
  yes: "Світло є",
  no: "Світла немає",
  first: "Світла не буде перші 30 хв.",
  second: "Світла не буде другі 30 хв",
  maybe: "Можливо відключення",
})

const createMockInfo = (todaySchedule) => ({
  result: true,
  data: {
    "1": {
      sub_type: "",
      start_date: "",
      end_date: "",
      type: "",
      sub_type_reason: ["GPV1.2"],
      voluntarily: null,
    },
  },
  preset: {
    data: {},
    time_zone: createMockTimeZones(),
    time_type: createMockTimeTypes(),
  },
  fact: {
    data: {
      "1762639200": {
        "GPV1.2": todaySchedule,
      },
    },
    today: 1762639200,
  },
})

describe("getDetailedTimeRange", () => {
  const timeZones = createMockTimeZones()

  it("should return full hour range for 'no' status", () => {
    const slot = { hour: 2, status: "no" }
    const result = getDetailedTimeRange(slot, timeZones)
    assert.strictEqual(result, "01:00-02:00")
  })

  it("should return first 30 minutes for 'first' status", () => {
    const slot = { hour: 2, status: "first" }
    const result = getDetailedTimeRange(slot, timeZones)
    assert.strictEqual(result, "01:00-01:30")
  })

  it("should return second 30 minutes for 'second' status", () => {
    const slot = { hour: 2, status: "second" }
    const result = getDetailedTimeRange(slot, timeZones)
    assert.strictEqual(result, "01:30-02:00")
  })

  it("should handle missing timeZones gracefully", () => {
    const slot = { hour: 99, status: "no" }
    const result = getDetailedTimeRange(slot, {})
    assert.strictEqual(result, "98:00-99:00")
  })
})

describe("formatScheduleDescription", () => {
  const timeZones = createMockTimeZones()

  it("should format single period with full hours", () => {
    const periods = [
      {
        start: 2,
        end: 3,
        slots: [
          { hour: 2, status: "no" },
          { hour: 3, status: "no" },
        ],
      },
    ]
    const result = formatScheduleDescription(periods, timeZones)
    assert.strictEqual(result, "01:00-03:00")
  })

  it("should adjust start time for 'second' status", () => {
    const periods = [
      {
        start: 1,
        end: 3,
        slots: [
          { hour: 1, status: "second" },
          { hour: 2, status: "no" },
          { hour: 3, status: "no" },
        ],
      },
    ]
    const result = formatScheduleDescription(periods, timeZones)
    assert.strictEqual(result, "00:30-03:00")
  })

  it("should adjust end time for 'first' status", () => {
    const periods = [
      {
        start: 2,
        end: 3,
        slots: [
          { hour: 2, status: "no" },
          { hour: 3, status: "first" },
        ],
      },
    ]
    const result = formatScheduleDescription(periods, timeZones)
    assert.strictEqual(result, "01:00-02:30")
  })

  it("should handle both 'second' start and 'first' end", () => {
    const periods = [
      {
        start: 22,
        end: 22,
        slots: [{ hour: 22, status: "second" }],
      },
    ]
    const result = formatScheduleDescription(periods, timeZones)
    assert.strictEqual(result, "21:30-22:00")
  })

  it("should format multiple periods", () => {
    const periods = [
      {
        start: 2,
        end: 3,
        slots: [
          { hour: 2, status: "no" },
          { hour: 3, status: "no" },
        ],
      },
      {
        start: 12,
        end: 12,
        slots: [{ hour: 12, status: "no" }],
      },
    ]
    const result = formatScheduleDescription(periods, timeZones)
    assert.strictEqual(result, "01:00-03:00, 11:00-12:00")
  })
})

describe("checkPlannedOutages", () => {
  it("should detect no outages when all hours have 'yes' status", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, false)
  })

  it("should detect outages with 'no' status", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i >= 2 && i <= 4 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.isEmergency, false)
    assert.strictEqual(result.queueGroup, "GPV1.2")
    assert.strictEqual(result.outageSlots.length, 3)
    assert.strictEqual(result.periods.length, 1)
  })

  it("should detect outages with 'second' status", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 1 ? "second" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.outageSlots.length, 1)
    assert.strictEqual(result.outageSlots[0].status, "second")
  })

  it("should detect outages with 'first' status", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 22 ? "first" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.outageSlots.length, 1)
    assert.strictEqual(result.outageSlots[0].status, "first")
  })

  it("should group consecutive outage hours", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i >= 2 && i <= 4 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.periods.length, 1)
    assert.strictEqual(result.periods[0].start, 2)
    assert.strictEqual(result.periods[0].end, 4)
  })

  it("should create separate periods for non-consecutive outages", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] =
        i === 2 || i === 3 || i === 12 || i === 18 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.periods.length, 3)
    assert.strictEqual(result.periods[0].start, 2)
    assert.strictEqual(result.periods[0].end, 3)
    assert.strictEqual(result.periods[1].start, 12)
    assert.strictEqual(result.periods[1].end, 12)
    assert.strictEqual(result.periods[2].start, 18)
    assert.strictEqual(result.periods[2].end, 18)
  })

  it("should handle complex real-world schedule", () => {
    const schedule = {
      "1": "second",
      "2": "no",
      "3": "no",
      "4": "no",
      "5": "yes",
      "6": "yes",
      "7": "yes",
      "8": "yes",
      "9": "yes",
      "10": "yes",
      "11": "yes",
      "12": "no",
      "13": "yes",
      "14": "yes",
      "15": "yes",
      "16": "yes",
      "17": "yes",
      "18": "no",
      "19": "yes",
      "20": "yes",
      "21": "yes",
      "22": "second",
      "23": "no",
      "24": "no",
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    // With new logic: hour 1 "second" is separate, hours 2-4 combined
    // hour 22 "second" is separate, hours 23-24 combined
    assert.strictEqual(result.periods.length, 6)
    assert.strictEqual(result.scheduleDescription, "00:30-01:00, 01:00-04:00, 11:00-12:00, 17:00-18:00, 21:30-22:00, 22:00-24:00")
  })

  it("should detect emergency outage when sub_type is filled", () => {
    const info = createMockInfo({})
    info.data["1"].sub_type = "Аварійне відключення"
    info.data["1"].start_date = "09.11.2025 10:00"
    info.data["1"].end_date = "09.11.2025 14:00"

    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.isEmergency, true)
    assert.strictEqual(result.sub_type, "Аварійне відключення")
    assert.strictEqual(result.start_date, "09.11.2025 10:00")
    assert.strictEqual(result.end_date, "09.11.2025 14:00")
  })

  it("should handle missing schedule data gracefully", () => {
    const info = {
      result: true,
      data: {
        "1": {
          sub_type: "",
          start_date: "",
          end_date: "",
          type: "",
          sub_type_reason: ["GPV1.2"],
        },
      },
    }

    const result = checkPlannedOutages(info)
    assert.strictEqual(result.hasOutage, false)
  })

  it("should handle missing data field", () => {
    const info = {}
    assert.throws(() => checkPlannedOutages(info), /Power outage info missed/)
  })

  it("should include maybe status as outage", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 12 ? "maybe" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.outageSlots.length, 1)
    assert.strictEqual(result.outageSlots[0].status, "maybe")
  })

  it("should NOT combine 'second' status with following 'no' status", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 22 || i === 23 ? (i === 22 ? "second" : "no") : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    // Should have 2 separate periods, not 1 combined period
    assert.strictEqual(result.periods.length, 2)
    assert.strictEqual(result.periods[0].start, 22)
    assert.strictEqual(result.periods[0].end, 22)
    assert.strictEqual(result.periods[1].start, 23)
    assert.strictEqual(result.periods[1].end, 23)
    assert.strictEqual(result.scheduleDescription, "21:30-22:00, 22:00-23:00")
  })

  it("should NOT combine 'first' status with following slot", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 12 || i === 13 ? (i === 12 ? "first" : "no") : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    // Should have 2 separate periods
    assert.strictEqual(result.periods.length, 2)
    assert.strictEqual(result.periods[0].start, 12)
    assert.strictEqual(result.periods[0].end, 12)
    assert.strictEqual(result.periods[1].start, 13)
    assert.strictEqual(result.periods[1].end, 13)
    assert.strictEqual(result.scheduleDescription, "11:00-11:30, 12:00-13:00")
  })

  it("should handle consecutive 'no' slots without splitting", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i >= 10 && i <= 12 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    // Should be 1 combined period
    assert.strictEqual(result.periods.length, 1)
    assert.strictEqual(result.periods[0].start, 10)
    assert.strictEqual(result.periods[0].end, 12)
    assert.strictEqual(result.scheduleDescription, "09:00-12:00")
  })
})

describe("Integration tests", () => {
  it("should correctly process today's actual schedule", () => {
    const actualSchedule = {
      "1": "second",
      "2": "no",
      "3": "no",
      "4": "no",
      "5": "yes",
      "6": "yes",
      "7": "yes",
      "8": "yes",
      "9": "yes",
      "10": "yes",
      "11": "yes",
      "12": "no",
      "13": "yes",
      "14": "yes",
      "15": "yes",
      "16": "yes",
      "17": "yes",
      "18": "no",
      "19": "yes",
      "20": "yes",
      "21": "yes",
      "22": "second",
      "23": "no",
      "24": "no",
    }

    const info = createMockInfo(actualSchedule)
    const result = checkPlannedOutages(info)

    // Verify the correct number of outage slots
    assert.strictEqual(result.outageSlots.length, 9)

    // Verify periods are correctly grouped
    // Period 1: hour 1 "second" (00:30-01:00) - standalone
    // Period 2: hours 2-4 "no" (01:00-04:00) - combined
    // Period 3: hour 12 "no" (11:00-12:00)
    // Period 4: hour 18 "no" (17:00-18:00)
    // Period 5: hour 22 "second" (21:30-22:00) - standalone
    // Period 6: hours 23-24 "no" (22:00-24:00) - combined
    assert.strictEqual(result.periods.length, 6)

    // Verify period 1: 00:30 - 01:00 (just hour 1 "second")
    assert.strictEqual(result.periods[0].start, 1)
    assert.strictEqual(result.periods[0].end, 1)

    // Verify period 2: 01:00 - 04:00 (hours 2-4 "no")
    assert.strictEqual(result.periods[1].start, 2)
    assert.strictEqual(result.periods[1].end, 4)

    // Verify period 3: 11:00 - 12:00
    assert.strictEqual(result.periods[2].start, 12)
    assert.strictEqual(result.periods[2].end, 12)

    // Verify period 4: 17:00 - 18:00
    assert.strictEqual(result.periods[3].start, 18)
    assert.strictEqual(result.periods[3].end, 18)

    // Verify period 5: 21:30 - 22:00 (just hour 22 "second")
    assert.strictEqual(result.periods[4].start, 22)
    assert.strictEqual(result.periods[4].end, 22)

    // Verify period 6: 22:00 - 24:00 (hours 23-24 "no")
    assert.strictEqual(result.periods[5].start, 23)
    assert.strictEqual(result.periods[5].end, 24)

    // Verify formatted schedule
    assert.strictEqual(
      result.scheduleDescription,
      "00:30-01:00, 01:00-04:00, 11:00-12:00, 17:00-18:00, 21:30-22:00, 22:00-24:00"
    )
  })
})
