const { describe, test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const path = require("path")
const dtek = require("./lib/dtek")
const fixture = (name) => fs.readFileSync(path.join(__dirname, "test/fixtures/dtek", name), "utf8")

describe("extractCsrfToken", () => {
  test("extracts token from emergency-new.html", () => {
    assert.equal(dtek.extractCsrfToken(fixture("emergency-new.html")), "test-csrf-token_AbC-123==")
  })

  test("handles reversed attribute order and single quotes", () => {
    assert.equal(dtek.extractCsrfToken("<meta content='x' name='csrf-token'>"), "x")
  })

  test("ignores csrf-param", () => {
    assert.equal(dtek.extractCsrfToken('<meta name="csrf-param" content="_csrf-dtek-krem">'), null)
  })

  test("empty content returns null", () => {
    assert.equal(dtek.extractCsrfToken('<meta name="csrf-token" content="">'), null)
  })

  test("whitespace-only content returns null", () => {
    assert.equal(dtek.extractCsrfToken('<meta name="csrf-token" content="   ">'), null)
  })

  test("non-string inputs return null", () => {
    assert.equal(dtek.extractCsrfToken(null), null)
    assert.equal(dtek.extractCsrfToken(undefined), null)
    assert.equal(dtek.extractCsrfToken(42), null)
  })

  test("incapsula-challenge.html returns null", () => {
    assert.equal(dtek.extractCsrfToken(fixture("incapsula-challenge.html")), null)
  })

  test("incapsula-block.html returns null", () => {
    assert.equal(dtek.extractCsrfToken(fixture("incapsula-block.html")), null)
  })

  test("pathological unterminated <meta soup is linear", () => {
    const input = "<meta ".repeat(200000)
    const start = performance.now()
    const result = dtek.extractCsrfToken(input)
    const elapsed = performance.now() - start
    assert.equal(result, null)
    assert.ok(elapsed < 200, `took ${elapsed}ms`)
  })
})

describe("isIncapsulaChallenge", () => {
  test("incapsula-challenge.html is a challenge", () => {
    assert.equal(dtek.isIncapsulaChallenge(fixture("incapsula-challenge.html")), true)
  })

  test("incapsula-block.html is a challenge", () => {
    assert.equal(dtek.isIncapsulaChallenge(fixture("incapsula-block.html")), true)
  })

  test("real page with marker and token is not a challenge", () => {
    assert.equal(dtek.isIncapsulaChallenge(fixture("emergency-new.html")), false)
  })

  test("empty html document is not a challenge", () => {
    assert.equal(dtek.isIncapsulaChallenge("<html></html>"), false)
  })

  test("empty string is not a challenge", () => {
    assert.equal(dtek.isIncapsulaChallenge(""), false)
  })

  test("csrf-param-only page without marker is not a challenge", () => {
    assert.equal(
      dtek.isIncapsulaChallenge('<meta name="csrf-param" content="_csrf-dtek-krem">'),
      false
    )
  })

  test("each marker alone with no token is a challenge", () => {
    assert.equal(dtek.isIncapsulaChallenge('<script src="/_Incapsula_Resource?x=1"></script>'), true)
    assert.equal(dtek.isIncapsulaChallenge("<p>Incapsula incident ID: 1-2</p>"), true)
  })

  test("non-string inputs are not challenges", () => {
    assert.equal(dtek.isIncapsulaChallenge(null), false)
    assert.equal(dtek.isIncapsulaChallenge(undefined), false)
    assert.equal(dtek.isIncapsulaChallenge(42), false)
  })
})
