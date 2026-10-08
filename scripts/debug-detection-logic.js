/**
 * Test detection logic for both emergency and scheduled outages
 */

function testDetection(sub_type, testName) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`TEST: ${testName}`)
  console.log("=".repeat(60))
  console.log(`sub_type: "${sub_type}"`)

  // Emergency detection
  const isEmergencyOutageText = sub_type &&
    (sub_type.includes("Екстренні відключення") ||
     sub_type.includes("екстренн") ||
     sub_type.includes("Аварійне") ||
     sub_type.includes("аварійн") ||
     sub_type.includes("без застосування графіку"))

  // Scheduled detection
  const isScheduledOutageText = !isEmergencyOutageText && sub_type &&
    (sub_type.includes("Стабілізаційне відключення") ||
     sub_type.includes("стабілізаційн") ||
     (sub_type.includes("Згідно графіку погодинних") && !sub_type.includes("без застосування")) ||
     sub_type.includes("According to"))

  const hasEmergencyOutage = (isEmergencyOutageText || !isScheduledOutageText) && sub_type !== ""

  console.log("\nResults:")
  console.log(`  isEmergencyOutageText: ${isEmergencyOutageText}`)
  console.log(`  isScheduledOutageText: ${isScheduledOutageText}`)
  console.log(`  hasEmergencyOutage: ${hasEmergencyOutage}`)
  console.log("\nConclusion:")
  if (isEmergencyOutageText) {
    console.log("  ✅ Detected as: EMERGENCY")
  } else if (isScheduledOutageText) {
    console.log("  ✅ Detected as: SCHEDULED")
  } else {
    console.log("  ⚠️  Detected as: UNKNOWN/EMERGENCY (default)")
  }
}

// Test cases
testDetection(
  "Екстренні відключення (Аварійне без застосування графіку погодинних відключень)",
  "Real Emergency Outage (current)"
)

testDetection(
  "Стабілізаційне відключення (Згідно графіку погодинних відключень)",
  "Scheduled Stabilization Outage"
)

testDetection(
  "Аварійне відключення",
  "Simple Emergency Text"
)

testDetection(
  "Згідно графіку погодинних відключень",
  "According to schedule (should be scheduled)"
)

testDetection(
  "",
  "Empty text"
)

console.log("\n" + "=".repeat(60))
console.log("TEST COMPLETE")
console.log("=".repeat(60))
