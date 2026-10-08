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
    // generous bound: catches quadratic blow-up (seconds), tolerant of loaded CI runners
    assert.ok(elapsed < 2000, `took ${elapsed}ms`)
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

describe("extractAttentionModalText", () => {
  const wrap = (inner) => `<div id="modal-attention">${inner}</div>`

  test("emergency-new.html text has wording and excludes FAQ", () => {
    const html = fixture("emergency-new.html")
    const text = dtek.extractAttentionModalText(html)
    assert.ok(text.includes("За наказом НЕК Укренерго"))
    assert.ok(text.includes("введені екстрені відключення"))
    const faq = /<section id="fixture-faq">([\s\S]*?)<\/section>/.exec(html)[1]
    const faqText = faq.replace(/<[^<>]*>/g, " ").replace(/\s+/g, " ").trim()
    assert.ok(faqText.length > 0)
    assert.ok(!text.includes(faqText))
  })

  test("no-modal.html returns null", () => {
    assert.equal(dtek.extractAttentionModalText(fixture("no-modal.html")), null)
  })

  test("MicroModal.show script alone returns null", () => {
    assert.equal(
      dtek.extractAttentionModalText('<script>MicroModal.show("modal-attention")</script> екстрені'),
      null
    )
  })

  test("accepts any attribute order and quote style", () => {
    assert.equal(
      dtek.extractAttentionModalText(
        `<div class="m-attention" id='modal-attention' aria-hidden="true"><p>Текст</p></div>`
      ),
      "Текст"
    )
  })

  test("nested balanced divs stop at the real close", () => {
    assert.equal(
      dtek.extractAttentionModalText('<div id="modal-attention"><div>a</div><p>b</p></div><p>c</p>'),
      "a b"
    )
  })

  test("unbalanced block falls back to the rest", () => {
    const text = dtek.extractAttentionModalText('<div id="modal-attention"><div>екстрені')
    assert.ok(text.includes("екстрені"))
  })

  test("empty modal returns empty string", () => {
    assert.equal(dtek.extractAttentionModalText('<div id="modal-attention"></div>'), "")
  })

  test("decodes entities", () => {
    assert.equal(
      dtek.extractAttentionModalText(
        wrap("A&nbsp;B &amp; &#1077;&#x435; &quot;q&quot; &#39;s&#39;")
      ),
      `A B & ее "q" 's'`
    )
  })

  test("removes script, style and comment content", () => {
    assert.equal(
      dtek.extractAttentionModalText(
        wrap("<script>var a=1</script><style>.a{}</style><!-- c -->T")
      ),
      "T"
    )
  })

  test("non-string input returns null", () => {
    assert.equal(dtek.extractAttentionModalText(null), null)
    assert.equal(dtek.extractAttentionModalText(undefined), null)
    assert.equal(dtek.extractAttentionModalText(42), null)
  })

  test("out-of-range entity is left as is and does not throw", () => {
    const html = wrap("&#99999999; екстрені")
    assert.equal(dtek.extractAttentionModalText(html), "&#99999999; екстрені")
    assert.equal(dtek.detectSystemWideEmergency(html), true)
  })

  test("pathological inputs are linear and return null", () => {
    const inputs = [
      "<div".repeat(50000),
      '<div id="modal-attention"' + "<div".repeat(50000),
      "modal-attention ".repeat(20000),
    ]
    const t0 = performance.now()
    for (const input of inputs) assert.equal(dtek.extractAttentionModalText(input), null)
    // generous bound: catches quadratic blow-up (seconds), tolerant of loaded CI runners
    assert.ok(performance.now() - t0 < 2000)
  })
})

