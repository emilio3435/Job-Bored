# The Case — Dossier Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Brief with "The Case" — a dossier organized as status rail → stage stepper → numbers band → three-lane evidence board (They want / You have / Your moves) → notes → dated record — where every block renders from data the system reliably holds.

**Architecture:** A pure model assembler (`role-case-model.js`) composes the card view-model, keyword-match analysis, a persisted ATS scorecard, the materials manifest, and posting health into one `CaseModel`; a string-template renderer (`role-case.js` + `role-case.css`) paints it; `role.js` keeps owning the region, wiring, and the focus guard. Five small source seams ship first, each independently.

**Tech Stack:** Vanilla JS classic-global IIFEs, `node:test` + `node:vm` stub-DOM harness, no new dependencies. Text handling via `window.JobBoredText` (resilience plan Phase 0).

**Spec:** `docs/superpowers/specs/2026-09-01-dossier-case-redesign-design.md` — read it first; every task cites its section.

## Global Constraints

- Prerequisites merged first: resilience plan Phase 0 (`jb-text.js`), Task 5 (role.js focus guard + deferred flush), Phases 2–4. Do not start Task 6+ without `window.JobBoredText` on the page.
- Branch: `feat/dossier-case` from `main`, isolated worktree. `npm test` green before every commit. No push/PR without explicit approval.
- Frozen contracts (spec §10): existing `data-*` names/budgets (additive only), all `jb:*` event names/shapes, Sheet Interface A, `data-action` values `edit-field` / `notes` / `brief-view-posting` / `resume-cover` / `resume-tailor` / `materials-*`. `tests/dossier-card-attrs.test.mjs`, `tests/dossier-workshop-events.test.mjs`, `tests/role-writeback-bridge.test.mjs` stay green unmodified except for appended cases.
- Design tokens unchanged (`style.css:159-177`). New CSS lives only in `role-case.css`.
- Stage ids come from `window.JobBoredStages` (`pairs()`, `toKey()`, `toLabel()`, `isClosed()`) — never a hardcoded stage list.
- Nothing vendor-specific hardcoded: provider labels from config; section labels from data.
- File idioms: `var`-style IIFE for `role*.js`/`dawn-data.js`; `const`/arrow for `pipeline-render.js`, `keyword-profile-match.js`, `ats-scorecard.js`, `materials-state.js`.
- Sample data in tests is fictional (Meridian Labs); never real user data.

---

## Phase 0 — Source seams (no visible change; each ships alone)

### Task 1: Card attributes + view-model fields

**Files:**
- Modify: `pipeline-render.js` (v2Attrs block, ~lines 250–300)
- Modify: `dawn-data.js` (`_parseEnrichmentFromCard` ~1163, `getRoleViewModel` return ~1258)
- Test: `tests/dossier-card-attrs.test.mjs` (append), `tests/dawn-data-jd-blocks.test.mjs` (append — created by the resilience plan; if absent, create with the same `vm` + card-stub harness as `tests/dawn-data-lead-stories.test.mjs`)

**Interfaces:**
- Consumes: job fields from `sheets-read-load.js` — `priority`, `favorite`, `logoUrl`, `matchScore`, `lastHeardFrom`, `responseFlag`; `job._postingEnrichment.requirements/skills/method`.
- Produces: attrs `data-priority`, `data-favorite`, `data-logo-url`, `data-match-score`, `data-reply-flag`, `data-requirements`, `data-skills`, `data-scrape-method`; view-model `job.priority` (`"high"|"normal"|"low"|""`), `job.favorite` (bool), `job.logoUrl`, `job.matchScore` (number|null), `job.lastHeardFrom`, `job.followUpDate`, `job.replied` (`"Yes"|"No"|"Unknown"`), `job.requirements[]`, `job.skills[]`, `job.enrichment.enrichedAt` (ms|null), `job.enrichment.scrapeMethod`.

- [ ] **Step 1: Failing tests**

Append to `tests/dossier-card-attrs.test.mjs` (reuse its card-render harness; ensure the sandbox evaluates `jb-text.js` first):

```js
describe("case attrs", () => {
  it("serializes sheet state the Case needs", () => {
    const attrs = renderCardAttrs({
      priority: "⚡", favorite: true, logoUrl: "https://logo.test/m.png", matchScore: 74,
      responseFlag: "No", lastHeardFrom: "Aug 30", followUpDate: "2026-09-04",
      _postingEnrichment: { requirements: ["5+ years"], skills: ["React"], method: "ats-api" },
    });
    assert.equal(attrs["data-priority"], "high");
    assert.equal(attrs["data-favorite"], "yes");
    assert.equal(attrs["data-logo-url"], "https://logo.test/m.png");
    assert.equal(attrs["data-match-score"], "74");
    assert.equal(attrs["data-reply-flag"], "No");
    assert.deepEqual(JSON.parse(attrs["data-requirements"]), ["5+ years"]);
    assert.deepEqual(JSON.parse(attrs["data-skills"]), ["React"]);
    assert.equal(attrs["data-scrape-method"], "ats-api");
  });
  it("maps priority glyphs to words and omits empties", () => {
    assert.equal(renderCardAttrs({ priority: "🔥" })["data-priority"], "high");
    assert.equal(renderCardAttrs({ priority: "↓" })["data-priority"], "low");
    assert.equal(renderCardAttrs({ priority: "—" })["data-priority"], "normal");
    assert.equal(renderCardAttrs({})["data-priority"], "");
  });
});
```

Append to `tests/dawn-data-jd-blocks.test.mjs`:

```js
describe("getRoleViewModel case fields", () => {
  it("exposes priority, favorite, reply, dates, requirements, skills, enrichment meta", () => {
    const vm = viewModelFor({
      "data-priority": "high", "data-favorite": "yes", "data-logo-url": "https://logo.test/m.png",
      "data-match-score": "74", "data-reply-flag": "No", "data-last-contact": "Aug 30",
      "data-follow-up": "2026-09-04", "data-found-at": "2026-08-29", "data-requirements": JSON.stringify(["5+ years"]),
      "data-skills": JSON.stringify(["React"]), "data-enriched-at": "1756512000000",
      "data-scrape-method": "ats-api",
    });
    const j = vm.job;
    assert.equal(j.priority, "high");
    assert.equal(j.favorite, true);
    assert.equal(j.logoUrl, "https://logo.test/m.png");
    assert.equal(j.matchScore, 74);
    assert.equal(j.replied, "No");
    assert.equal(j.lastHeardFrom, "Aug 30");
    assert.equal(j.followUpDate, "2026-09-04");
    assert.deepEqual(j.requirements, ["5+ years"]);
    assert.deepEqual(j.skills, ["React"]);
    assert.equal(j.foundAt, "2026-08-29");
    assert.equal(j.enrichment.enrichedAt, 1756512000000);
    assert.equal(j.enrichment.scrapeMethod, "ats-api");
  });
});
```

- [ ] **Step 2: Run** `node --test tests/dossier-card-attrs.test.mjs tests/dawn-data-jd-blocks.test.mjs` → new cases FAIL.

- [ ] **Step 3: Implement**

`pipeline-render.js`, inside the v2Attrs array (after the `data-last-contact` pair):

```js
    _pair("data-priority", priorityWord(job.priority)),
    _pair("data-favorite", job.favorite ? "yes" : ""),
    _pair("data-logo-url", job.logoUrl || ""),
    _pair("data-match-score", Number.isFinite(Number(job.matchScore)) && job.matchScore !== null && job.matchScore !== "" ? String(Number(job.matchScore)) : ""),
    _pair("data-reply-flag", String(job.responseFlag || "").trim()),
    _enrPair("data-requirements", _enr && _arrJson(_enr.requirements)),
    _enrPair("data-skills", _enr && _arrJson(_enr.skills)),
    _enrPair("data-scrape-method", _enr && (_enr.method || (_enr.scraping && _enr.scraping.provider) || "")),
```

and a helper beside `_clip`:

```js
  const priorityWord = (p) => {
    const s = String(p || "").trim();
    if (!s) return "";
    if (s === "🔥" || s === "⚡" || /^high$/i.test(s)) return "high";
    if (s === "↓" || /^low$/i.test(s)) return "low";
    return "normal";
  };
```

`dawn-data.js` — in `_parseEnrichmentFromCard` add to both the null-card and card branches:

```js
      enrichedAt: _firstNumber(_attr(card, "data-enriched-at")),
      scrapeMethod: String(_attr(card, "data-scrape-method") || "").trim(),
```

(null branch: `enrichedAt: null, scrapeMethod: ""`). In the `getRoleViewModel` return object add:

```js
        priority: String(_attr(card, "data-priority") || "").trim(),
        favorite: String(_attr(card, "data-favorite") || "").toLowerCase() === "yes",
        logoUrl: String(_attr(card, "data-logo-url") || "").trim(),
        matchScore: _firstNumber(_attr(card, "data-match-score")),
        lastHeardFrom: String(_attr(card, "data-last-contact") || "").trim(),
        followUpDate: String(_attr(card, "data-follow-up") || "").trim(),
        replied: (function () {
          var raw = String(_attr(card, "data-reply-flag") || "").trim();
          if (/^yes$/i.test(raw)) return "Yes";
          if (/^no$/i.test(raw)) return "No";
          return rec.replied ? "Yes" : "Unknown";
        })(),
        requirements: _parseJsonArrayAttr(card, "data-requirements"),
        skills: _parseJsonArrayAttr(card, "data-skills"),
        foundAt: rec.foundAt || "",
        talkingPoints: _parseTalkingPointsFromCard(card),
```

and mirror the same keys with empty values in `EMPTY_JOB`.

- [ ] **Step 4: Run** the two suites + `node --test tests/enrichment-self-heal.test.mjs tests/pipeline-newest-sort.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit**

```bash
git add pipeline-render.js dawn-data.js tests/dossier-card-attrs.test.mjs tests/dawn-data-jd-blocks.test.mjs
git commit -m "feat(dossier): carry priority, favorite, reply, requirements, skills to the role view-model"
```

### Task 2: `keywordMatch.analyzeJob` + readiness event

**Files:**
- Modify: `keyword-profile-match.js` (`refreshCandidateProfileMatchCache` ~550–597, exports ~598)
- Test: create `tests/keyword-match-analyze-job.test.mjs`

**Interfaces:**
- Produces: `window.JobBoredApp.keywordMatch.analyzeJob(job)` → `{ percentage, foundCount, partialCount, missingTerms, requirements[], mustHaves[], skills[], toolsAndStack[], byLabel: Map<lowercased label, status> } | null` (null when the profile cache is not loaded or the job has no keyword groups); event `jb:profile-match:ready` on `window` + `document` after each successful refresh.

- [ ] **Step 1: Failing test**

```js
// tests/keyword-match-analyze-job.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function boot() {
  const events = [];
  const win = {
    JobBoredApp: { core: { host: {} } },
    addEventListener() {}, dispatchEvent(e) { events.push(e.type); return true; },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
  };
  const doc = { addEventListener() {}, dispatchEvent(e) { events.push("doc:" + e.type); return true; } };
  const sandbox = { window: win, document: doc, console };
  vm.runInNewContext(readFileSync(join(repoRoot, "keyword-profile-match.js"), "utf8"), sandbox);
  return { km: win.JobBoredApp.keywordMatch, events };
}

