// GFX DESK-A R21/R4: the jobbored:// handler accepts two exact shapes and
// rebuilds its target from constants; everything else is refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEAT_IDS,
  DASHBOARD_URL,
  createLaunchGate,
  parseJobBoredUrl,
} from "../protocol.mjs";

test("R21: bare open maps to the dashboard root", () => {
  assert.deepEqual(parseJobBoredUrl("jobbored://open"), { ok: true, target: "http://localhost:8080/" });
  assert.equal(DASHBOARD_URL, "http://localhost:8080/");
});

test("R21: every allowed beat maps to a rebuilt target", () => {
  assert.deepEqual([...BEAT_IDS], ["google", "ai", "resume", "fit", "discovery", "payoff"]);
  for (const beat of BEAT_IDS) {
    assert.deepEqual(parseJobBoredUrl(`jobbored://open?beat=${beat}`), {
      ok: true,
      target: `http://localhost:8080/?beat=${beat}`,
    });
  }
});

test("R21: the target is a constant string, not a view of the input", () => {
  const input = "jobbored://open?beat=fit";
  const { target } = parseJobBoredUrl(input);
  assert.ok(!target.includes("jobbored"));
  assert.equal(new URL(target).origin, "http://localhost:8080");
});

const HOSTILE = [
  // wrong verb / host / path
  "jobbored://close",
  "jobbored://opened",
  "jobbored://ope",
  "jobbored://open/",
  "jobbored://open/fit",
  "jobbored://open/../etc/passwd",
  "jobbored:///open",
  "jobbored:open",
  "jobbored://evil.example/open",
  "jobbored://open.evil.example",
  "jobbored://localhost:8080/",
  // other schemes
  "http://localhost:8080/",
  "https://open",
  "file:///etc/passwd",
  "javascript:alert(1)",
  "JOBBORED://open",
  "JobBored://open",
  // returnTo is never allowed (R4)
  "jobbored://open?returnTo=close",
  "jobbored://open?beat=fit&returnTo=close",
  "jobbored://open?returnTo=https://evil.example",
  // unknown, extra, duplicate or empty params
  "jobbored://open?beat=",
  "jobbored://open?beat",
  "jobbored://open?",
  "jobbored://open?beat=admin",
  "jobbored://open?beat=FIT",
  "jobbored://open?beat=fit&beat=ai",
  "jobbored://open?beat=fit&x=1",
  "jobbored://open?x=1",
  "jobbored://open?beat=fit;rm -rf ~",
  "jobbored://open?beat=fit&",
  "jobbored://open?&beat=fit",
  // encodings
  "jobbored://open?beat=%66it",
  "jobbored://open?beat=fit%00",
  "jobbored://open%3Fbeat=fit",
  "jobbored://%6fpen",
  "jobbored://open?beat=fit%26returnTo=close",
  "jobbored://open?beat%3Dfit",
  // whitespace and control characters
  " jobbored://open",
  "jobbored://open ",
  "jobbored://open\n",
  "jobbored://open?beat=fit\r\nX: y",
  "jobbored://open\t",
  "jobbored://open?beat= fit",
  "jobbored://open\u0000",
  "jobbored://open ",
  // credentials, ports, fragments
  "jobbored://user:pass@open",
  "jobbored://user@open",
  "jobbored://open:8080",
  "jobbored://open#beat=fit",
  "jobbored://open?beat=fit#x",
  "jobbored://open#",
  // shell metacharacters and injection shapes
  "jobbored://open;open -a Calculator",
  "jobbored://open?beat=$(id)",
  "jobbored://open?beat=`id`",
  "jobbored://open?beat=fit|id",
  "jobbored://open?beat=../../",
  // unicode look-alikes
  "jobbored://οpen",
  "jobbored://open?beat=ﬁt",
  // oversize
  `jobbored://open?beat=${"a".repeat(5000)}`,
  "",
];

test(`R21: ${HOSTILE.length} hostile URLs are refused`, () => {
  assert.ok(HOSTILE.length >= 30);
  for (const raw of HOSTILE) {
    const result = parseJobBoredUrl(raw);
    assert.equal(result.ok, false, `accepted: ${JSON.stringify(raw)}`);
    assert.equal(result.target, undefined, `target leaked for ${JSON.stringify(raw)}`);
    assert.equal(typeof result.reason, "string");
  }
});

test("R21: non-strings are refused without throwing", () => {
  for (const raw of [undefined, null, 42, {}, [], ["jobbored://open"], new URL("http://x/"), Symbol("x")]) {
    assert.equal(parseJobBoredUrl(/** @type {any} */ (raw)).ok, false);
  }
  const tricky = { toString: () => "jobbored://open" };
  assert.equal(parseJobBoredUrl(/** @type {any} */ (tricky)).ok, false);
});

test("R21: the refusal reason never echoes the raw URL", () => {
  const raw = "jobbored://open?beat=SECRETVALUE";
  const result = parseJobBoredUrl(raw);
  assert.ok(!JSON.stringify(result).includes("SECRETVALUE"));
});

test("R21: the launch gate allows one launch per 2 s", () => {
  let now = 1_000;
  const gate = createLaunchGate({ intervalMs: 2_000, now: () => now });
  assert.equal(gate.tryLaunch(), true);
  now += 1_999;
  assert.equal(gate.tryLaunch(), false);
  now += 1;
  assert.equal(gate.tryLaunch(), true);
  now += 500;
  assert.equal(gate.tryLaunch(), false);
});

test("R21: a refused launch does not extend the window", () => {
  let now = 0;
  const gate = createLaunchGate({ now: () => now });
  assert.equal(gate.tryLaunch(), true);
  for (let i = 0; i < 10; i += 1) {
    now += 150;
    gate.tryLaunch();
  }
  now = 2_000;
  assert.equal(gate.tryLaunch(), true);
});
