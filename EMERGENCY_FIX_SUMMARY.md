# Emergency Outage Detection Fix

## Problem
The bot was not detecting emergency outages ("Єкстренні відключення") because the text contained "графіку погодинних" which triggered the scheduled outage detection.

## Example Emergency Text
```
Екстренні відключення (Аварійне без застосування графіку погодинних відключень)
```

This text contains "графіку погодинних" but says "**without applying** hourly schedule" - so it should be treated as **emergency**, not scheduled.

## What Was Fixed

### 1. Emergency Detection Logic (monitor.js:87-110)
Added priority-based detection:
- **First** check for emergency indicators:
  - "Екстренні відключення"
  - "екстренн"
  - "Аварійне"
  - "аварійн"
  - "без застосування графіку" (without applying schedule)

- **Then** check for scheduled indicators (only if NOT emergency):
  - "Згідно графіку погодинних" (According to hourly schedule)

### 2. Improved Emergency Message Format (monitor.js:695-768)
The new emergency message includes:

```
🚨🚨🚨 ЕКСТРЕНЕ ВІДКЛЮЧЕННЯ! 🚨🚨🚨

⚠️ ЗАРАЗ АКТИВНЕ!  (or "⚠️ УВАГА! Аварійне відключення!" if not active)

ℹ️ Тип:
Екстренні відключення (Аварійне без застосування графіку погодинних відключень)

🔴 Початок:
07:55 20.01.2026

🟢 Очікуване відновлення:
12:00 20.01.2026

⏱ Тривалість:
4 год 5 хв

━━━━━━━━━━━━━━━━━━━━

📅 Планові відключення сьогодні:
[Shows scheduled outages if any]
```

Features:
- ✅ Triple alarm emoji for urgency
- ✅ Shows if outage is "ЗАРАЗ АКТИВНЕ" (currently active)
- ✅ Calculates and displays duration
- ✅ Shows upcoming scheduled outages after emergency info
- ✅ Clear separation with visual dividers

## Testing

### Test Files Created
1. `capture-emergency-data.js` - Captures emergency data for analysis
2. `test-emergency-detection.js` - Tests detection logic
3. `test-emergency-message.js` - Previews message format

### Run Tests
```bash
# Preview emergency message
node test-emergency-message.js

# Capture current data
node capture-emergency-data.js

# Test detection logic
node test-emergency-detection.js
```

## How to Test When Next Emergency Happens
1. Run: `node monitor.js`
2. Check that it detects emergency with "🚨 Emergency/Active outage detected!"
3. Verify Telegram message has the new urgent format
4. Confirm message includes duration and "ЗАРАЗ АКТИВНЕ" status

## Message History
Emergency outages are now tracked with hash starting with "E:" (emergency):
```json
{
  "hash": "E:07:55 20.01.2026|12:00 20.01.2026",
  "type": "outage-passed"
}
```

This prevents duplicate emergency notifications while allowing state changes.