describe("detectSystemWideEmergency", () => {
  const wrap = (inner) => `<div id="modal-attention">${inner}</div>`

  test("emergency-new.html is an emergency", () => {
    assert.equal(dtek.detectSystemWideEmergency(fixture("emergency-new.html")), true)
  })

  test("emergency-old.html is an emergency", () => {
    assert.equal(dtek.detectSystemWideEmergency(fixture("emergency-old.html")), true)
  })

  test("is case-insensitive", () => {
    assert.equal(dtek.detectSystemWideEmergency(wrap("ЕКСТРЕНІ")), true)
    assert.equal(dtek.detectSystemWideEmergency(wrap("Екстрених")), true)
  })

  test("modal-no-emergency.html is not an emergency", () => {
    assert.equal(dtek.detectSystemWideEmergency(fixture("modal-no-emergency.html")), false)
  })

  test("no-modal.html is not an emergency", () => {
    assert.equal(dtek.detectSystemWideEmergency(fixture("no-modal.html")), false)
  })

  test("empty and non-string input is false", () => {
    assert.equal(dtek.detectSystemWideEmergency(""), false)
    assert.equal(dtek.detectSystemWideEmergency(null), false)
    assert.equal(dtek.detectSystemWideEmergency(42), false)
  })

  test("stem only in script, style or comment is false", () => {
    assert.equal(dtek.detectSystemWideEmergency(wrap("<script>екстрені</script>")), false)
    assert.equal(dtek.detectSystemWideEmergency(wrap("<style>екстрені</style>")), false)
    assert.equal(dtek.detectSystemWideEmergency(wrap("<!-- екстрені -->")), false)
  })

  test("tag-adjacent wording is true", () => {
    assert.equal(
      dtek.detectSystemWideEmergency(
        '<div id="modal-attention"><p>введені<strong>екстрені</strong></p></div>'
      ),
      true
    )
  })

  test("unbalanced block is capped at 10000 chars", () => {
    assert.equal(
      dtek.detectSystemWideEmergency('<div id="modal-attention"><div>' + "x".repeat(10001) + "екстрені"),
      false
    )
    assert.equal(
      dtek.detectSystemWideEmergency('<div id="modal-attention"><div>екстрені' + "x".repeat(10001)),
      true
    )
  })

  test("stem after the modal closes is false", () => {
    assert.equal(
      dtek.detectSystemWideEmergency('<div id="modal-attention"><div>a</div></div><p>екстрені</p>'),
      false
    )
  })

  test("MicroModal.show script without a modal div is false", () => {
    assert.equal(
      dtek.detectSystemWideEmergency(
        `<script>MicroModal.show('modal-attention')</script><p>екстрені</p>`
      ),
      false
    )
  })

  test("a script's </div> does not close the block early", () => {
    assert.equal(
      dtek.detectSystemWideEmergency(
        '<div id="modal-attention"><script>var t="</div>"</script><p>екстрені</p></div>'
      ),
      true
    )
  })

  test("a script's <div> does not keep the block open", () => {
    assert.equal(
      dtek.detectSystemWideEmergency(
        '<div id="modal-attention"><script>var t="<div>"</script><p>Текст</p></div><p>екстрені</p>'
      ),
      false
    )
  })
})

describe("buildAjaxBody", () => {
  test("builds fields in the site's exact order", () => {
    const body = dtek.buildAjaxBody({
      city: "м. Бориспіль",
      street: "вул. Київський Шлях",
      updateFact: "08.10.2026, 09:06:00",
    })
    assert.deepEqual(
      [...new URLSearchParams(body)],
      [
        ["method", "getHomeNum"],
        ["data[0][name]", "city"],
        ["data[0][value]", "м. Бориспіль"],
        ["data[1][name]", "street"],
        ["data[1][value]", "вул. Київський Шлях"],
        ["data[2][name]", "updateFact"],
        ["data[2][value]", "08.10.2026, 09:06:00"],
      ]
    )
  })

  test("round-trips special characters and passes updateFact verbatim", () => {
    const street = "вул. A&B=C+D"
    const updateFact = "08.10.2026, 09:06:00 &x=1+2"
    const params = new URLSearchParams(dtek.buildAjaxBody({ city: "c", street, updateFact }))
    assert.equal(params.get("data[1][value]"), street)
    assert.equal(params.get("data[2][value]"), updateFact)
  })
})

