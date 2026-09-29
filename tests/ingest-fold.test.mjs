import assert from "node:assert/strict";
import { it } from "node:test";

const load = () => import("../server/resume-text-fold.mjs");
const fold = async (value) => (await load()).foldForMatch(value);

it("T-K6-01 NFKC folds full-width letters", async () => {
  assert.equal((await fold("Ｆｏｕｎｄｅｒ")).text, "founder");
});

it("T-K6-02 ligatures and the ae/oe table fold for matching", async () => {
  assert.equal((await fold("ﬁ ﬂ ﬀ ﬃ ﬄ æ œ Æ Œ")).text, "fi fl ff ffi ffl ae oe ae oe");
});

it("T-K6-03 dashes and smart quotes share match forms", async () => {
  assert.equal((await fold("‘A’ “B” – — ‐ ‑")).text, "'a' \"b\" - - - -");
});

it("T-K6-04 soft hyphen and zero-width characters vanish, NBSP is space", async () => {
  assert.equal((await fold("co\u00adfounder\u00a0at\u200bNorthwind\u200c Trading\u200d")).text, "cofounder atnorthwind trading");
});

it("T-K6-05 ordinary whitespace collapses", async () => {
  assert.equal((await fold("a\t  b\r\n c")).text, "a b c");
});

it("T-K6-06 case folds", async () => {
  assert.equal((await fold("FABRIKAM Labs")).text, "fabrikam labs");
});

it("T-K6-07 every folded index maps to a raw character that can produce it", async () => {
  const triggers = ["Ａ", "ﬁ", "ﬂ", "ﬀ", "ﬃ", "ﬄ", "æ", "œ", "–", "“", "\u00a0", "\u00ad", "\u200b", "X", "Z"];
  let seed = 1729;
  for (let pass = 0; pass < 80; pass += 1) {
    let raw = "q";
    for (let i = 0; i < 80; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      raw += triggers[seed % triggers.length];
    }
    raw += "z";
    const { text, map } = await fold(raw);
    assert.equal(map.length, text.length);
    for (let i = 0; i < text.length; i += 1) {
      assert.ok(Number.isInteger(map[i]) && map[i] >= 0 && map[i] < raw.length);
      const origin = (await fold(raw[map[i]])).text;
      assert.ok(origin.includes(text[i]), `${JSON.stringify(text[i])} at ${i} from ${JSON.stringify(raw[map[i]])}`);
    }
  }
});

it("T-K6-08 names and dates expose only exact or folded literal matches", async () => {
  const { locateLiteral } = await load();
  assert.equal(locateLiteral("Fabrikam Labs", "Fabrikam Labs", { kind: "name" }).tier, "exact");
  assert.equal(locateLiteral("Ｆａｂｒｉｋａｍ Labs", "Fabrikam Labs", { kind: "name" }).tier, "folded");
  assert.equal(locateLiteral("Jan 2020 — Present", "Jan 2020 - Present", { kind: "date" }).tier, "folded");
  assert.equal(locateLiteral("Fabrikam Labs", "Fabrikom Labs", { kind: "name" }), null);
});

it("T-K6-09 number tokens do not bridge a hyphenated line break", async () => {
  const { containsNumberToken } = await load();
  assert.equal(containsNumberToken("$10-\n20M", "$1020M"), false);
});

it("T-K6-10 a digit cannot match inside a decimal token", async () => {
  const { containsNumberToken } = await load();
  assert.equal(containsNumberToken("1.5M", "1"), false);
  assert.equal(containsNumberToken("1.5M", "1.5M"), true);
});

it("T-K6-11 a year cannot match inside a range token", async () => {
  const { containsNumberToken } = await load();
  assert.equal(containsNumberToken("2019-2021", "2019"), false);
  assert.equal(containsNumberToken("2019-2021", "2019-2021"), true);
});

it("T-K6-12 wrap joining requires lowercase continuation", async () => {
  const { joinSoftWrap } = await load();
  assert.equal(joinSoftWrap("transfor-\nmation"), "transformation");
  assert.equal(joinSoftWrap("Fabrikam-\nLabs"), "Fabrikam-\nLabs");
  assert.equal(joinSoftWrap("Northwind-\ntrading"), "Northwind-\ntrading");
  assert.equal(joinSoftWrap("10-\n20"), "10-\n20");
});

it("T-K6-17 compatibility digits inside numeric tokens stay distinct", async () => {
  assert.equal((await fold("1²M 2①M")).text, "1²m 2①m");
  assert.notEqual((await fold("1²M")).text, (await fold("12M")).text);
  assert.equal((await load()).containsNumberToken("1²M", "1"), false);
  assert.equal((await load()).containsNumberToken("2①M", "21M"), false);
});

it("T-K6-18 a match ending on an astral character ends after the whole surrogate pair", async () => {
  const { locateLiteral } = await load();
  const source = "x\u{1d400}y";
  const hit = locateLiteral(source, "a", { kind: "name" });
  assert.ok(hit);
  assert.equal(hit.tier, "folded");
  assert.equal(source.slice(hit.start, hit.end), "\u{1d400}");
});

it("T-K6-19 a bare line break becomes a space and never glues words", async () => {
  const { joinSoftWrap } = await load();
  assert.equal(joinSoftWrap("review their weekly\ngoals today"), "review their weekly goals today");
  assert.equal(joinSoftWrap("review their weekly\r\ngoals today"), "review their weekly goals today");
  assert.equal(joinSoftWrap("transfor-\nmation"), "transformation");
});
