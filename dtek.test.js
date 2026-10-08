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
    assert.ok(performance.now() - t0 < 200)
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