describe("parseAjaxResponse", () => {
  const nonJson = (status, text) => `AJAX POST returned non-JSON (HTTP ${status}): ${text}`
  const dirty = "x\ny\u001b[31mz\u0085w v"

  test("200 with fixture returns the parsed object", () => {
    const text = fixture("ajax-sample.json")
    const out = dtek.parseAjaxResponse(200, text)
    assert.equal(out.result, true)
    for (const key of Object.keys(JSON.parse(text))) assert.ok(key in out, key)
  })

  test("201 with result:false is passed through", () => {
    assert.deepEqual(dtek.parseAjaxResponse(201, '{"result":false}'), { result: false })
  })

  test("400 excerpt is limited to 500 chars", () => {
    assert.throws(
      () => dtek.parseAjaxResponse(400, "a".repeat(500) + "b".repeat(500)),
      { message: "AJAX POST failed: HTTP 400: " + "a".repeat(500) }
    )
  })

  test("500 with valid JSON still throws HTTP failed", () => {
    assert.throws(() => dtek.parseAjaxResponse(500, '{"result":true}'), (e) =>
      e.message.startsWith("AJAX POST failed: HTTP 500: ")
    )
  })

  test("302 with empty body", () => {
    assert.throws(() => dtek.parseAjaxResponse(302, ""), { message: "AJAX POST failed: HTTP 302: " })
  })

  test("200 html is non-JSON", () => {
    assert.throws(() => dtek.parseAjaxResponse(200, "<html>"), { message: nonJson(200, "<html>") })
  })

  test("200 non-JSON excerpt is limited to 500 chars", () => {
    assert.throws(
      () => dtek.parseAjaxResponse(200, "c".repeat(500) + "d".repeat(500)),
      { message: nonJson(200, "c".repeat(500)) }
    )
  })

  test("200 null is non-JSON", () => {
    assert.throws(() => dtek.parseAjaxResponse(200, "null"), { message: nonJson(200, "null") })
  })

  test("200 array is non-JSON", () => {
    assert.throws(() => dtek.parseAjaxResponse(200, "[]"), { message: nonJson(200, "[]") })
  })

  test("200 primitives are non-JSON", () => {
    assert.throws(() => dtek.parseAjaxResponse(200, "42"), { message: nonJson(200, "42") })
    assert.throws(() => dtek.parseAjaxResponse(200, '"s"'), { message: nonJson(200, '"s"') })
  })

  test("200 empty body is non-JSON", () => {
    assert.throws(() => dtek.parseAjaxResponse(200, ""), { message: nonJson(200, "") })
  })

  test("HTTP failure excerpt is single-line", () => {
    assert.throws(() => dtek.parseAjaxResponse(400, dirty), {
      message: "AJAX POST failed: HTTP 400: x y [31mz w v",
    })
  })

  test("non-JSON excerpt is single-line", () => {
    assert.throws(() => dtek.parseAjaxResponse(200, dirty), {
      message: "AJAX POST returned non-JSON (HTTP 200): x y [31mz w v",
    })
  })

  test("excerpt is not exported", () => {
    assert.equal(dtek.excerpt, undefined)
  })
})

const PAGE_URL_LITERAL = "https://www.dtek-krem.com.ua/ua/shutdowns"
const AJAX_URL_LITERAL = "https://www.dtek-krem.com.ua/ua/ajax"
const ERR_PREFIX = "❌ Getting info failed: "
const FIXED = new Date(2026, 9, 8, 13, 59, 15)
const ADDRESS = { city: "м. Тест", street: "вул. Тестова" }

function makeFake(queue) {
  const fake = {
    calls: [],
    fetch: async (url, init) => {
      fake.calls.push({ url, init })
      const r = queue.shift()
      if (r instanceof Error) throw r
      return {
        status: r.status,
        text: async () => {
          if (r.bodyError) throw r.bodyError
          return r.body
        },
      }
    },
  }
  return fake
}

async function rejectionOf(queue, options = {}) {
  const fake = makeFake(queue)
  const error = await dtek.fetchInfo(ADDRESS, { client: fake, now: () => FIXED, ...options }).then(
    () => assert.fail("expected fetchInfo to reject"),
    (e) => e
  )
  assert.ok(error.message.startsWith(ERR_PREFIX), error.message)
  assert.equal(error.message.split(ERR_PREFIX).length, 2)
  assert.ok(!error.message.includes("\n"), "message must be single-line")
  return { error, fake }
}

const ajaxOk = () => ({ status: 200, body: fixture("ajax-sample.json") })

