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
    assert.strictEqual(result.emergencyOutage, null)
    assert.strictEqual(result.scheduledOutage.queueGroup, "GPV1.2")
    assert.strictEqual(result.scheduledOutage.outageSlots.length, 3)
    assert.strictEqual(result.scheduledOutage.periods.length, 1)
  })

  it("should detect outages with 'second' status", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 1 ? "second" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.scheduledOutage.outageSlots.length, 1)
    assert.strictEqual(result.scheduledOutage.outageSlots[0].status, "second")
  })

  it("should detect outages with 'first' status", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 22 ? "first" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.scheduledOutage.outageSlots.length, 1)
    assert.strictEqual(result.scheduledOutage.outageSlots[0].status, "first")
  })

  it("should group consecutive outage hours", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i >= 2 && i <= 4 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.scheduledOutage.periods.length, 1)
    assert.strictEqual(result.scheduledOutage.periods[0].start, 2)
    assert.strictEqual(result.scheduledOutage.periods[0].end, 4)
  })

  it("should create separate periods for non-consecutive outages", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] =
        i === 2 || i === 3 || i === 12 || i === 18 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    assert.strictEqual(result.scheduledOutage.periods.length, 3)
    assert.strictEqual(result.scheduledOutage.periods[0].start, 2)
    assert.strictEqual(result.scheduledOutage.periods[0].end, 3)
    assert.strictEqual(result.scheduledOutage.periods[1].start, 12)
    assert.strictEqual(result.scheduledOutage.periods[1].end, 12)
    assert.strictEqual(result.scheduledOutage.periods[2].start, 18)
    assert.strictEqual(result.scheduledOutage.periods[2].end, 18)
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
    // With new logic: consecutive periods are combined
    // Period 1: hours 1-4 (00:30-04:00) - "second" at hour 1 flows into "no" at hours 2-4
    // Period 2: hour 12 (11:00-12:00)
    // Period 3: hour 18 (17:00-18:00)
    // Period 4: hours 22-24 (21:30-24:00) - "second" at hour 22 flows into "no" at hours 23-24
    assert.strictEqual(result.scheduledOutage.periods.length, 4)
    assert.strictEqual(result.scheduledOutage.scheduleDescription, "00:30-04:00, 11:00-12:00, 17:00-18:00, 21:30-24:00")
  })

  it("should detect emergency outage when sub_type is filled", () => {
    const info = createMockInfo({})
    info.data["1"].sub_type = "Аварійне відключення"
    info.data["1"].start_date = "09.11.2025 10:00"
    info.data["1"].end_date = "09.11.2025 14:00"

    const result = checkPlannedOutages(info)

    assert.strictEqual(result.hasOutage, true)
    assert.strictEqual(result.emergencyOutage.sub_type, "Аварійне відключення")
    assert.strictEqual(result.emergencyOutage.start_date, "09.11.2025 10:00")
    assert.strictEqual(result.emergencyOutage.end_date, "09.11.2025 14:00")
    assert.strictEqual(result.scheduledOutage, null)
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
    assert.strictEqual(result.scheduledOutage.outageSlots.length, 1)
    assert.strictEqual(result.scheduledOutage.outageSlots[0].status, "maybe")
  })

  it("should combine 'second' status with following 'no' status when continuous", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 22 || i === 23 ? (i === 22 ? "second" : "no") : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    // Should have 1 combined period since they're continuous (22:00 meets 22:00)
    // Hour 22 "second" = 21:30-22:00
    // Hour 23 "no" = 22:00-23:00
    // Combined: 21:30-23:00
    assert.strictEqual(result.scheduledOutage.periods.length, 1)
    assert.strictEqual(result.scheduledOutage.periods[0].start, 22)
    assert.strictEqual(result.scheduledOutage.periods[0].end, 23)
    assert.strictEqual(result.scheduledOutage.scheduleDescription, "21:30-23:00")
  })

  it("should NOT combine 'first' status with following slot", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i === 12 || i === 13 ? (i === 12 ? "first" : "no") : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    // Should have 2 separate periods
    assert.strictEqual(result.scheduledOutage.periods.length, 2)
    assert.strictEqual(result.scheduledOutage.periods[0].start, 12)
    assert.strictEqual(result.scheduledOutage.periods[0].end, 12)
    assert.strictEqual(result.scheduledOutage.periods[1].start, 13)
    assert.strictEqual(result.scheduledOutage.periods[1].end, 13)
    assert.strictEqual(result.scheduledOutage.scheduleDescription, "11:00-11:30, 12:00-13:00")
  })

  it("should handle consecutive 'no' slots without splitting", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i >= 10 && i <= 12 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    const result = checkPlannedOutages(info)

    // Should be 1 combined period
    assert.strictEqual(result.scheduledOutage.periods.length, 1)
    assert.strictEqual(result.scheduledOutage.periods[0].start, 10)
    assert.strictEqual(result.scheduledOutage.periods[0].end, 12)
    assert.strictEqual(result.scheduledOutage.scheduleDescription, "09:00-12:00")
  })

  it("should detect BOTH emergency and scheduled outages together", () => {
    const schedule = {}
    for (let i = 1; i <= 24; i++) {
      schedule[i.toString()] = i >= 2 && i <= 4 ? "no" : "yes"
    }
    const info = createMockInfo(schedule)
    // Add emergency outage
    info.data["1"].sub_type = "Стабілізаційне відключення"
    info.data["1"].start_date = "10.11.2025 18:41"
    info.data["1"].end_date = "10.11.2025 22:00"

    const result = checkPlannedOutages(info)

    // Should detect both outages
    assert.strictEqual(result.hasOutage, true)

    // Verify emergency outage
    assert.notStrictEqual(result.emergencyOutage, null)
    assert.strictEqual(result.emergencyOutage.sub_type, "Стабілізаційне відключення")
    assert.strictEqual(result.emergencyOutage.start_date, "10.11.2025 18:41")
    assert.strictEqual(result.emergencyOutage.end_date, "10.11.2025 22:00")

    // Verify scheduled outage is ALSO present
    assert.notStrictEqual(result.scheduledOutage, null)
    assert.strictEqual(result.scheduledOutage.queueGroup, "GPV1.2")
    assert.strictEqual(result.scheduledOutage.outageSlots.length, 3)
    assert.strictEqual(result.scheduledOutage.periods.length, 1)
    assert.strictEqual(result.scheduledOutage.scheduleDescription, "01:00-04:00")
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
    assert.strictEqual(result.scheduledOutage.outageSlots.length, 9)

    // Verify periods are correctly grouped (consecutive periods are combined)
    // Period 1: hours 1-4 (00:30-04:00) - hour 1 "second" flows into hours 2-4 "no"
    // Period 2: hour 12 "no" (11:00-12:00)
    // Period 3: hour 18 "no" (17:00-18:00)
    // Period 4: hours 22-24 (21:30-24:00) - hour 22 "second" flows into hours 23-24 "no"
    assert.strictEqual(result.scheduledOutage.periods.length, 4)

    // Verify period 1: 00:30 - 04:00 (hours 1-4 combined)
    assert.strictEqual(result.scheduledOutage.periods[0].start, 1)
    assert.strictEqual(result.scheduledOutage.periods[0].end, 4)

    // Verify period 2: 11:00 - 12:00
    assert.strictEqual(result.scheduledOutage.periods[1].start, 12)
    assert.strictEqual(result.scheduledOutage.periods[1].end, 12)

    // Verify period 3: 17:00 - 18:00
    assert.strictEqual(result.scheduledOutage.periods[2].start, 18)
    assert.strictEqual(result.scheduledOutage.periods[2].end, 18)

    // Verify period 4: 21:30 - 24:00 (hours 22-24 combined)
    assert.strictEqual(result.scheduledOutage.periods[3].start, 22)
    assert.strictEqual(result.scheduledOutage.periods[3].end, 24)

    // Verify formatted schedule
    assert.strictEqual(
      result.scheduledOutage.scheduleDescription,
      "00:30-04:00, 11:00-12:00, 17:00-18:00, 21:30-24:00"
    )
  })
})