describe("keywordMatch.analyzeJob", () => {
  it("returns null before the profile cache is loaded", () => {
    const { km } = boot();
    assert.equal(km.analyzeJob({ _postingEnrichment: { mustHaves: ["React"] } }), null);
  });
  it("marks terms found / missing against the cached resume text", () => {
    const { km } = boot();
    km.setCandidateProfileMatchCache({ loaded: true, rawText: "Senior engineer. Built React apps with TypeScript.", normalizedText: "", tokenSet: new Set() });
    const a = km.analyzeJob({ _postingEnrichment: { mustHaves: ["React", "Kubernetes"], toolsAndStack: ["TypeScript"] } });
    assert.equal(a.byLabel.get("react"), "found");
    assert.equal(a.byLabel.get("kubernetes"), "missing");
    assert.equal(a.byLabel.get("typescript"), "found");
    assert.ok(a.percentage > 0 && a.percentage <= 100);
  });
  it("dispatches jb:profile-match:ready after a refresh resolves", async () => {
    const { km, events } = boot();
    km.setCandidateProfileMatchCache({ loaded: true, rawText: "x", normalizedText: "", tokenSet: new Set() });
    await km.refreshCandidateProfileMatchCache();
    assert.ok(events.includes("jb:profile-match:ready"), events.join(","));
  });
});
```

(`refreshCandidateProfileMatchCache` reads the resume bundle / user content through `window.JobBoredApp.core.host` accessors — stub whichever it touches with functions returning empty values so the refresh resolves; read lines 550–597 for the exact accessor names and add them to the `host` stub.)

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement** — add before the `Object.assign(keywordMatch, {`:

```js
  function analyzeJob(job) {
    const cache = getCandidateProfileMatchCache();
    if (!cache || !cache.loaded || !cache.rawText) return null;
    const groups = collectJobKeywordGroups(job);
    if (!groups.all || !groups.all.length) return null;
    const analysis = analyzeKeywordGroupsAgainstText(groups, cache.rawText);
    const byLabel = new Map();
    ["requirements", "mustHaves", "skills", "toolsAndStack"].forEach((k) => {
      (analysis[k] || []).forEach((t) => {
        const key = String(t.label || t.fullLabel || "").trim().toLowerCase();
        if (key && !byLabel.has(key)) byLabel.set(key, t.status);
      });
    });
    return { ...analysis, byLabel };
  }

  function dispatchProfileMatchReady() {
    try {
      const ev = new window.CustomEvent("jb:profile-match:ready", { detail: {} });
      window.dispatchEvent(ev);
      if (typeof document !== "undefined" && document.dispatchEvent) document.dispatchEvent(ev);
    } catch (_) { /* no CustomEvent in this host */ }
  }
```

In `refreshCandidateProfileMatchCache`, call `dispatchProfileMatchReady()` immediately after every `setCandidateProfileMatchCache(...)` that marks `loaded: true` (there are two return paths at ~lines 560 and ~586 — cover both). Export `analyzeJob` in the `Object.assign` block.

- [ ] **Step 4: Run** `node --test tests/keyword-match-analyze-job.test.mjs tests/profile-rescore-provider.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(match): analyzeJob + jb:profile-match:ready for the dossier"`

### Task 3: Persist the ATS scorecard per job

**Files:**
- Modify: `materials-state.js` (after `getJobOpportunityKey` ~line 112; exports)
- Modify: `ats-scorecard.js` (`startAtsScorecardAnalysis` success branch ~line 525)
- Test: create `tests/ats-scorecard-persistence.test.mjs`

**Interfaces:**
- Produces: `window.JobBoredApp.materialsState.getScorecardForJob(job)` → `{ result, storedAt, feature } | null`; `setScorecardForJob(job, result, feature)`; storage key `"jb_ats_scorecard_v1"`, max 100 entries, evict oldest `storedAt`.

- [ ] **Step 1: Failing test**

```js
// tests/ats-scorecard-persistence.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function boot() {
  const win = { JobBoredApp: { core: { host: {} } }, localStorage: memStorage(),
    addEventListener() {}, dispatchEvent() { return true; },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } } };
  const sandbox = { window: win, document: { addEventListener() {}, dispatchEvent() { return true; } }, console };
  vm.runInNewContext(readFileSync(join(repoRoot, "materials-state.js"), "utf8"), sandbox);
  return win.JobBoredApp.materialsState;
}
const job = { link: "https://jobs.test/1", company: "Meridian", title: "PM" };

describe("scorecard persistence", () => {
  it("round-trips a scorecard by job opportunity key", () => {
    const ms = boot();
    assert.equal(ms.getScorecardForJob(job), null);
    ms.setScorecardForJob(job, { overallScore: 82, topStrengths: ["a"] }, "resume");
    const hit = ms.getScorecardForJob(job);
    assert.equal(hit.result.overallScore, 82);
    assert.equal(hit.feature, "resume");
    assert.ok(Number.isFinite(Date.parse(hit.storedAt)));
  });
  it("caps at 100 entries, evicting the oldest", () => {
    const ms = boot();
    for (let i = 0; i < 101; i++) ms.setScorecardForJob({ link: `https://jobs.test/${i}` }, { overallScore: i }, "resume");
    assert.equal(ms.getScorecardForJob({ link: "https://jobs.test/0" }), null);
    assert.equal(ms.getScorecardForJob({ link: "https://jobs.test/100" }).result.overallScore, 100);
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement** in `materials-state.js`:

```js
  const SCORECARD_STORE_KEY = "jb_ats_scorecard_v1";
  const SCORECARD_STORE_MAX = 100;

  function readScorecardStore() {
    try { const raw = window.localStorage.getItem(SCORECARD_STORE_KEY); const o = raw ? JSON.parse(raw) : null; return o && typeof o === "object" ? o : {}; }
    catch (_) { return {}; }
  }
  function writeScorecardStore(store) {
    try { window.localStorage.setItem(SCORECARD_STORE_KEY, JSON.stringify(store)); } catch (_) { /* quota / private mode */ }
  }
  function getScorecardForJob(job) {
    const key = getJobOpportunityKey(job);
    if (!key) return null;
    const hit = readScorecardStore()[key];
    return hit && hit.result ? hit : null;
  }
  function setScorecardForJob(job, result, feature) {
    const key = getJobOpportunityKey(job);
    if (!key || !result) return;
    const store = readScorecardStore();
    store[key] = { result, feature: String(feature || ""), storedAt: new Date().toISOString() };
    const keys = Object.keys(store);
    if (keys.length > SCORECARD_STORE_MAX) {
      keys.sort((a, b) => String(store[a].storedAt).localeCompare(String(store[b].storedAt)))
        .slice(0, keys.length - SCORECARD_STORE_MAX).forEach((k) => { delete store[k]; });
    }
    writeScorecardStore(store);
  }
```

Export `getScorecardForJob`, `setScorecardForJob`, and (if not already) `getJobOpportunityKey` on the module's public object. In `ats-scorecard.js` `startAtsScorecardAnalysis`, in the success branch right after `setAtsScorecardState({...status: "success"...})`:

```js
        const session = core().getLastResumeGenerationSession();
        const scoredJob = (session && session.job) || (payload && payload.job) || null;
        if (scoredJob) materialsState().setScorecardForJob(scoredJob, result, payload && payload.feature);
```

(`payload.feature` — confirm the field name in `buildAtsScorecardRequestPayload` ~line 164; use whatever it names the resume/cover-letter feature.)

- [ ] **Step 4: Run** `node --test tests/ats-scorecard-persistence.test.mjs tests/ats-scorecard-provider.test.mjs tests/ats-state-bus.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(ats): persist scorecards per job so the dossier can show them"`

### Task 4: `expiredReview.getPostingHealth`

**Files:**
- Modify: `expired-review.js` (after `getReviewReason` ~line 70; exports)
- Test: create `tests/expired-review-posting-health.test.mjs`

**Interfaces:**
- Produces: `window.JobBoredExpiredReview.getPostingHealth(job, opts)` (match the module's existing global name — read the file's final `root.X = {...}` line) → `{ state, label, detail, checkedAt }`.

- [ ] **Step 1: Failing test**

```js
describe("getPostingHealth", () => {
  it("expired status wins", () => {
    assert.deepEqual(health({ status: "Expired", link: "https://x/1" }).state, "expired");
  });
  it("cleanup audit note → needs-review with checkedAt", () => {
    const h = health({ status: "New", link: "https://x/1", notes: "[2026-08-31T10:00:00Z] expired-review: needs review · HTTP 403 · previous New" });
    assert.equal(h.state, "needs-review");
    assert.equal(h.checkedAt, "2026-08-31T10:00:00Z");
  });
  it("open when active, recent, and unflagged; unknown for closed stages", () => {
    assert.equal(health({ status: "Researching", link: "https://x/1", dateFoundRaw: "2026-08-29" }, { now: "2026-09-01" }).state, "open");
    assert.equal(health({ status: "Rejected", link: "https://x/1" }).state, "unknown");
  });
});
```

(`health` = the exported function evaluated through the same `vm` harness pattern as Task 2.)

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement**

```js
  var AUDIT_STAMP_RE = /\[(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)\][^\n]*(?:expired[-\s]?review|availability|cleanup)/i;

  function getPostingHealth(job, options) {
    if (!job || typeof job !== "object") return { state: "unknown", label: "", detail: "", checkedAt: "" };
    var notes = String(job._rawNotes || job.notes || "");
    var stamp = AUDIT_STAMP_RE.exec(notes);
    var checkedAt = stamp ? stamp[1] : "";
    if (normalizeStatus(job.status) === "expired") {
      return { state: "expired", label: "Posting expired", detail: "Marked Expired in the sheet.", checkedAt: checkedAt };
    }
    var reason = getReviewReason(job, options);
    if (reason && reason.kind === "cleanup-note") {
      return { state: "needs-review", label: "Needs review", detail: reason.detail, checkedAt: checkedAt };
    }
    if (!ACTIVE_STATUS_KEYS[normalizeStatus(job.status)] || !hasHttpUrl(job.link)) {
      return { state: "unknown", label: "", detail: "", checkedAt: checkedAt };
    }
    return {
      state: "open",
      label: "Posting open",
      detail: reason ? reason.detail : "",
      checkedAt: checkedAt,
    };
  }
```

Export it. (`stale-active` reasons keep `state: "open"` — aging is advisory, not a health state.)

- [ ] **Step 4: Run** `node --test tests/expired-review-posting-health.test.mjs tests/expired-review.test.mjs tests/expired-status-contract.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(expired-review): getPostingHealth for the dossier rail"`

### Task 5: role-materials becomes the manifest owner

**Files:**
- Modify: `role-materials.js` (`BRIEF_SELECTOR` ~33, `renderManifest` ~633 and its 7 call sites, public API ~2197)
- Test: create `tests/role-materials-manifest-events.test.mjs`; update `tests/role-materials.test.mjs` where it asserts the panel's parent

**Interfaces:**
- Produces: `window.JobBoredRoleMaterials.getCurrentManifest()` → `{ jobKey, manifest, base } | null`; event `jb:materials:manifest { jobKey, manifest }` on `window` + `document` after every render of a manifest; mount resolution `[data-mount="materials"]` → fallback `[data-mount="brief"]`.

- [ ] **Step 1: Failing test** (harness: reuse `tests/role-materials.test.mjs`'s boot, which stubs `fetch` and the region)

```js
describe("materials manifest ownership", () => {
  it("dispatches jb:materials:manifest and exposes getCurrentManifest after a render", async () => {
    const { win, events, openRole } = bootMaterials({ manifest: { slug: "meridian-pm", documents: [{ type: "resume", status: "ready" }], pending: null } });
    await openRole("job-1");
    assert.ok(events.some((e) => e.type === "jb:materials:manifest" && e.detail.jobKey === "job-1"));
    const cur = win.JobBoredRoleMaterials.getCurrentManifest();
    assert.equal(cur.manifest.slug, "meridian-pm");
  });
  it("prefers [data-mount=materials] when the case renders one", async () => {
    const { region, openRole } = bootMaterials({ mounts: ["materials", "brief"] });
    await openRole("job-1");
    assert.ok(region.querySelector('[data-mount="materials"] .brief-materials'), "panel must land in the materials mount");
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement**

```js
  var MATERIALS_MOUNT_SELECTOR = '[data-mount="materials"]';
  function findMount() {
    return document.querySelector(MATERIALS_MOUNT_SELECTOR) || document.querySelector(BRIEF_SELECTOR);
  }
```

Replace every `document.querySelector(BRIEF_SELECTOR)` used to locate the panel host with `findMount()`. Wrap rendering:

```js
  var currentManifest = null;
  function commitManifest(hostEl, manifest, base, jobKey) {
    renderManifest(hostEl, manifest, base);
    currentManifest = { jobKey: jobKey || (currentContext && currentContext.jobKey) || "", manifest: manifest, base: base };
    dispatch("jb:materials:manifest", { jobKey: currentManifest.jobKey, manifest: manifest });
  }
  function getCurrentManifest() { return currentManifest; }
```

Replace the seven `renderManifest(brief, manifest, base)` call sites (lines ~792, 844, 1109, 1298, 1475, 1879, 1927) with `commitManifest(...)`; clear `currentManifest = null` in `onClosed`. Export `getCurrentManifest`. Keep `renderManifest` exported for tests.

- [ ] **Step 4: Run** `node --test tests/role-materials-manifest-events.test.mjs tests/role-materials.test.mjs tests/role-materials-auto-draft.test.mjs tests/role-materials-jd-source-url-safehref.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(materials): manifest events + getCurrentManifest + materials mount"`

---

## Phase 1 — The Case model

### Task 6: `role-case-model.js`

**Files:**
- Create: `role-case-model.js`
- Test: create `tests/role-case-model.test.mjs`
- Modify: `index.html` — add `<script src="role-case-model.js" defer></script>` immediately after `role.js` (line ~250)

**Interfaces:**
- Consumes: Task 1 view-model fields; Task 2 `analyzeJob`; Task 3 `getScorecardForJob`; Task 4 `getPostingHealth`; Task 5 `getCurrentManifest`; `window.JobBoredStages`; `window.JobBoredText`.
- Produces: `window.JobBoredCase.model.buildCaseModel(jobKey, deps)` → `CaseModel` (spec §4) and `window.JobBoredCase.model.collectDeps(jobKey)` → `deps` gathered from globals. `deps` shape: `{ vm, job: rawJobForKeyOrNull, keywords: analysis|null, scorecard: {result, storedAt}|null, manifest: manifest|null, materialsError: string, health, stages: {pairs, toKey, toLabel, isClosed}, providerLabel, nowMs, parseDate }`.

- [ ] **Step 1: Failing tests** (fixture-driven; no DOM)

```js
// tests/role-case-model.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(join(repoRoot, "jb-text.js"), "utf8"), sandbox);
  vm.runInNewContext(readFileSync(join(repoRoot, "role-case-model.js"), "utf8"), sandbox);
  return sandbox.window.JobBoredCase.model;
}
const STAGES = ["new", "researching", "applied", "phone-screen", "interviewing", "offer", "rejected", "passed", "expired"];
const stages = {
  pairs: () => STAGES.map((k) => ({ key: k, label: k.replace("-", " ") })),
  toKey: (v) => STAGES.includes(v) ? v : "",
  toLabel: (v) => String(v).replace("-", " "),
  isClosed: (v) => ["rejected", "passed", "expired"].includes(v),
};
const NOW = Date.parse("2026-09-01T12:00:00Z");
function baseDeps(over = {}) {
  return {
    vm: { job: {
      jobKey: "job-1", role: "Senior PM", company: "Meridian Labs", location: "Austin, TX", employment: "Full-time",
      salary: "$185–230k", source: "Ashby", stage: "researching", daysInStage: 2, appliedAt: "",
      fitScore: 8, tags: ["Design Systems"], links: [{ label: "Posting", href: "https://jobs.test/1" }], foundAt: "2026-08-29", talkingPoints: [],
      notes: { body: "Recruiter: Dana", editedAt: "" }, priority: "high", favorite: true, logoUrl: "",
      matchScore: null, lastHeardFrom: "2026-08-31", followUpDate: "2026-09-04", replied: "No",
      requirements: ["5+ years design systems", "WCAG 2.2"], skills: ["React"],
      enrichment: { roleInOneLine: "Design **infrastructure** that ships.", mustHaves: ["5+ years design systems"], niceToHaves: ["Mentoring"],
        toolsAndStack: ["React", "Storybook"], talkingPoints: ["Shipped tokens; cut drift 80%"], status: "ready", enrichedAt: NOW - 3 * 864e5, scrapeMethod: "ats-api" },
    } },
    keywords: { percentage: 74, foundCount: 12, partialCount: 4, missingTerms: [{ label: "Kubernetes" }],
      byLabel: new Map([["5+ years design systems", "found"], ["wcag 2.2", "found"], ["react", "found"], ["storybook", "partial"], ["mentoring", "missing"]]) },
    scorecard: { result: { overallScore: 82, topStrengths: ["Led a11y guild"], evidence: [{ claim: "Token pipeline", sourceSnippet: "Built a token pipeline", sourceType: "resume" }],
      criticalGaps: [{ gap: "Experimentation", whyItMatters: "Named twice", severity: "high" }],
      dimensionScores: { requirementsCoverage: 84, experienceRelevance: 88, impactClarity: 72, atsParseability: 90, toneFit: 78 } }, storedAt: "2026-08-30T00:00:00Z" },
    manifest: { documents: [
      { type: "resume", label: "Tailored resume", status: "ready", lastModifiedAt: "2026-08-30T09:00:00Z", files: [] },
      { type: "cover_letter", label: "Cover letter", status: "pending", files: [] },
      { type: "qa_report", label: "QA report", status: "ready", lastModifiedAt: "2026-08-30T09:05:00Z", files: [] },
    ], pending: { feature: "cover_letter", progress: { phase: "drafting", elapsedSeconds: 42, attempt: 1 } } },
    materialsError: "",
    health: { state: "open", label: "Posting open", detail: "", checkedAt: "2026-08-31" },
    stages, providerLabel: "OpenAI", nowMs: NOW, parseDate: (s) => { const t = Date.parse(s); return Number.isFinite(t) ? t : null; },
    ...over,
  };
}

describe("buildCaseModel", () => {
  it("assembles identity, stage, next action, and numbers from the sources", () => {
    const m = load().buildCaseModel("job-1", baseDeps());
    assert.equal(m.identity.title, "Senior PM");
    assert.equal(m.identity.priority, "high");
    assert.equal(m.stage.current, "researching");
    assert.deepEqual(m.stage.order, STAGES.slice(0, 6));
    assert.equal(m.stage.terminal, false);
    assert.equal(m.nextAction.daysUntil, 3);
    assert.equal(m.numbers.fit.value, 8);
    assert.equal(m.numbers.ats.value, 82);
    assert.deepEqual(m.numbers.keywords, { percentage: 74, found: 12, partial: 4, missing: 1 });
    assert.deepEqual(m.numbers.materials, { ready: 2, total: 4, drafting: 1 });
    assert.equal(m.numbers.reply.value, "No");
  });
  it("demotes markdown in the one-liner and marks requirements from keyword analysis", () => {
    const m = load().buildCaseModel("job-1", baseDeps());
    assert.equal(m.oneLine, "Design infrastructure that ships.");
    assert.deepEqual(m.theyWant.requirements, [{ text: "5+ years design systems", status: "found" }, { text: "WCAG 2.2", status: "found" }]);
    assert.deepEqual(m.theyWant.stack.map((s) => s.status), ["found", "partial", "unknown"]); // React, Storybook, Design Systems(tag)
    assert.equal(m.theyWant.hasMatchData, true);
  });
  it("uses the scorecard for YOU HAVE and falls back to keywords without one", () => {
    const with_ = load().buildCaseModel("job-1", baseDeps());
    assert.equal(with_.youHave.source, "scorecard");
    assert.equal(with_.youHave.gaps[0].severity, "high");
    assert.equal(with_.youHave.dimensions.length, 5);
    const without = load().buildCaseModel("job-1", baseDeps({ scorecard: null }));
    assert.equal(without.youHave.source, "keywords");
    assert.deepEqual(without.youHave.gaps.map((g) => g.gap), ["Kubernetes"]);
  });
  it("builds a dated record with future steps hollow", () => {
    const m = load().buildCaseModel("job-1", baseDeps());
    const labels = m.record.map((e) => e.label + ":" + e.state);
    assert.deepEqual(labels, ["Found:done", "Enriched:done", "Resume drafted:done", "Contacted:done", "Follow-up due:due", "Applied:future"]);
    assert.equal(m.meta.providerLabel, "OpenAI");
  });
  it("hides blocks whose inputs are missing", () => {
    const m = load().buildCaseModel("job-1", baseDeps({ keywords: null, scorecard: null, manifest: null,
      vm: { job: { ...baseDeps().vm.job, followUpDate: "", enrichment: { status: "", mustHaves: [], niceToHaves: [], toolsAndStack: [], talkingPoints: [] }, requirements: [], skills: [], tags: [] } } }));
    assert.equal(m.nextAction, null);
    assert.equal(m.numbers.keywords, null);
    assert.equal(m.numbers.materials, null);
    assert.equal(m.theyWant.hasMatchData, false);
    assert.equal(m.youHave.source, "none");
    assert.equal(m.moves.materials, null);
  });
  it("collapses terminal stages", () => {
    const m = load().buildCaseModel("job-1", baseDeps({ vm: { job: { ...baseDeps().vm.job, stage: "rejected" } } }));
    assert.equal(m.stage.terminal, true);
  });
});
```

- [ ] **Step 2: Run** `node --test tests/role-case-model.test.mjs` → FAIL (module missing).

- [ ] **Step 3: Implement `role-case-model.js`**

```js
/* ============================================================
   role-case-model.js — The Case: pure model assembly (spec §2.1, §4)
   window.JobBoredCase.model.buildCaseModel(jobKey, deps)
   window.JobBoredCase.model.collectDeps(jobKey)
   No DOM writes, no fetches. deps are injectable for tests.
   ============================================================ */
(function (root) {
  "use strict";

  var CASE_DOC_TYPES = [
    { type: "resume", label: "Tailored resume", draftAction: "resume-tailor" },
    { type: "cover_letter", label: "Cover letter", draftAction: "resume-cover" },
    { type: "manual_apply_checklist", label: "Manual-apply checklist", draftAction: "" },
    { type: "qa_report", label: "QA report", draftAction: "" },
  ];
  var DIMENSIONS = [
    ["requirementsCoverage", "Requirements"], ["experienceRelevance", "Relevance"],
    ["impactClarity", "Impact clarity"], ["atsParseability", "ATS parse"], ["toneFit", "Tone fit"],
  ];
  var PROVIDER_LABELS = { gemini: "Gemini", openai: "OpenAI", anthropic: "Anthropic", openrouter: "OpenRouter", local: "Local model", webhook: "Webhook" };
  var DAY = 864e5;

  function T() { return root.JobBoredText; }
  function inline(s) { return T() ? T().normalizeInline(s) : String(s == null ? "" : s).trim(); }
  function items(arr) {
    var t = T();
    return (Array.isArray(arr) ? arr : []).map(function (x) { return t ? t.stripListGlyph(t.normalizeInline(t.itemText(x))) : String(x || "").trim(); }).filter(Boolean);
  }
  function dedupe(list) {
    var seen = Object.create(null), out = [];
    list.forEach(function (s) { var k = s.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(s); } });
    return out;
  }
  function markAll(list, keywords) {
    return list.map(function (text) {
      var status = keywords && keywords.byLabel ? (keywords.byLabel.get(text.toLowerCase()) || "unknown") : "unknown";
      return { text: text, status: status };
    });
  }
  function scoreOf(v) { var n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; }
  function fmtDate(ms) { return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : ""; }

  function buildStage(job, stages) {
    var current = stages.toKey(job.stage) || "new";
    var order = stages.pairs().map(function (p) { return p.key; }).filter(function (k) { return !stages.isClosed(k); });
    return { current: current, order: order, terminal: !!stages.isClosed(current), daysInStage: job.daysInStage == null ? null : job.daysInStage, appliedAt: inline(job.appliedAt) };
  }

  function buildNextAction(job, deps) {
    var followUpAt = inline(job.followUpDate);
    if (!followUpAt) return null;
    var ms = deps.parseDate(followUpAt);
    return { followUpAt: followUpAt, daysUntil: ms == null ? null : Math.ceil((ms - deps.nowMs) / DAY), replied: job.replied || "Unknown", lastContactAt: inline(job.lastHeardFrom) };
  }

  function buildMaterials(manifest) {
    if (!manifest || !Array.isArray(manifest.documents)) return null;
    var pending = manifest.pending && manifest.pending.progress ? manifest.pending : null;
    var pendingFeature = pending ? String(manifest.pending.feature || "") : "";
    return CASE_DOC_TYPES.map(function (def) {
      var doc = manifest.documents.filter(function (d) { return d && d.type === def.type; })[0] || null;
      var isPending = !!(pendingFeature && pendingFeature === def.type && !/^(complete|done|failed)$/i.test(String(pending.progress.phase || "")));
      var status = isPending ? "pending" : (doc ? (String(doc.status || "").toLowerCase() === "ready" ? "ready" : (String(doc.status || "").toLowerCase() === "failed" ? "failed" : "pending")) : "missing");
      if (pendingFeature === def.type && /^failed$/i.test(String(pending.progress.phase || ""))) status = "failed";
      return {
        type: def.type, label: def.label, draftAction: def.draftAction, status: status,
        phase: isPending ? inline(pending.progress.phase) : "", elapsedSeconds: isPending ? Number(pending.progress.elapsedSeconds) || 0 : 0,
        attempt: isPending ? Number(pending.progress.attempt) || 0 : 0,
        updatedAt: doc ? inline(doc.lastModifiedAt) : "", files: doc && Array.isArray(doc.files) ? doc.files : [],
      };
    });
  }

  function buildYouHave(scorecard, keywords) {
    var r = scorecard && scorecard.result;
    if (r) {
      return {
        source: "scorecard", storedAt: scorecard.storedAt || "",
        strengths: items(r.topStrengths),
        evidence: (Array.isArray(r.evidence) ? r.evidence : []).map(function (e) { return { claim: inline(e && e.claim), sourceSnippet: inline(e && e.sourceSnippet), sourceType: inline(e && e.sourceType) }; }).filter(function (e) { return e.claim || e.sourceSnippet; }).slice(0, 3),
        gaps: (Array.isArray(r.criticalGaps) ? r.criticalGaps : []).map(function (g) { return { gap: inline(g && g.gap), whyItMatters: inline(g && g.whyItMatters), severity: /^(high|medium|low)$/.test(String(g && g.severity)) ? g.severity : "medium" }; }).filter(function (g) { return g.gap; }).slice(0, 5),
        dimensions: DIMENSIONS.map(function (d) { return { key: d[0], label: d[1], score: scoreOf(r.dimensionScores && r.dimensionScores[d[0]]) }; }).filter(function (d) { return d.score != null; }),
      };
    }
    if (keywords) {
      var found = [];
      keywords.byLabel.forEach(function (status, label) { if (status === "found") found.push(label); });
      return {
        source: "keywords", storedAt: "",
        strengths: found.slice(0, 6),
        evidence: [],
        gaps: (keywords.missingTerms || []).map(function (t) { return { gap: inline(t && (t.label || t.fullLabel)), whyItMatters: "", severity: "medium" }; }).filter(function (g) { return g.gap; }).slice(0, 5),
        dimensions: [],
      };
    }
    return { source: "none", storedAt: "", strengths: [], evidence: [], gaps: [], dimensions: [] };
  }

  function buildRecord(job, enr, materials, deps) {
    var ev = [];
    var found = deps.parseDate(job.foundAt);
    ev.push({ at: job.foundAt || "", ms: found, label: "Found", detail: [job.source, "discovery"].filter(Boolean).join(" · "), state: "done" });
    if (enr && Number.isFinite(enr.enrichedAt)) ev.push({ at: fmtDate(enr.enrichedAt), ms: enr.enrichedAt, label: "Enriched", detail: deps.providerLabel || "Configured provider", state: "done" });
    (materials || []).forEach(function (d) {
      if (d.status === "ready" && d.updatedAt && (d.type === "resume" || d.type === "cover_letter")) {
        ev.push({ at: d.updatedAt.slice(0, 10), ms: deps.parseDate(d.updatedAt), label: (d.type === "resume" ? "Resume" : "Cover letter") + " drafted", detail: "", state: "done" });
      }
    });
    if (job.lastHeardFrom) ev.push({ at: job.lastHeardFrom, ms: deps.parseDate(job.lastHeardFrom), label: "Contacted", detail: job.replied === "Yes" ? "They replied" : "No reply yet", state: "done" });
    if (job.followUpDate) { var f = deps.parseDate(job.followUpDate); ev.push({ at: job.followUpDate, ms: f, label: "Follow-up due", detail: "", state: f != null && f < deps.nowMs ? "done" : "due" }); }
    if (job.appliedAt) ev.push({ at: job.appliedAt, ms: deps.parseDate(job.appliedAt), label: "Applied", detail: "", state: "done" });
    else ev.push({ at: "", ms: null, label: "Applied", detail: "Not yet", state: "future" });
    ev.sort(function (a, b) {
      var ra = a.state === "future" ? 2 : (a.state === "due" ? 1 : 0), rb = b.state === "future" ? 2 : (b.state === "due" ? 1 : 0);
      if (ra !== rb) return ra - rb;
      return (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms);
    });
    return ev.map(function (e) { return { at: e.at, label: e.label, detail: e.detail, state: e.state }; });
  }

  function buildCaseModel(jobKey, deps) {
    var job = (deps.vm && deps.vm.job) || {};
    var enr = job.enrichment || {};
    var keywords = deps.keywords || null;
    var materials = buildMaterials(deps.manifest);
    var ready = materials ? materials.filter(function (d) { return d.status === "ready"; }).length : 0;
    var drafting = materials ? materials.filter(function (d) { return d.status === "pending"; }).length : 0;
    var requirements = markAll(dedupe(items(job.requirements).concat(items(enr.mustHaves))), keywords);
    var niceToHaves = markAll(dedupe(items(enr.niceToHaves)), keywords);
    var stack = markAll(dedupe(items(enr.toolsAndStack).concat(items(job.skills)).concat(items(job.tags))), keywords);
    var foundAt = inline(job.foundAt || job.dateFound || "");
    var jobForRecord = { foundAt: foundAt, source: inline(job.source), lastHeardFrom: inline(job.lastHeardFrom), replied: job.replied, followUpDate: inline(job.followUpDate), appliedAt: inline(job.appliedAt) };

    return {
      jobKey: String(jobKey || job.jobKey || ""),
      identity: {
        title: inline(job.role), company: inline(job.company), location: inline(job.location), employment: inline(job.employment),
        salary: inline(job.salary), source: inline(job.source), link: (job.links && job.links[0] && job.links[0].href) || "",
        logoUrl: inline(job.logoUrl), foundAt: foundAt, priority: job.priority || "", favorite: !!job.favorite,
      },
      stage: buildStage(job, deps.stages),
      nextAction: buildNextAction(job, deps),
      health: deps.health || { state: "unknown", label: "", detail: "", checkedAt: "" },
      numbers: {
        fit: Number.isFinite(Number(job.fitScore)) && job.fitScore !== null ? { value: Number(job.fitScore), max: 10 } : null,
        ats: deps.scorecard && deps.scorecard.result && scoreOf(deps.scorecard.result.overallScore) != null ? { value: scoreOf(deps.scorecard.result.overallScore) } : null,
        keywords: keywords ? { percentage: Math.round(Number(keywords.percentage) || 0), found: Number(keywords.foundCount) || 0, partial: Number(keywords.partialCount) || 0, missing: (keywords.missingTerms || []).length } : null,
        reply: { value: job.replied || "Unknown" },
        materials: materials ? { ready: ready, total: CASE_DOC_TYPES.length, drafting: drafting } : null,
      },
      oneLine: inline(enr.roleInOneLine),
      theyWant: { requirements: requirements, niceToHaves: niceToHaves, stack: stack, hasMatchData: !!keywords },
      youHave: buildYouHave(deps.scorecard, keywords),
      moves: {
        talkingPoints: items(enr.talkingPoints).length ? items(enr.talkingPoints).slice(0, 6) : items(job.talkingPoints).slice(0, 6),
        materials: materials,
        materialsError: deps.materialsError || "",
        people: { contact: inline(job.contacts && job.contacts[0] && job.contacts[0].name), lastContactAt: inline(job.lastHeardFrom), replied: job.replied || "Unknown", followUpAt: inline(job.followUpDate) },
      },
      notes: job.notes ? { body: String(job.notes.body || ""), editedAt: String(job.notes.editedAt || "") } : null,
      record: buildRecord(jobForRecord, enr, materials, deps),
      loading: { enrichment: enr.status === "loading", keywords: !keywords && !!(deps.keywordsPending), materials: !!deps.materialsPending },
      meta: { providerLabel: deps.providerLabel || "" },
    };
  }

  /* Gather deps from the live page (role.js calls this). Every source is optional. */
  function collectDeps(jobKey) {
    var app = root.JobBoredApp || {};
    var vm = root.JobBoredDawn && root.JobBoredDawn.data && root.JobBoredDawn.data.getRoleViewModel(jobKey);
    var rawJob = null;
    try { rawJob = app.core && app.core.getJobByStableKey ? app.core.getJobByStableKey(jobKey) : null; } catch (e) { rawJob = null; }
    var keywords = null;
    try { keywords = rawJob && app.keywordMatch && app.keywordMatch.analyzeJob ? app.keywordMatch.analyzeJob(rawJob) : null; } catch (e) { keywords = null; }
    var scorecard = null;
    try { scorecard = rawJob && app.materialsState && app.materialsState.getScorecardForJob ? app.materialsState.getScorecardForJob(rawJob) : null; } catch (e) { scorecard = null; }
    var mat = root.JobBoredRoleMaterials && root.JobBoredRoleMaterials.getCurrentManifest ? root.JobBoredRoleMaterials.getCurrentManifest() : null;
    var health = rawJob && root.JobBoredExpiredReview && root.JobBoredExpiredReview.getPostingHealth ? root.JobBoredExpiredReview.getPostingHealth(rawJob) : null;
    var cfg = null;
    try { cfg = root.CommandCenterResumeGenerate && root.CommandCenterResumeGenerate.getResumeGenerationConfig ? root.CommandCenterResumeGenerate.getResumeGenerationConfig() : null; } catch (e) { cfg = null; }
    var providerId = cfg && cfg.provider ? String(cfg.provider).toLowerCase() : "";
    var stages = root.JobBoredStages;
    return {
      vm: vm || { job: {} }, job: rawJob, keywords: keywords, scorecard: scorecard,
      manifest: mat && String(mat.jobKey) === String(jobKey) ? mat.manifest : null, materialsError: "",
      health: health, stages: stages,
      providerLabel: providerId ? (PROVIDER_LABELS[providerId] || providerId.charAt(0).toUpperCase() + providerId.slice(1)) : "",
      nowMs: Date.now(),
      parseDate: function (s) { var t = Date.parse(String(s || "")); return Number.isFinite(t) ? t : null; },
      keywordsPending: !keywords && !!(app.keywordMatch && app.keywordMatch.getCandidateProfileMatchCache && !app.keywordMatch.getCandidateProfileMatchCache().loaded),
      materialsPending: false,
    };
  }

  root.JobBoredCase = root.JobBoredCase || {};
  root.JobBoredCase.model = { buildCaseModel: buildCaseModel, collectDeps: collectDeps, CASE_DOC_TYPES: CASE_DOC_TYPES };
})(typeof window !== "undefined" ? window : globalThis);
```

Notes for the implementer: `job.foundAt` and `job.talkingPoints` come from Task 1. `app.core.getJobByStableKey` — find the real accessor for a raw pipeline job by stable key (grep `stableKey` in `app-config-core.js` / `app-compat.js`); if none exists, add a one-line lookup over the loaded jobs array and expose it on `JobBoredApp.core`. The unit tests inject `deps`, so `collectDeps` is covered by Task 8's interaction tests, not here.

- [ ] **Step 4: Run** `node --test tests/role-case-model.test.mjs` → PASS. Adjust fixture expectations only where the spec (§3, §4) says the model should behave differently — never to match an implementation bug.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(dossier): The Case model — pure assembly from sheet, scrape, ai, derived, files"`

---

## Phase 2 — The Case renderer

### Task 7: `role-case.js` + `role-case.css`

**Files:**
- Create: `role-case.js`, `role-case.css`
- Modify: `index.html` — `<link rel="stylesheet" href="role-case.css" />` after `role.css`; `<script src="role-case.js" defer></script>` after `role-case-model.js`
- Test: create `tests/role-case-render.test.mjs`

**Interfaces:**
- Consumes: `CaseModel` (Task 6), `window.JobBoredText`.
- Produces: `window.JobBoredCase.render(mount, model)`; DOM contract (classes `case__*`, `data-action` values per spec §5, mounts `[data-mount="materials"]`).

- [ ] **Step 1: Failing tests** (vm harness; evaluate `jb-text.js`, `role-case-model.js`, `role-case.js`; use the Task 6 `baseDeps()` fixture to produce a model)

```js
describe("The Case renders every block from the model", () => {
  it("rail, stepper, numbers, one-line", () => {
    const html = renderHtml(model());
    assert.match(html, /<header class="case__rail">/);
    assert.match(html, /<input[^>]*data-action="edit-field"[^>]*data-field="title"[^>]*value="Senior PM"/);
    assert.match(html, /data-action="brief-view-posting"[^>]*href="https:\/\/jobs\.test\/1"/);
    assert.match(html, /class="case__pill case__pill--due"[^>]*>[\s\S]*?2026-09-04[\s\S]*?in 3 days/);
    assert.match(html, /class="case__pill case__pill--open"/);
    assert.match(html, /<button[^>]*data-action="stage-step"[^>]*data-stage="applied"/);
    assert.match(html, /class="case__step case__step--now"[^>]*>[\s\S]*?researching[\s\S]*?day 2/i);
    assert.match(html, /<div class="case__num"[^>]*data-num="fit">[\s\S]*?8<small>\/10<\/small>/);
    assert.match(html, /data-num="keywords"[\s\S]*?74<small>%<\/small>[\s\S]*?12 found · 4 partial · 1 missing/);
    assert.match(html, /<button[^>]*data-action="open-profile-match"/);
    assert.match(html, /class="case__quote"[^>]*>[\s\S]*?Design infrastructure that ships\./);
  });
  it("they want / you have / your moves lanes", () => {
    const html = renderHtml(model());
    assert.match(html, /class="case__lane case__lane--they"[\s\S]*?<li[^>]*data-status="found"[^>]*>[\s\S]*?5\+ years design systems/);
    assert.match(html, /class="case__chip"[^>]*data-status="partial"[^>]*>[\s\S]*?Storybook/);
    assert.match(html, /class="case__lane case__lane--you"[\s\S]*?case__sev--high[\s\S]*?Experimentation/);
    assert.match(html, /class="case__dim"[\s\S]*?style="width: 84%;"/);
    assert.match(html, /class="case__lane case__lane--moves"[\s\S]*?<span class="case__idx">01<\/span>/);
    assert.match(html, /<div class="case__materials" data-mount="materials"><\/div>/);
    assert.match(html, /<input[^>]*data-action="edit-field"[^>]*data-field="followupAt"[^>]*type="date"[^>]*value="2026-09-04"/);
    assert.match(html, /<button[^>]*data-action="edit-field"[^>]*data-field="reply"[^>]*data-value="Yes"/);
    assert.match(html, /<textarea[^>]*data-action="notes"[^>]*>Recruiter: Dana<\/textarea>/);
  });
  it("record with hollow future step and configured provider", () => {
    const html = renderHtml(model());
    assert.match(html, /class="case__ev case__ev--future"[\s\S]*?Applied[\s\S]*?Not yet/);
    assert.match(html, /Enriched[\s\S]*?OpenAI/);
    assert.doesNotMatch(html, /Gemini/);
  });
  it("hides blocks with no inputs and shows the no-resume line", () => {
    const html = renderHtml(model({ keywords: null, scorecard: null, manifest: null, vmPatch: { followUpDate: "" } }));
    assert.doesNotMatch(html, /case__pill--due/);
    assert.doesNotMatch(html, /data-num="keywords"/);
    assert.doesNotMatch(html, /case__lane--you/);
    assert.match(html, /Add a resume to see what matches/);
  });
  it("escapes exactly once", () => {
    const html = renderHtml(model({ vmPatch: { role: 'Eng <b>"x"</b> & co' } }));
    assert.match(html, /value="Eng &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; co"/);
    assert.doesNotMatch(html, /&amp;amp;/);
  });
  it("terminal stage collapses the stepper", () => {
    const html = renderHtml(model({ vmPatch: { stage: "rejected" } }));
    assert.match(html, /class="case__terminal"[^>]*>[\s\S]*?rejected/i);
    assert.doesNotMatch(html, /data-action="stage-step"/);
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement `role-case.js`**

```js
/* ============================================================
   role-case.js — The Case renderer (spec §2.1, §5, §7)
   window.JobBoredCase.render(mount, model). String templates,
   escape exactly once; role.js wires every data-action.
   ============================================================ */
(function (root) {
  "use strict";

  function esc(s) { return root.JobBoredText.escapeHtml(s); }
  function attr(s) { return root.JobBoredText.escapeAttr(s); }
  function src(kind, extra) { return '<span class="case__src case__src--' + esc(kind) + '">' + esc(extra || kind) + "</span>"; }
  function safeHref(h) { var s = String(h || "").trim(); return /^https?:|^mailto:/i.test(s) ? s : ""; }
  var GUARDS = ' autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

  function editInput(field, value, cls, label, extra) {
    return '<input type="text" class="' + cls + '" data-action="edit-field" data-field="' + field + '"' +
      ' data-original="' + attr(value) + '" value="' + attr(value) + '" aria-label="' + attr(label) + '"' + (extra || "") + GUARDS + ">";
  }

  function renderRail(m) {
    var id = m.identity;
    var logo = id.logoUrl && safeHref(id.logoUrl)
      ? '<img class="case__logo" src="' + attr(id.logoUrl) + '" alt="">'
      : '<div class="case__logo case__logo--mono">' + esc((id.company || "?").charAt(0).toUpperCase()) + "</div>";
    var meta = [];
    if (id.location || id.employment) meta.push(esc([id.location, id.employment].filter(Boolean).join(" · ")));
    if (id.salary) meta.push("<b>" + esc(id.salary) + "</b>");
    if (id.source) meta.push("via " + esc(id.source));
    if (id.foundAt) meta.push("Found " + esc(id.foundAt));
    if (id.priority) meta.push("Priority <b>" + esc(id.priority.charAt(0).toUpperCase() + id.priority.slice(1)) + "</b>");
    if (id.favorite) meta.push("<b>&#9733;</b> Favorite");
    var pills = "";
    if (m.nextAction) {
      var d = m.nextAction.daysUntil;
      var when = d == null ? "" : (d < 0 ? " · " + Math.abs(d) + "d overdue" : d === 0 ? " · today" : " · in " + d + " day" + (d === 1 ? "" : "s"));
      pills += '<span class="case__pill case__pill--due"><span class="case__dot case__dot--amber"></span>Follow-up ' + esc(m.nextAction.followUpAt) + esc(when) + "</span>";
    }
    if (m.health && m.health.state !== "unknown") {
      var cls = m.health.state === "open" ? "open" : (m.health.state === "expired" ? "expired" : "review");
      pills += '<span class="case__pill case__pill--' + cls + '"><span class="case__dot case__dot--' + (cls === "open" ? "mint" : "crimson") + '"></span>' +
        esc(m.health.label) + (m.health.checkedAt ? " · checked " + esc(m.health.checkedAt.slice(0, 10)) : "") + "</span>";
    }
    var link = safeHref(id.link);
    var view = link ? '<a class="case__cta" data-action="brief-view-posting" href="' + attr(link) + '" target="_blank" rel="noopener">View posting</a>' : "";
    return '<header class="case__rail">' + logo +
      '<div class="case__rail-id">' +
        editInput("title", id.title, "case__title", "Role title") +
        editInput("company", id.company, "case__company", "Company") +
        '<div class="case__meta">' + meta.map(function (x) { return "<span>" + x + "</span>"; }).join("") + "</div>" +
      "</div>" +
      '<div class="case__rail-right">' + pills + view + "</div>" +
    "</header>";
  }

  function renderStepper(m, stages) {
    if (m.stage.terminal) {
      return '<div class="case__stepper"><span class="case__terminal">' + esc(m.stage.current) + (m.stage.appliedAt ? " · applied " + esc(m.stage.appliedAt) : "") + "</span></div>";
    }
    var cur = m.stage.order.indexOf(m.stage.current);
    return '<div class="case__stepper">' + m.stage.order.map(function (key, i) {
      var state = i < cur ? "done" : (i === cur ? "now" : "");
      var days = i === cur && m.stage.daysInStage != null ? ' <span class="case__step-days">· day ' + esc(String(m.stage.daysInStage)) + "</span>" : "";
      var label = stages && stages.toLabel ? stages.toLabel(key) : key;
      return (i ? '<span class="case__step-line"></span>' : "") +
        '<button type="button" class="case__step' + (state ? " case__step--" + state : "") + '" data-action="stage-step" data-stage="' + attr(key) + '">' +
          '<span class="case__step-dot"></span>' + esc(label) + days + "</button>";
    }).join("") + "</div>";
  }

  function renderNumbers(m) {
    var n = m.numbers, tiles = [];
    if (n.fit) tiles.push(tile("fit", "Fit", src("sheet"), esc(String(n.fit.value)) + "<small>/" + n.fit.max + "</small>", "Your agent's score"));
    if (n.ats) tiles.push(tile("ats", "ATS", src("ai"), '<span class="case__num-v--crimson">' + esc(String(n.ats.value)) + "</span><small>/100</small>", "Resume vs. posting"));
    if (n.keywords) tiles.push('<button type="button" class="case__num case__num--btn" data-num="keywords" data-action="open-profile-match">' +
      '<div class="case__num-k">Keywords ' + src("derived") + '</div><div class="case__num-v">' + esc(String(n.keywords.percentage)) + "<small>%</small></div>" +
      '<div class="case__num-sub">' + esc(n.keywords.found + " found · " + n.keywords.partial + " partial · " + n.keywords.missing + " missing") + "</div></button>");
    tiles.push(tile("reply", "Reply", src("sheet"), esc(n.reply.value), m.nextAction && m.nextAction.lastContactAt ? "Last contact " + esc(m.nextAction.lastContactAt) : ""));
    if (n.materials) tiles.push(tile("materials", "Materials", src("files"), esc(String(n.materials.ready)) + "<small>/" + n.materials.total + "</small>", n.materials.drafting ? esc(n.materials.drafting + " drafting") : "All ready"));
    return tiles.length >= 2 ? '<div class="case__numbers" data-count="' + tiles.length + '">' + tiles.join("") + "</div>" : "";
  }
  function tile(key, k, s, v, sub) {
    return '<div class="case__num" data-num="' + key + '"><div class="case__num-k">' + esc(k) + " " + s + '</div><div class="case__num-v">' + v + "</div>" + (sub ? '<div class="case__num-sub">' + sub + "</div>" : "") + "</div>";
  }

  function marked(list, cls, hasMatch) {
    return list.map(function (it) {
      var st = hasMatch ? it.status : "unknown";
      return "<li" + (cls ? ' class="' + cls + '"' : "") + ' data-status="' + st + '"><span class="case__m case__m--' + st + '"></span><span>' + esc(it.text) + "</span>" +
        (hasMatch && st !== "unknown" ? '<span class="case__st">' + esc(st) + "</span>" : "") + "</li>";
    }).join("");
  }
  function renderTheyWant(m) {
    var w = m.theyWant;
    if (m.loading.enrichment && !w.requirements.length) return '<section class="case__lane case__lane--they"><div class="case__lane-head"><span class="case__lane-title">They want</span></div>' + skeletonRows(4) + "</section>";
    if (!w.requirements.length && !w.niceToHaves.length && !w.stack.length) return "";
    var h = w.hasMatchData;
    var html = '<section class="case__lane case__lane--they"><div class="case__lane-head"><span class="case__lane-title">They want</span>' + src("scrape") + (h ? src("derived", "matched") : "") + "</div>";
    if (!h) html += '<p class="case__hint">Add a resume to see what matches.</p>';
    if (w.requirements.length) html += '<div class="case__sub">Requirements' + (h ? " · vs. your resume" : "") + '</div><ul class="case__req">' + marked(w.requirements, "", h) + "</ul>";
    if (w.stack.length) html += '<div class="case__sub">Stack they name</div><div class="case__chips">' + w.stack.map(function (s) { var st = h ? s.status : "unknown"; return '<span class="case__chip" data-status="' + st + '"><span class="case__m case__m--' + st + '"></span>' + esc(s.text) + "</span>"; }).join("") + "</div>";
    if (w.niceToHaves.length) html += '<div class="case__sub">Nice to have</div><ul class="case__req">' + marked(w.niceToHaves, "", h) + "</ul>";
    return html + "</section>";
  }
  function skeletonRows(n) { var s = ""; for (var i = 0; i < n; i++) s += '<span class="case__shimmer' + (i === n - 1 ? " case__shimmer--short" : "") + '"></span>'; return '<div class="case__skeleton" aria-busy="true">' + s + "</div>"; }

  function renderYouHave(m) {
    var y = m.youHave;
    if (y.source === "none") return "";
    var html = '<section class="case__lane case__lane--you"><div class="case__lane-head"><span class="case__lane-title">You have</span>' + (y.source === "scorecard" ? src("ai", "ai · scorecard") : src("derived", "keyword match")) + "</div>";
    if (y.strengths.length) html += '<div class="case__sub">Strengths</div>' + y.strengths.map(function (s) { return '<div class="case__strength">' + esc(s) + "</div>"; }).join("");
    if (y.evidence.length) html += y.evidence.map(function (e) { return '<div class="case__evidence"><span class="case__from">Evidence' + (e.sourceType ? " · from your " + esc(e.sourceType) : "") + "</span>&ldquo;" + esc(e.sourceSnippet || e.claim) + "&rdquo;</div>"; }).join("");
    if (y.gaps.length) html += '<div class="case__sub">Gaps</div>' + y.gaps.map(function (g) { return '<div class="case__gap"><span class="case__sev case__sev--' + esc(g.severity) + '">' + esc(g.severity === "medium" ? "med" : g.severity) + "</span><span>" + esc(g.gap) + (g.whyItMatters ? '<span class="case__why">' + esc(g.whyItMatters) + "</span>" : "") + "</span></div>"; }).join("");
    if (y.dimensions.length) html += '<div class="case__sub">Scorecard dimensions</div><div class="case__dims">' + y.dimensions.map(function (d) { return '<div class="case__dim"><span>' + esc(d.label) + '</span><span class="case__bar"><i style="width: ' + d.score + '%;"></i></span><b>' + d.score + "</b></div>"; }).join("") + "</div>";
    if (y.storedAt) html += '<div class="case__stamp">Scored ' + esc(String(y.storedAt).slice(0, 10)) + "</div>";
    return html + "</section>";
  }

  function renderMoves(m) {
    var v = m.moves, p = v.people;
    var html = '<section class="case__lane case__lane--moves"><div class="case__lane-head"><span class="case__lane-title">Your moves</span>' + src("ai") + src("sheet") + src("files") + "</div>";
    if (v.talkingPoints.length) html += '<div class="case__sub">Say this</div><ul class="case__tp">' + v.talkingPoints.map(function (t, i) { return '<li><span class="case__idx">' + (i < 9 ? "0" : "") + (i + 1) + "</span><span>" + esc(t) + "</span></li>"; }).join("") + "</ul>";
    html += '<div class="case__sub">Materials</div><div class="case__materials" data-mount="materials"></div>';
    html += '<div class="case__sub">People</div><ul class="case__kv">' +
      '<li><span class="case__k">Contact</span>' + editInput("contact", p.contact, "case__v case__v--edit", "Contact", ' placeholder="Add a contact"') + "</li>" +
      '<li><span class="case__k">Last contact</span>' + editInput("heardBack", p.lastContactAt, "case__v case__v--edit", "Last contact", ' placeholder="e.g. Aug 30"') + "</li>" +
      '<li><span class="case__k">Replied</span><button type="button" class="case__v case__v--toggle' + (p.replied === "Yes" ? "" : " case__v--warn") + '" data-action="edit-field" data-field="reply" data-value="' + (p.replied === "Yes" ? "No" : "Yes") + '" aria-label="Toggle replied">' + esc(p.replied) + "</button></li>" +
      '<li><span class="case__k">Follow-up</span><input type="date" class="case__v case__v--edit" data-action="edit-field" data-field="followupAt" data-original="' + attr(p.followUpAt) + '" value="' + attr(p.followUpAt) + '" aria-label="Follow-up date"></li>' +
    "</ul>";
    return html + "</section>";
  }

  function renderNotes(m) {
    var body = m.notes ? m.notes.body : "";
    return '<div class="case__notes"><textarea data-action="notes" placeholder="Interview prep, recruiter name, links you’ve gathered, next steps…">' + esc(body) + "</textarea></div>";
  }

  function renderRecord(m) {
    if (!m.record.length) return "";
    return '<div class="case__chron"><div class="case__chron-head"><span class="case__chron-title">The record</span><span class="case__chron-rule"></span>' + src("sheet") + src("files") + "</div>" +
      '<div class="case__events" data-count="' + m.record.length + '">' + m.record.map(function (e) {
        return '<div class="case__ev case__ev--' + esc(e.state) + '"><div class="case__ev-dot"></div><div class="case__ev-d">' + esc(e.at || "—") + '</div><div class="case__ev-t">' + esc(e.label) + (e.detail ? "<small>" + esc(e.detail) + "</small>" : "") + "</div></div>";
      }).join("") + "</div></div>";
  }

  function render(mount, model) {
    if (!mount || !model) return;
    var stages = root.JobBoredStages;
    var lanes = renderTheyWant(model) + renderYouHave(model) + renderMoves(model);
    mount.innerHTML = '<div class="case">' +
      renderRail(model) + renderStepper(model, stages) + renderNumbers(model) +
      (model.oneLine ? '<div class="case__quote"><span class="case__k">In their words</span>' + esc(model.oneLine) + "</div>" : "") +
      '<div class="case__board">' + lanes + "</div>" +
      renderNotes(model) + renderRecord(model) +
    "</div>";
  }

  root.JobBoredCase = root.JobBoredCase || {};
  root.JobBoredCase.render = render;
})(typeof window !== "undefined" ? window : globalThis);
```

Note for the implementer: the `contact` field is not in `flowing-writes.js`'s writeback set today (title/company/location/salary/heardBack/reply/followupAt/passed). Either add a `contact` writer to `flowing-writes.js` (column L, same `writeColumn` pattern as `writeHeardBack`) in Task 8, or render contact as static text — the spec (§5) lists it as editable, so add the writer.

- [ ] **Step 4: Implement `role-case.css`** — transcribe the mockup's values (`Redesign.dc.html` in the review canvas) into `case__*` rules. Required rules, with exact values:

```css
/* role-case.css — The Case (spec §7). Loaded after role.css. */
body.jb-v2 [data-region="role"] .case { max-width: 1240px; margin: 0 auto; background: var(--parchment); border: 1px solid var(--border, #E5DFCC); border-radius: 14px; box-shadow: var(--shadow-soft); overflow: hidden; font-family: var(--sans); color: var(--ink); }
.case__rail { background: var(--navy); color: var(--parchment); padding: 22px 36px 20px; display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; gap: 20px; align-items: center; }
.case__logo { width: 56px; height: 56px; border-radius: 12px; object-fit: cover; background: var(--parchment); }
.case__logo--mono { display: flex; align-items: center; justify-content: center; color: var(--navy); font-family: var(--serif); font-size: 26px; font-weight: 600; }
.case__title, .case__company { display: block; width: 100%; appearance: none; border: none; border-bottom: 1px dashed transparent; background: transparent; outline: none; padding: 1px 0; color: var(--parchment); font-family: var(--serif); }
.case__title { font-size: 26px; line-height: 1.15; font-weight: 500; }
.case__company { font-style: italic; font-size: 16px; color: var(--mint); margin-top: 2px; }
.case__rail [data-action="edit-field"]:hover { border-bottom-color: rgba(251, 247, 236, 0.35); }
.case__rail [data-action="edit-field"]:focus { border-bottom-color: var(--amber); }
.case__meta { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(251, 247, 236, 0.72); }
.case__meta b { color: var(--parchment); font-weight: 600; }
.case__rail-right { display: grid; gap: 10px; justify-items: end; }
.case__pill { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; border: 1px solid rgba(251, 247, 236, 0.35); font-family: var(--mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--parchment); }
.case__pill--open { border-color: var(--mint-deep); color: var(--mint); }
.case__pill--due { border-color: var(--amber); color: var(--amber); }
.case__pill--review, .case__pill--expired { border-color: var(--crimson); color: #F2B8C0; }
.case__dot { width: 7px; height: 7px; border-radius: 50%; }
.case__dot--mint { background: var(--mint-deep); box-shadow: 0 0 0 3px rgba(110, 159, 135, 0.25); }
.case__dot--amber { background: var(--amber); box-shadow: 0 0 0 3px rgba(231, 181, 73, 0.25); }
.case__dot--crimson { background: var(--crimson); box-shadow: 0 0 0 3px rgba(178, 58, 72, 0.25); }
.case__cta { font-family: var(--mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--parchment); text-decoration: none; border: 1px solid rgba(251, 247, 236, 0.35); border-radius: 999px; padding: 6px 12px; }
.case__stepper { display: flex; align-items: center; padding: 14px 36px; background: var(--parchment-deep); border-bottom: 1px solid var(--border, #E5DFCC); overflow-x: auto; }
.case__step { display: inline-flex; align-items: center; gap: 8px; border: none; background: transparent; cursor: pointer; padding: 4px 0; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--mute); white-space: nowrap; }
.case__step-dot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--border-strong); background: var(--parchment); }
.case__step--done .case__step-dot { background: var(--navy); border-color: var(--navy); }
.case__step--now { color: var(--navy); font-weight: 600; }
.case__step--now .case__step-dot { background: var(--crimson); border-color: var(--crimson); box-shadow: 0 0 0 4px rgba(178, 58, 72, 0.18); }
.case__step-line { flex: 1; height: 1px; background: var(--border-strong); margin: 0 12px; min-width: 18px; }
.case__step-days { color: var(--crimson); font-weight: 600; letter-spacing: 0.08em; }
.case__terminal { font-family: var(--mono); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--crimson); border: 1px solid var(--crimson); border-radius: 999px; padding: 5px 12px; }
.case__numbers { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-bottom: 1px solid var(--border, #E5DFCC); }
.case__num { padding: 18px 22px 16px; border-right: 1px dotted var(--border-strong); text-align: left; background: transparent; border-top: none; border-bottom: none; border-left: none; font: inherit; color: inherit; }
.case__num:last-child { border-right: none; }
.case__num--btn { cursor: pointer; }
.case__num-k { font-family: var(--mono); font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--mute); margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
.case__num-v { font-family: var(--serif); font-size: 30px; font-weight: 600; line-height: 1; color: var(--navy); letter-spacing: -0.01em; }
.case__num-v small { font-family: var(--mono); font-size: 10px; color: var(--mute); font-weight: 400; letter-spacing: 0.1em; margin-left: 3px; }
.case__num-v--crimson { color: var(--crimson); }
.case__num-sub { font-family: var(--mono); font-size: 9.5px; color: var(--ink-soft); letter-spacing: 0.04em; margin-top: 8px; }
.case__src { font-family: var(--mono); font-size: 7.5px; letter-spacing: 0.18em; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; border: 1px solid var(--border-strong); color: var(--mute); background: var(--surface, #FFFEF9); }
.case__src--ai { border-color: rgba(178, 58, 72, 0.4); color: var(--crimson); }
.case__src--derived { border-color: rgba(110, 159, 135, 0.6); color: var(--mint-deep); }
.case__quote { padding: 16px 36px; border-bottom: 1px dashed var(--border, #E5DFCC); font-family: var(--serif); font-style: italic; font-size: 16px; color: var(--navy); display: flex; gap: 12px; align-items: baseline; overflow-wrap: anywhere; }
.case__quote .case__k { font-family: var(--mono); font-style: normal; font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--mute); white-space: nowrap; }
.case__board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.case__lane { padding: 22px 24px 26px; border-right: 1px solid var(--border, #E5DFCC); min-width: 0; }
.case__lane:last-child { border-right: none; }
.case__lane-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 2px solid; }
.case__lane--they .case__lane-head { border-color: var(--crimson); }
.case__lane--you .case__lane-head { border-color: var(--mint-deep); }
.case__lane--moves .case__lane-head { border-color: var(--amber); }
.case__lane-title { font-family: var(--mono); font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--navy); font-weight: 600; flex: 1; }
.case__sub { font-family: var(--mono); font-size: 8.5px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--mute); margin: 18px 0 8px; }
.case__lane-head + .case__sub, .case__hint + .case__sub { margin-top: 0; }
.case__hint { margin: 0 0 12px; font-family: var(--serif); font-style: italic; font-size: 13px; color: var(--mute); }
.case__req { list-style: none; margin: 0; padding: 0; }
.case__req li { display: grid; grid-template-columns: 14px 1fr auto; gap: 10px; align-items: baseline; padding: 7px 0; border-bottom: 1px dotted var(--border-strong); font-family: var(--serif); font-size: 14.5px; line-height: 1.45; overflow-wrap: anywhere; }
.case__req li:last-child { border-bottom: none; }
.case__m { width: 9px; height: 9px; border-radius: 50%; position: relative; top: 1px; display: inline-block; }
.case__m--found { background: var(--mint-deep); }
.case__m--partial { background: var(--amber); }
.case__m--missing { background: var(--crimson); }
.case__m--unknown { background: transparent; border: 1px solid var(--border-strong); }
.case__st { font-family: var(--mono); font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--mute); }
.case__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.case__chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: var(--surface, #FFFEF9); border: 1px solid var(--border-strong); font-family: var(--mono); font-size: 10.5px; color: var(--ink-soft); }
.case__chip .case__m { width: 7px; height: 7px; top: 0; }
.case__strength { padding: 8px 0 8px 14px; border-left: 2px solid var(--mint-deep); margin-bottom: 8px; font-family: var(--serif); font-size: 14.5px; line-height: 1.45; overflow-wrap: anywhere; }
.case__evidence { margin-top: 6px; padding: 10px 12px; background: var(--surface, #FFFEF9); border: 1px solid var(--border, #E5DFCC); border-radius: 8px; font-family: var(--serif); font-style: italic; font-size: 13.5px; line-height: 1.5; color: var(--ink-soft); overflow-wrap: anywhere; }
.case__from { display: block; font-family: var(--mono); font-style: normal; font-size: 8px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--mint-deep); margin-bottom: 4px; }
.case__gap { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1px dotted var(--border-strong); font-family: var(--serif); font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.case__gap:last-of-type { border-bottom: none; }
.case__sev { font-family: var(--mono); font-size: 8px; letter-spacing: 0.18em; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; }
.case__sev--high { background: rgba(178, 58, 72, 0.12); color: var(--crimson); }
.case__sev--medium, .case__sev--low { background: rgba(231, 181, 73, 0.18); color: #A6782E; }
.case__why { display: block; font-size: 12.5px; color: var(--mute); font-style: italic; margin-top: 2px; }
.case__dims { display: grid; gap: 6px; margin-top: 4px; }
.case__dim { display: grid; grid-template-columns: 118px 1fr 30px; gap: 10px; align-items: center; font-family: var(--mono); font-size: 9px; letter-spacing: 0.08em; color: var(--ink-soft); text-transform: uppercase; }
.case__bar { height: 6px; background: var(--parchment-deep); border-radius: 3px; overflow: hidden; }
.case__bar i { display: block; height: 100%; background: var(--mint-deep); border-radius: 3px; }
.case__dim b { text-align: right; color: var(--navy); }
.case__stamp { margin-top: 12px; font-family: var(--mono); font-size: 8.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--mute); }
.case__tp { list-style: none; margin: 0; padding: 0; }
.case__tp li { display: grid; grid-template-columns: 26px 1fr; gap: 8px; padding: 8px 0; border-bottom: 1px dotted var(--border-strong); font-family: var(--serif); font-size: 14.5px; line-height: 1.45; overflow-wrap: anywhere; }
.case__tp li:last-child { border-bottom: none; }
.case__idx { font-family: var(--mono); font-size: 10px; color: var(--crimson); letter-spacing: 0.1em; padding-top: 2px; }
.case__kv { list-style: none; margin: 0; padding: 0; }
.case__kv li { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px dotted var(--border-strong); align-items: baseline; }
.case__kv li:last-child { border-bottom: none; }
.case__k { font-family: var(--mono); font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--mute); white-space: nowrap; }
.case__v { font-family: var(--serif); font-size: 14px; color: var(--navy); font-weight: 500; text-align: right; }
.case__v--edit { appearance: none; border: none; border-bottom: 1px dashed transparent; background: transparent; outline: none; padding: 0 2px; min-width: 0; width: 60%; font: inherit; color: inherit; text-align: right; }
.case__v--edit:hover { border-bottom-color: var(--border-strong); }
.case__v--edit:focus { border-bottom-color: var(--crimson); }
.case__v--toggle { border: none; background: transparent; cursor: pointer; font: inherit; color: inherit; padding: 0; }
.case__v--warn { color: var(--crimson); }
.case__notes { margin: 0 36px; padding: 18px 20px; background: var(--parchment-deep); border: 1px solid var(--border, #E5DFCC); border-radius: 10px; position: relative; }
.case__notes::before { content: "NOTES · YOURS"; position: absolute; top: -9px; left: 16px; background: var(--parchment); padding: 0 8px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.24em; color: var(--crimson); }
.case__notes textarea { width: 100%; min-height: 96px; border: none; border-bottom: 1px dashed var(--border-strong); background: transparent; padding: 8px 4px; font-family: "Special Elite", var(--mono); font-size: 14px; line-height: 1.65; color: var(--ink); resize: vertical; outline: none; }
.case__notes textarea:focus { border-bottom-color: var(--crimson); }
.case__chron { padding: 28px 36px 34px; }
.case__chron-head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.case__chron-title { font-family: var(--mono); font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--navy); font-weight: 600; }
.case__chron-rule { flex: 1; height: 1px; background: var(--border-strong); opacity: 0.6; }
.case__events { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); position: relative; }
.case__events::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 1px; background: var(--border-strong); }
.case__ev { position: relative; padding-right: 12px; }
.case__ev-dot { width: 15px; height: 15px; border-radius: 50%; background: var(--navy); border: 3px solid var(--parchment); box-shadow: 0 0 0 1px var(--border-strong); }
.case__ev--future .case__ev-dot { background: var(--parchment); }
.case__ev--due .case__ev-dot { background: var(--amber); }
.case__ev-d { font-family: var(--mono); font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--mute); margin: 10px 0 4px; }
.case__ev-t { font-family: var(--serif); font-size: 14px; line-height: 1.4; color: var(--ink); overflow-wrap: anywhere; }
.case__ev-t small { display: block; font-family: var(--mono); font-size: 8.5px; letter-spacing: 0.1em; color: var(--mute); margin-top: 3px; text-transform: uppercase; }
.case__ev--future .case__ev-t { color: var(--mute); font-style: italic; }
.case__skeleton { display: grid; gap: 8px; }
.case__shimmer { display: block; height: 12px; border-radius: 3px; background: linear-gradient(90deg, rgba(165, 207, 184, 0.10) 0%, rgba(165, 207, 184, 0.32) 38%, rgba(255, 247, 230, 0.55) 50%, rgba(165, 207, 184, 0.32) 62%, rgba(165, 207, 184, 0.10) 100%), var(--parchment-deep); background-size: 220% 100%, 100% 100%; animation: case-shimmer 1.8s ease-in-out infinite; }
.case__shimmer--short { width: 65%; }
@keyframes case-shimmer { 0% { background-position: 120% 0, 0 0; } 100% { background-position: -120% 0, 0 0; } }
@media (prefers-reduced-motion: reduce) { .case__shimmer { animation: none; } }
@media (max-width: 1080px) {
  .case__numbers { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .case__board { grid-template-columns: 1fr; }
  .case__lane { border-right: none; border-bottom: 1px solid var(--border, #E5DFCC); }
  .case__events { grid-auto-flow: row; grid-auto-columns: auto; gap: 14px; }
  .case__events::before { display: none; }
}
@media (max-width: 720px) {
  .case__rail { grid-template-columns: 56px minmax(0, 1fr); }
  .case__rail-right { grid-column: 1 / -1; justify-items: start; }
  .case__numbers { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
```

- [ ] **Step 5: Run** `node --test tests/role-case-render.test.mjs tests/index-html-cold-start.test.mjs tests/index-html-size.test.mjs` → PASS.

- [ ] **Step 6: `npm test` + commit** — `git commit -m "feat(dossier): The Case renderer + stylesheet (not yet wired)"`

---

## Phase 3 — Cutover and interactions

### Task 8: role.js renders The Case and wires its actions

**Files:**
- Modify: `role.js` (`renderDossier` ~120, `wireRegionClickOnce` ~142, `wireDossier` ~169, `init` ~276)
- Modify: `flowing-writes.js` (add `contact` writer → column L, plus the `case "contact":` dispatch branch)
- Test: create `tests/role-case-interactions.test.mjs`; update `tests/role-field-edit-render-guard.test.mjs` (rail selectors: `.case__title` etc.), append to `tests/role-writeback-bridge.test.mjs` for `contact`

**Interfaces:**
- Consumes: `JobBoredCase.model.collectDeps/buildCaseModel`, `JobBoredCase.render`, existing `dispatch`.
- Produces: events per spec §5; re-render triggers on `jb:ats:state`, `jb:profile-match:ready`, `jb:materials:manifest`.

- [ ] **Step 1: Failing tests**

```js
describe("The Case interactions", () => {
  it("renders the case into the region for an open role", () => {
    const { region } = boot({ openKey: "job-1" });
    assert.ok(region.querySelector(".case__rail"));
    assert.ok(region.querySelector('[data-mount="materials"]'));
  });
  it("stage step click dispatches jb:pipeline:move", () => {
    const { region, events } = boot({ openKey: "job-1" });
    region.querySelector('[data-action="stage-step"][data-stage="applied"]').click();
    const ev = events.find((e) => e.type === "jb:pipeline:move");
    assert.deepEqual(ev.detail, { jobKey: "job-1", fromStage: "researching", toStage: "applied" });
  });
  it("follow-up date change dispatches writeback followupAt; replied toggle dispatches reply", () => {
    const { region, events } = boot({ openKey: "job-1" });
    const date = region.querySelector('[data-field="followupAt"]');
    date.value = "2026-09-10"; date.dispatch("change"); date.blur();
    assert.ok(events.some((e) => e.type === "jb:role:writeback" && e.detail.field === "followupAt" && e.detail.value === "2026-09-10"));
    region.querySelector('[data-field="reply"]').click();
    assert.ok(events.some((e) => e.type === "jb:role:writeback" && e.detail.field === "reply" && e.detail.value === "Yes"));
  });
  it("re-renders on jb:ats:state / jb:profile-match:ready / jb:materials:manifest unless an edit surface is focused", () => {
    const { region, win, renderCount } = boot({ openKey: "job-1" });
    const before = renderCount();
    win.dispatchEvent(new win.CustomEvent("jb:profile-match:ready", { detail: {} }));
    assert.equal(renderCount(), before + 1);
    region.querySelector('[data-action="notes"]').focus();
    win.dispatchEvent(new win.CustomEvent("jb:ats:state", { detail: { jobKey: "k", status: "success" } }));
    assert.equal(renderCount(), before + 1, "deferred while notes focused");
  });
});
```

(Harness: extend the render-guard harness — it already emulates region, inputs, focus, and the two script sources; add `jb-text.js`, `role-case-model.js`, `role-case.js`, stub `window.JobBoredStages` with the Task 6 fixture, stub `JobBoredDawn.data.getRoleViewModel` to return the Task 6 fixture job, and give stubs a `click()` that fires registered `click` listeners with bubbling up to the region.)

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement** in `role.js`

`renderDossier`:

```js
  function renderDossier(region, vm) {
    var job = (vm && vm.job) || {};
    region.innerHTML = '<div class="dossier"><article class="brief" data-mount="brief"></article></div>';
    var mount = region.querySelector('[data-mount="brief"]');
    var Case = root.JobBoredCase;
    if (mount && Case && Case.model && typeof Case.render === "function") {
      var deps = Case.model.collectDeps(job.jobKey || getCurrentJobKey());
      deps.vm = vm;
      Case.render(mount, Case.model.buildCaseModel(job.jobKey || getCurrentJobKey(), deps));
    } else if (mount && root.JobBoredDossierBrief && typeof root.JobBoredDossierBrief.renderBrief === "function") {
      root.JobBoredDossierBrief.renderBrief(mount, vm);
    }
    wireDossier(region, job);
  }
```

`wireRegionClickOnce` — add to the click walker:

```js
        if (action === "stage-step") {
          var toStage = t.getAttribute("data-stage");
          var now = region.querySelector(".case__step--now");
          var fromStage = now ? now.getAttribute("data-stage") : null;
          if (toStage && toStage !== fromStage) dispatch("jb:pipeline:move", { jobKey: getCurrentJobKey(), fromStage: fromStage, toStage: toStage });
          return;
        }
        if (action === "edit-field" && t.getAttribute("data-field") === "reply") {
          dispatch("jb:role:writeback", { jobKey: getCurrentJobKey(), field: "reply", value: t.getAttribute("data-value") || "Yes" });
          return;
        }
        if (action === "open-profile-match") {
          var km = root.JobBoredApp && root.JobBoredApp.keywordMatch;
          var core = root.JobBoredApp && root.JobBoredApp.core;
          var raw = core && core.getJobByStableKey ? core.getJobByStableKey(getCurrentJobKey()) : null;
          if (km && raw && typeof km.openProfileMatchModal === "function") km.openProfileMatchModal(raw);
          return;
        }
```

`wireDossier` — the existing `commitEditField` loop already handles `blur`/Enter/Escape for every `[data-action="edit-field"]` input. Two additions: guard non-input surfaces (the replied toggle is a `<button>` with no `value` — it is handled in the click walker above), and commit date inputs on `change`:

```js
    function commitEditField(input) {
      if (!input || typeof input.value !== "string") return;   // buttons (reply toggle) never commit here
      var field = input.getAttribute("data-field");
      var original = input.getAttribute("data-original") || "";
      var value = input.value.trim();
      if (value === original) return;
      dispatch("jb:role:writeback", { jobKey: jobKey, field: field, value: value });
    }
```

and inside the per-input wiring loop:

```js
        if (input.type === "date") input.addEventListener("change", function () { commitEditField(input); });
```

(`commitEditField` reads `data-field` — the new fields `followupAt`, `heardBack`, `contact` ride the same `jb:role:writeback` dispatch; the `reply` toggle is a button handled above.)

`init` — add three listeners, all funnelling through the guarded `renderForKey`:

```js
    root.addEventListener("jb:ats:state", rerenderOpenRole);
    root.addEventListener("jb:profile-match:ready", rerenderOpenRole);
    root.addEventListener("jb:materials:manifest", function (e) {
      var k = e && e.detail && e.detail.jobKey;
      var openKey = getCurrentJobKey();
      if (k == null || String(k) === String(openKey)) rerenderOpenRole();
    });
```

`flowing-writes.js` — add beside `writeHeardBack`:

```js
  var CONTACT_COLUMN = "L";
  function writeContact(jobKey, value) {
    return writeColumn(jobKey, CONTACT_COLUMN, value || "", "contact", "contact");
  }
```

and `case "contact": return writeContact(jobKey, value);` in the writeback switch (~line 531).

- [ ] **Step 4: Run** `node --test tests/role-case-interactions.test.mjs tests/role-field-edit-render-guard.test.mjs tests/role-writeback-bridge.test.mjs tests/dossier-workshop-events.test.mjs tests/flowing-writes-stage-resolve.test.mjs` → PASS. In the guard suite, retarget selectors from `.brief__title` to `.case__title` and keep every behavioral assertion.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(dossier): cut over to The Case; wire stepper, people, follow-up, re-render triggers"`

### Task 9: Materials rows inside the Case + loading states

**Files:**
- Modify: `role-materials.js` (`renderManifest` filter ~644, `renderCard` ~332, `renderEmpty` ~429, `renderError` ~690)
- Modify: `role-case.js` (materials mount already emitted; no change unless a class hook is needed)
- Test: update `tests/role-materials.test.mjs` (22 cases — retarget parent selector; assertions on card content stay), append compact-row cases

**Interfaces:**
- Produces: inside `[data-mount="materials"]`, one `.case__doc` row per `CASE_DOC_TYPES` entry: `<div class="case__doc" data-doc="resume"><div class="case__doc-n">Tailored resume<small>v3 · Aug 30</small></div><span class="case__docst case__docst--ready">ready</span><div class="case__doc-actions">…existing materials-* buttons…</div></div>`; missing resume/cover letter render a `Draft` button with `data-action="resume-tailor"|"resume-cover"`; pending rows show `phase · elapsed · attempt`.

- [ ] **Step 1: Failing tests**

```js
describe("materials rows in the case mount", () => {
  it("renders all four case docs, with draft buttons for missing ones", async () => {
    const { region, openRole } = bootMaterials({ mounts: ["materials"], manifest: { documents: [{ type: "resume", status: "ready", lastModifiedAt: "2026-08-30T09:00:00Z", files: [{ format: "pdf", url: "/f/resume.pdf" }] }], pending: { feature: "cover_letter", progress: { phase: "drafting", elapsedSeconds: 42, attempt: 1 } } } });
    await openRole("job-1");
    const rows = [...region.querySelectorAll(".case__doc")].map((r) => r.getAttribute("data-doc"));
    assert.deepEqual(rows, ["resume", "cover_letter", "manual_apply_checklist", "qa_report"]);
    assert.match(region.querySelector('[data-doc="cover_letter"]').innerHTML, /drafting · 42s · attempt 1/);
    assert.ok(region.querySelector('[data-doc="manual_apply_checklist"] [data-action="materials-preview"]') === null);
    assert.ok(region.querySelector('[data-doc="resume"] [data-action="materials-preview"]'));
  });
  it("falls back to the legacy panel in a brief-only mount", async () => {
    const { region, openRole } = bootMaterials({ mounts: ["brief"] });
    await openRole("job-1");
    assert.ok(region.querySelector('[data-mount="brief"] .brief-materials'));
  });
});
```

- [ ] **Step 2: Verify failure.**

- [ ] **Step 3: Implement** — in `renderManifest`, branch on the host: when `hostEl.matches('[data-mount="materials"]')`, render compact rows (`renderCaseRows(hostEl, manifest, base)`) instead of the panel:

```js
  function renderCaseRows(hostEl, manifest, base) {
    var Case = root.JobBoredCase && root.JobBoredCase.model;
    var defs = Case ? Case.CASE_DOC_TYPES : [];
    var docs = Array.isArray(manifest.documents) ? manifest.documents : [];
    var pending = manifest.pending && manifest.pending.progress ? manifest.pending : null;
    hostEl.innerHTML = defs.map(function (def) {
      var doc = docs.filter(function (d) { return d && d.type === def.type; })[0] || null;
      var isPending = !!(pending && String(manifest.pending.feature) === def.type && !/^(complete|done|failed)$/i.test(String(pending.progress.phase || "")));
      var status = isPending ? "drafting" : (doc && String(doc.status).toLowerCase() === "ready" ? "ready" : (doc ? "failed" : "missing"));
      var sub = isPending
        ? escapeHtml(String(pending.progress.phase || "drafting") + " · " + (Number(pending.progress.elapsedSeconds) || 0) + "s · attempt " + (Number(pending.progress.attempt) || 1))
        : (doc && doc.lastModifiedAt ? escapeHtml(String(doc.lastModifiedAt).slice(0, 10)) : (status === "missing" ? "not drafted" : ""));
      var actions = status === "ready" ? renderRowActions(def.type, doc, base, manifest)
        : (status === "missing" && def.draftAction ? '<button type="button" class="case__doc-btn" data-action="' + def.draftAction + '">Draft</button>' : "");
      return '<div class="case__doc" data-doc="' + def.type + '"><div class="case__doc-n">' + escapeHtml(def.label) + "<small>" + sub + "</small></div>" +
        '<span class="case__docst case__docst--' + status + '">' + status + "</span>" +
        '<div class="case__doc-actions">' + actions + "</div></div>";
    }).join("");
  }
```

`renderRowActions` reuses the existing preview/download/repair/dismiss button builders from `renderCard` (extract them into a helper if they are inline today). Add the `.case__doc*` rules to `role-case.css` (row: `display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 9px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 6px;` · `.case__docst` pill: mono 8.5px .18em uppercase, `--ready` mint, `--drafting` amber tint, `--failed` crimson, `--missing` mute dashed).

`renderError` / `renderEmpty` when the host is the materials mount: one `.case__hint` line instead of the panel.

- [ ] **Step 4: Run** `node --test tests/role-materials.test.mjs tests/role-materials-auto-draft.test.mjs tests/role-materials-manifest-events.test.mjs tests/role-case-interactions.test.mjs` → PASS.

- [ ] **Step 5: `npm test` + commit** — `git commit -m "feat(materials): compact document rows inside The Case"`

**Phase 3 exit criteria:** `npm test` green; manual smoke on a real role — the Case renders; clicking a stepper step moves the card; changing follow-up writes column P; toggling replied writes S; typing in Notes during a poll loses nothing; materials rows update while a draft is in flight; the YOU HAVE lane appears after a resume generate/refine and persists across reload.

---

## Phase 4 — Cleanup

### Task 10: Retire the Brief

**Files:**
- Delete: `role-brief.js`, `tests/dossier-brief-structure.test.mjs`, `tests/dossier-brief-content-formats.test.mjs` (if created by the resilience plan and not yet superseded)
- Modify: `index.html` (remove the `role-brief.js` script tag), `role.css` (delete the `.brief`, `.brief__*`, `.skim`, `.points`, `.brief-notes`, `.brief__skeleton*`, `.brief__shimmer*` blocks — keep `.jb-role-divider*`, `.jb-shelf*`, `.dossier`, `.stepper*`, `.writeback*`, `.chip*`, and `.brief-materials__*` only if the legacy panel path in role-materials is kept for the brief-only fallback; if Task 9's fallback is removed at the same time, delete those too), `role.js` (drop the `JobBoredDossierBrief` fallback branch), `DESIGN.md` / `AGENTS.md` (replace Brief references with The Case + spec link)
- Test: `tests/index-html-size.test.mjs` (budget may tighten), grep-based guard in `tests/role-case-render.test.mjs`: `assert.doesNotMatch(roleCssSource, /\.brief__lede/)`

- [ ] **Step 1: Add the guard assertion** to `tests/role-case-render.test.mjs`, run → FAIL.
- [ ] **Step 2: Delete / edit** as listed. `grep -rn "JobBoredDossierBrief\|role-brief" --include=*.js --include=*.html --include=*.md . | grep -v node_modules` must return nothing except CHANGELOG history.
- [ ] **Step 3: Run** `npm test` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "chore(dossier): retire the Brief renderer and its styles"`

---

## Phase 5 — Optional: surface posting dates from JSON-LD

### Task 11: `datePosted` / `validThrough` / `baseSalary` through the pipe

**Files:**
- Modify: `server/shared/job-scraper-core.mjs` (where the chosen JSON-LD posting is finalized — the scorer around line 949 already reads these fields), `posting-enrichment.js` (cache them), `pipeline-render.js` (`data-posted-at`, `data-closes-at`, `data-posting-salary`), `dawn-data.js`, `role-case-model.js` (identity.postedAt / closesAt; salary fallback when sheet G is empty), `role-case.js` (rail meta "Posted Aug 27 · closes Sep 30")
- Test: `tests/job-scraper-block-text.test.mjs` (append a JSON-LD fixture asserting `postedAt`/`closesAt` on the scrape result), `tests/dossier-card-attrs.test.mjs`, `tests/role-case-model.test.mjs`

- [ ] **Step 1: Failing tests** — scrape result exposes `postedAt: "2026-08-27"`, `closesAt: "2026-09-30"`, `postingSalary: "$185,000–$230,000"` from a JSON-LD fixture with `datePosted`, `validThrough`, `baseSalary{value{minValue,maxValue,unitText}}`; model renders `identity.postedAt`; rail shows "Posted 2026-08-27 · closes 2026-09-30".
- [ ] **Step 2–5:** implement the pass-through (scraper: read the three fields off the picked JobPosting object next to where `datePosted` is scored; format salary as `currency min–max`), thread the attrs, update the model/renderer, run the suites, `npm test`, commit `feat(dossier): show posting dates and posted salary from JSON-LD`.

---

## Final verification

- [ ] `npm test` green (includes `tests/integration/`).
- [ ] `grep -rn "Gemini" role*.js` → no hits (provider label comes from config).
- [ ] `grep -rn '"Must-haves"\|"Tools & stack"' *.js` → no hits outside the legacy drawer in `pipeline-render.js`.
- [ ] Manual smoke matrix (greenfield `?greenfield=1` or the headless signed-in recipe): fresh find with no enrichment; enriched role with a resume on file; role with a persisted scorecard; role with materials drafting; expired role; a role in Rejected.
- [ ] `CHANGELOG.md` Unreleased: "Dossier redesigned as The Case — status rail, stage stepper, numbers band, evidence board (requirements matched against your resume, ATS scorecard strengths/gaps), live materials, dated record."
- [ ] Request approval before push/PR (CI-worthiness gate).

## Self-review checklist

1. Every task's changed lines trace to a spec section (§2–§7).
2. No test weakened; retired tests are replaced by `role-case-render` / `role-case-interactions` cases covering the same behaviors (edit-field guard, notes contract, CTAs).
3. `data-action` names in Task 7's renderer match Task 8's wiring and the spec §5 table exactly (`stage-step`, `edit-field`+`data-field`, `open-profile-match`, `notes`, `brief-view-posting`, `resume-cover`, `resume-tailor`, `materials-*`).
4. The `CaseModel` keys used by the renderer (Task 7) exist in the model (Task 6): `identity`, `stage`, `nextAction`, `health`, `numbers`, `oneLine`, `theyWant`, `youHave`, `moves`, `notes`, `record`, `loading`, `meta`.
