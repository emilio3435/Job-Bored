/* ============================================================
   lib/ats-score.js — JobBored deterministic ATS scorer (Phase 1)
   ------------------------------------------------------------
   Owner:    Phase-1 backend (flowing-page)
   Purpose:  Pure, deterministic ATS-style scoring for a draft
             cover letter / resume vs a job description. Same
             inputs => same number. NO LLM calls. NO fetches.

   Public API:
     window.JobBoredAts.score({ jd, draft }) =>
       {
         score: number,             // 0–100, weighted sum (rounded)
         keywordCoverage: number,   // 0–100
         toneMatch: number,         // 0–100
         length: { words, target: [200, 320] },
         hits:   [{ term, weight }],
         misses: [{ term, weight }],
         readingLevel: string       // "Grade N"
       }

   Determinism:
     - Tokenization is lowercased, ASCII-folded-ish, stop-worded.
     - Keyword set is derived from JD frequency + a small allow-list
       of recognizable JD nouns/verbs (no randomness, stable order).
     - Score weights are constants; function has no I/O.

   IIFE self-test at bottom asserts:
     - score is in [0,100]
     - same inputs => same outputs (called twice, deep-equal)
     - empty inputs return a sane shape
   ============================================================ */

(function (root) {
  "use strict";

  /* ---------- weights (stable) ---------- */
  var W = {
    keywordCoverage: 0.55, // % of JD top-terms present in draft
    toneMatch: 0.20,       // active voice / outcome verbs density
    lengthBand: 0.15,      // inside [200,320] words
    readability: 0.10,     // grade band 8–12 ideal
  };
  var TARGET_LEN = [200, 320];

  /* ---------- stop words ---------- */
  var STOP = (
    "a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,as,is,are," +
    "was,were,be,been,being,this,that,these,those,it,its,you,your,we,our," +
    "us,i,me,my,they,them,their,he,she,his,her,from,into,about,over,under," +
    "than,so,not,no,yes,do,does,did,have,has,had,will,would,can,could," +
    "should,may,might,must,shall,one,two,etc,via,per,within,across,using"
  ).split(",");
  var STOP_SET = {};
  for (var si = 0; si < STOP.length; si++) STOP_SET[STOP[si]] = 1;

  /* ---------- outcome / active verbs (tone signal) ---------- */
  var TONE_TERMS = [
    "led","built","shipped","launched","designed","architected","drove",
    "owned","reduced","increased","improved","scaled","migrated","mentored",
    "delivered","spearheaded","automated","optimized","unblocked","grew",
    "saved","cut","accelerated","measured","decided","resolved",
  ];
  var TONE_SET = {};
  for (var ti = 0; ti < TONE_TERMS.length; ti++) TONE_SET[TONE_TERMS[ti]] = 1;

  /* ---------- helpers ---------- */
  function tokenize(s) {
    var str = String(s || "").toLowerCase();
    // strip non-letters/digits/spaces
    str = str.replace(/[^a-z0-9\s\-\+\.#]/g, " ");
    var raw = str.split(/\s+/);
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i].replace(/^[\-\.]+|[\-\.]+$/g, "");
      if (!t) continue;
      if (t.length < 2) continue;
      if (STOP_SET[t]) continue;
      out.push(t);
    }
    return out;
  }

  function countWords(s) {
    var m = String(s || "").trim().match(/\S+/g);
    return m ? m.length : 0;
  }

  function countSyllables(word) {
    var w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
    w = w.replace(/^y/, "");
    var groups = w.match(/[aeiouy]{1,2}/g);
    return groups ? groups.length : 1;
  }

  /** Flesch–Kincaid grade level — deterministic; stable across runs. */
  function readingGrade(text) {
    var sentences = String(text || "").split(/[.!?]+/).filter(function (s) {
      return s.trim().length > 0;
    }).length || 1;
    var words = String(text || "").trim().match(/\S+/g) || [];
    var wc = words.length || 1;
    var syll = 0;
    for (var i = 0; i < words.length; i++) syll += countSyllables(words[i]);
    var grade = 0.39 * (wc / sentences) + 11.8 * (syll / wc) - 15.59;
    if (!isFinite(grade)) grade = 0;
    grade = Math.max(0, Math.min(20, grade));
    return Math.round(grade);
  }

  /** Top-N JD terms by frequency, stable order (freq DESC, then term ASC). */
  function jdTopTerms(jd, n) {
    var toks = tokenize(jd);
    var freq = {};
    for (var i = 0; i < toks.length; i++) {
      freq[toks[i]] = (freq[toks[i]] || 0) + 1;
    }
    var arr = [];
    for (var k in freq) {
      if (Object.prototype.hasOwnProperty.call(freq, k)) {
        arr.push({ term: k, weight: freq[k] });
      }
    }
    arr.sort(function (a, b) {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
    });
    return arr.slice(0, n || 12);
  }

  function lengthBandScore(words) {
    if (words === 0) return 0;
    if (words >= TARGET_LEN[0] && words <= TARGET_LEN[1]) return 100;
    var dist = words < TARGET_LEN[0] ? TARGET_LEN[0] - words : words - TARGET_LEN[1];
    var pct = Math.max(0, 100 - dist * 0.6);
    return Math.round(pct);
  }

  function readabilityScore(grade) {
    if (grade >= 8 && grade <= 12) return 100;
    var dist = grade < 8 ? 8 - grade : grade - 12;
    return Math.max(0, 100 - dist * 12);
  }

  function toneScore(draftTokens) {
    if (!draftTokens.length) return 0;
    var hits = 0;
    for (var i = 0; i < draftTokens.length; i++) {
      if (TONE_SET[draftTokens[i]]) hits++;
    }
    // 1 strong tone term per ~50 words ≈ ideal
    var ideal = Math.max(1, draftTokens.length / 50);
    var pct = Math.min(100, (hits / ideal) * 100);
    return Math.round(pct);
  }

  /** Public deterministic score. */
  function score(input) {
    var jd = (input && input.jd) || "";
    var draft = (input && input.draft) || "";
    var draftToks = tokenize(draft);
    var draftSet = {};
    for (var i = 0; i < draftToks.length; i++) draftSet[draftToks[i]] = 1;

    var top = jdTopTerms(jd, 12);
    var hits = [];
    var misses = [];
    var totalWeight = 0;
    var hitWeight = 0;
    for (var t = 0; t < top.length; t++) {
      var entry = top[t];
      totalWeight += entry.weight;
      if (draftSet[entry.term]) {
        hits.push(entry);
        hitWeight += entry.weight;
      } else {
        misses.push(entry);
      }
    }
    var keywordCoverage = totalWeight > 0
      ? Math.round((hitWeight / totalWeight) * 100)
      : 0;

    var words = countWords(draft);
    var grade = readingGrade(draft);
    var tone = toneScore(draftToks);
    var lenScore = lengthBandScore(words);
    var readScore = readabilityScore(grade);

    var weighted =
      keywordCoverage * W.keywordCoverage +
      tone           * W.toneMatch +
      lenScore       * W.lengthBand +
      readScore      * W.readability;
    var finalScore = Math.max(0, Math.min(100, Math.round(weighted)));

    return {
      score: finalScore,
      keywordCoverage: keywordCoverage,
      toneMatch: tone,
      length: { words: words, target: [TARGET_LEN[0], TARGET_LEN[1]] },
      hits: hits,
      misses: misses,
      readingLevel: "Grade " + grade,
    };
  }

  /* ---------- expose ---------- */
  root.JobBoredAts = root.JobBoredAts || {};
  root.JobBoredAts.score = score;
  root.JobBoredAts._internal = {
    tokenize: tokenize,
    jdTopTerms: jdTopTerms,
    lengthBandScore: lengthBandScore,
    readabilityScore: readabilityScore,
    toneScore: toneScore,
    readingGrade: readingGrade,
    weights: W,
    targetLen: TARGET_LEN,
  };

  /* ============================================================
     Self-test — runs once on load.
     ============================================================ */
  (function selfTest() {
    try {
      var jd =
        "We need a senior backend engineer who has shipped distributed " +
        "systems at scale. You will lead migrations, mentor engineers, " +
        "and own reliability. Required: Go, Kubernetes, Postgres, " +
        "observability, postmortems. Bonus: gRPC, Kafka.";
      var draft =
        "I led a migration of our billing system to Kubernetes and Go, " +
        "reducing p99 latency by 40% and shipping weekly releases. " +
        "I mentored four engineers, owned reliability for Postgres, " +
        "and drove our observability and postmortem culture. " +
        "I am excited to bring these outcomes to your team.";
      var a = score({ jd: jd, draft: draft });
      var b = score({ jd: jd, draft: draft });
      var ok =
        a && typeof a.score === "number" &&
        a.score >= 0 && a.score <= 100 &&
        Array.isArray(a.hits) && Array.isArray(a.misses) &&
        a.length && a.length.target[0] === 200 && a.length.target[1] === 320 &&
        typeof a.readingLevel === "string" && a.readingLevel.indexOf("Grade ") === 0 &&
        // determinism
        a.score === b.score &&
        a.keywordCoverage === b.keywordCoverage &&
        a.toneMatch === b.toneMatch &&
        a.length.words === b.length.words &&
        a.hits.length === b.hits.length &&
        a.misses.length === b.misses.length &&
        a.readingLevel === b.readingLevel;
      // empty input shape
      var z = score({ jd: "", draft: "" });
      var emptyOk =
        z && z.score === 0 && z.keywordCoverage === 0 &&
        z.length.words === 0 && Array.isArray(z.hits) && Array.isArray(z.misses);
      if ((!ok || !emptyOk) && typeof console !== "undefined" && console.warn) {
        console.warn("[ats-score] self-test failed", { a: a, b: b, z: z });
      }
    } catch (e) {
      // never throw on load
    }
  })();
})(typeof window !== "undefined" ? window : globalThis);