describe("fetchInfo", () => {
  test("(1) resolves to AJAX JSON plus hasSystemWideEmergency true; exact calls", async () => {
    const fake = makeFake([{ status: 200, body: fixture("emergency-new.html") }, ajaxOk()])
    const info = await dtek.fetchInfo(ADDRESS, { client: fake, now: () => FIXED })
    const sample = JSON.parse(fixture("ajax-sample.json"))
    for (const key of Object.keys(sample)) assert.deepEqual(info[key], sample[key], key)
    assert.equal(info.hasSystemWideEmergency, true)
    assert.equal(fake.calls.length, 2)
    assert.equal(fake.calls[0].url, PAGE_URL_LITERAL)
    assert.deepEqual(fake.calls[0].init, {
      method: "GET",
      headers: { "Accept-Language": "uk-UA" },
      timeout: 30000,
    })
    assert.equal(fake.calls[1].url, AJAX_URL_LITERAL)
    assert.deepEqual(fake.calls[1].init, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        "x-csrf-token": "test-csrf-token_AbC-123==",
      },
      body: dtek.buildAjaxBody({ ...ADDRESS, updateFact: FIXED.toLocaleString("uk-UA") }),
      timeout: 30000,
    })
  })

  test("(2) no-modal page -> hasSystemWideEmergency false", async () => {
    const fake = makeFake([{ status: 200, body: fixture("no-modal.html") }, ajaxOk()])
    const info = await dtek.fetchInfo(ADDRESS, { client: fake, now: () => FIXED })
    assert.equal(info.hasSystemWideEmergency, false)
    assert.equal(fake.calls.length, 2)
  })

  test("(3) timeoutMs 5000 is passed to both requests", async () => {
    const fake = makeFake([{ status: 200, body: fixture("emergency-new.html") }, ajaxOk()])
    await dtek.fetchInfo(ADDRESS, { client: fake, now: () => FIXED, timeoutMs: 5000 })
    assert.equal(fake.calls.length, 2)
    assert.equal(fake.calls[0].init.timeout, 5000)
    assert.equal(fake.calls[1].init.timeout, 5000)
  })

  test("(4) GET 200 Incapsula challenge -> blocked, no POST", async () => {
    const { error, fake } = await rejectionOf([{ status: 200, body: fixture("incapsula-challenge.html") }])
    assert.match(error.message, /^❌ Getting info failed: Blocked by Incapsula on page GET \(HTTP 200, \d+ bytes\)/)
    assert.equal(fake.calls.length, 1)
  })

  test("(5) GET 403 Incapsula block -> blocked with incident ID", async () => {
    const { error } = await rejectionOf([{ status: 403, body: fixture("incapsula-block.html") }])
    assert.match(error.message, /Blocked by Incapsula on page GET \(HTTP 403/)
    assert.ok(error.message.includes("; incident ID 0-0"), error.message)
  })

  test("(6) GET 503 Incapsula challenge -> Incapsula wins over status", async () => {
    const { error } = await rejectionOf([{ status: 503, body: fixture("incapsula-challenge.html") }])
    assert.match(error.message, /Blocked by Incapsula/)
  })

  test("(7) GET 503 plain body -> Page GET failed with 500-char excerpt", async () => {
    const { error } = await rejectionOf([{ status: 503, body: "e".repeat(500) + "f".repeat(500) }])
    assert.ok(error.message.endsWith("Page GET failed: HTTP 503: " + "e".repeat(500)), error.message)
  })

  test("(8) GET 200 without token or Incapsula -> CSRF token not found", async () => {
    const { error } = await rejectionOf([{ status: 200, body: "<html><body>ok</body></html>" }])
    assert.match(error.message, /CSRF token not found on page \(HTTP 200, 28 bytes\)$/)
    assert.doesNotMatch(error.message, /Incapsula/)
  })

  test("(9) POST 400 -> AJAX POST failed with 500-char excerpt", async () => {
    const { error } = await rejectionOf([
      { status: 200, body: fixture("no-modal.html") },
      { status: 400, body: "a".repeat(500) + "b".repeat(500) },
    ])
    assert.ok(error.message.endsWith("AJAX POST failed: HTTP 400: " + "a".repeat(500)), error.message)
  })

  test("(10) POST 200 non-JSON -> AJAX POST returned non-JSON", async () => {
    const { error } = await rejectionOf([
      { status: 200, body: fixture("no-modal.html") },
      { status: 200, body: "c".repeat(1000) },
    ])
    assert.ok(
      error.message.endsWith("AJAX POST returned non-JSON (HTTP 200): " + "c".repeat(500)),
      error.message
    )
  })

  test("(16) GET 502 with control characters -> sanitized single-line excerpt", async () => {
    const { error } = await rejectionOf([{ status: 502, body: "x\ny\u001b[31mz" }])
    assert.ok(error.message.endsWith("Page GET failed: HTTP 502: x y [31mz"), error.message)
  })

  test("(17) GET 200 oversized body -> rejected before parsing, 1 call", async () => {
    const { error, fake } = await rejectionOf([{ status: 200, body: "x".repeat(5000001) }])
    assert.match(error.message, /Page GET returned oversized body \(HTTP 200, 5000001 chars\)/)
    assert.equal(fake.calls.length, 1)
  })

  test("(18) page title is appended to Incapsula and CSRF reasons", async () => {
    const blocked = await rejectionOf([
      {
        status: 200,
        body: '<html><head><title>Access\ndenied</title></head><script src="/_Incapsula_Resource?x=1"></script></html>',
      },
    ])
    assert.ok(blocked.error.message.includes("; title: Access denied"), blocked.error.message)
    const maintenance = await rejectionOf([{ status: 200, body: "<title>Maintenance</title>" }])
    assert.match(
      maintenance.error.message,
      /CSRF token not found on page \(HTTP 200, \d+ bytes\); title: Maintenance$/
    )
  })

  test("(11) GET TimeoutError -> page GET timed out, 1 call", async () => {
    const { error, fake } = await rejectionOf([
      Object.assign(new Error("x"), { name: "TimeoutError" }),
    ])
    assert.equal(error.message, "❌ Getting info failed: page GET timed out after 30s")
    assert.equal(fake.calls.length, 1)
  })

  test("(12) POST ReadTimeout subclass -> AJAX POST timed out", async () => {
    class ReadTimeout extends Error {}
    const err = new ReadTimeout("read")
    assert.equal(err.name, "Error")
    const { error } = await rejectionOf([{ status: 200, body: fixture("no-modal.html") }, err])
    assert.equal(error.message, "❌ Getting info failed: AJAX POST timed out after 30s")
  })

  test("(13) GET generic error -> page GET network error with cause chain", async () => {
    const boom = new Error("boom")
    const { error } = await rejectionOf([boom])
    assert.equal(error.message, "❌ Getting info failed: page GET network error (Error): boom")
    assert.equal(error.cause.cause, boom)
  })

  test("(19) GET body read times out -> page GET timed out, 1 call", async () => {
    const { error, fake } = await rejectionOf([
      {
        status: 200,
        bodyError: new Error(
          "Error reading response stream: reqwest::Error { kind: Decode, source: reqwest::Error { kind: Body, source: TimedOut } }"
        ),
      },
    ])
    assert.equal(error.message, "❌ Getting info failed: page GET timed out after 30s")
    assert.equal(fake.calls.length, 1)
  })

  test("(19b) POST body read TimeoutException prefix -> AJAX POST timed out", async () => {
    const { error } = await rejectionOf([
      { status: 200, body: fixture("no-modal.html") },
      { status: 200, bodyError: new Error("TimeoutException: read timed out") },
    ])
    assert.equal(error.message, "❌ Getting info failed: AJAX POST timed out after 30s")
  })

  test("(21) large origin error page with Incapsula marker, status 502 -> not blocked", async () => {
    const body = '<script src="/_Incapsula_Resource?x=1"></script>' + "<p>origin</p>".repeat(5000)
    const { error } = await rejectionOf([{ status: 502, body }])
    assert.match(error.message, /^❌ Getting info failed: Page GET failed: HTTP 502: /)
    assert.doesNotMatch(error.message, /Blocked by Incapsula/)
  })

  test("(22) large page with Incapsula marker, status 200, no csrf -> CSRF not found", async () => {
    const body = '<script src="/_Incapsula_Resource?x=1"></script>' + "<p>origin</p>".repeat(5000)
    const { error } = await rejectionOf([{ status: 200, body }])
    assert.match(error.message, /CSRF token not found on page \(HTTP 200/)
    assert.doesNotMatch(error.message, /Blocked by Incapsula/)
  })

  test("(20) POST body read reset -> AJAX POST network error", async () => {
    const { error } = await rejectionOf([
      { status: 200, body: fixture("no-modal.html") },
      { status: 200, bodyError: new Error("reset") },
    ])
    assert.equal(error.message, "❌ Getting info failed: AJAX POST network error (Error): reset")
  })
})

describe("module guard", () => {
  test("(14) requiring lib/dtek loads neither impit nor playwright", () => {
    const loaded = Object.keys(require.cache).filter((k) =>
      /node_modules[\\/](impit|playwright)[\\/]/.test(k)
    )
    assert.deepEqual(loaded, [])
  })

  test("(15) getInfo arity is 1 and exactly 8 exports", () => {
    assert.equal(dtek.getInfo.length, 1)
    assert.deepEqual(Object.keys(dtek).sort(), [
      "buildAjaxBody",
      "detectSystemWideEmergency",
      "extractAttentionModalText",
      "extractCsrfToken",
      "fetchInfo",
      "getInfo",
      "isIncapsulaChallenge",
      "parseAjaxResponse",
    ])
  })
})
