# Mandatory Two-Track Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make completing both onboarding tracks (job discovery + use-on-other-devices) a guided, required step — auto-launch discovery after first-run, auto-chain go-live, and show a persistent "X of 2" setup bar with a session-only "Later" escape — without ever trapping the user.

**Architecture:** Pure rewiring of existing classic-global IIFE modules. No new modules. The completion flags (`isDiscoverySetupComplete` / `isGoLiveSetupComplete`) and host bridges (`requestDiscoverySetup` / `requestGoLiveSetup`) already exist; this changes *when* they fire and upgrades the what's-next banner into a setup-progress bar. Spec: `docs/superpowers/specs/2026-06-08-mandatory-onboarding-setup-design.md`.

**Tech Stack:** Vanilla JS (classic-global IIFEs on `window.JobBoredApp`), `node --test` (run via `npm test`, which includes `tests/integration/`), IndexedDB-backed user-content store, `sessionStorage` for the session snooze.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `index.html` | Banner markup | Add `#whatsNextSetupProgress` text slot + `#whatsNextLater` button inside the what's-next region |
| `whats-next-banner.js` | Banner gating + presentation | Session snooze in gate; "N of 2" progress text; `handleLater`; wire Later button |
| `first-run-wizard.js` | First-run done handoff | After Sheet→Provider done, auto-invoke the discovery handoff |
| `discovery-wizard-ui.js` | Discovery finish handoff | `recommendGoLiveAfterDiscoveryFinish` auto-opens go-live (not just banner refresh) |
| `go-live-wizard-ui.js` | Go-live finish handoff | On done, auto-open discovery if incomplete (symmetry) |
| `tests/whats-next-signpost.test.mjs`, `tests/go-live-cross-rec.test.mjs` | Behavior coverage | New cases for snooze, progress, auto-chain |

**Conventions:** match the surrounding files — `getEl(id)` helper, `host()` lookups via `window.JobBoredApp.core.host`, fire-and-forget async with `void`, `console.warn("[JobBored] ...", e)` on catch. Never `.skip` a test.

---

## Task 1: Session "Later" snooze + "X of 2" progress bar

**Files:**
- Modify: `index.html` (the `whats-next` region markup)
- Modify: `whats-next-banner.js`
- Test: `tests/whats-next-signpost.test.mjs`

- [ ] **Step 1: Add markup to `index.html`** inside the existing what's-next region (next to `#whatsNextDismiss`):

```html
<p id="whatsNextSetupProgress" class="whats-next-banner__progress" hidden aria-live="polite"></p>
<button id="whatsNextLater" class="whats-next-banner__later" type="button" hidden>Later</button>
```

- [ ] **Step 2: Write the failing test** in `tests/whats-next-signpost.test.mjs` (new describe block; follow the file's existing VM-context harness used by the "completion-awareness (FE-3)" block — reuse its `loadBanner`/stub helpers):

```javascript
describe("whats-next-banner — setup progress + session Later", () => {
  it("shows 'Finish setup — 1 of 2 complete' when only discovery is done", async () => {
    const { banner, doc, UC } = loadBanner({
      infraComplete: true, onboardingComplete: true, dismissed: false,
      discoveryComplete: true, goLiveComplete: false,
    });
    await banner.refreshBanner();
    assert.match(doc.getEl("whatsNextSetupProgress").textContent, /1 of 2/);
    assert.equal(doc.getEl("whatsNextSetupProgress").hasAttribute("hidden"), false);
  });

  it("handleLater hides the bar via sessionStorage and a re-render keeps it hidden", async () => {
    const { banner } = loadBanner({
      infraComplete: true, onboardingComplete: true, dismissed: false,
      discoveryComplete: false, goLiveComplete: false,
    });
    await banner.refreshBanner();
    assert.equal(banner.isBannerVisible(), true);
    banner.handleLater();
    assert.equal(banner.isBannerVisible(), false);
    await banner.refreshBanner();           // re-render in same "session"
    assert.equal(banner.isBannerVisible(), false);
  });

  it("Later snooze does NOT write the permanent whatsNextDismissed flag", async () => {
    const { banner, UC } = loadBanner({
      infraComplete: true, onboardingComplete: true, dismissed: false,
      discoveryComplete: false, goLiveComplete: false,
    });
    await banner.refreshBanner();
    banner.handleLater();
    assert.equal(UC.__dismissedWrites.length, 0, "Later must not call setWhatsNextDismissed");
  });
});
```

  > The harness needs a `sessionStorage` stub on the VM global (a plain `Map`-backed object with `getItem`/`setItem`) and `UC.__dismissedWrites` recording `setWhatsNextDismissed` calls. Add both to the existing `loadBanner` helper if absent.

- [ ] **Step 3: Run the test, expect FAIL**

Run: `node --test --test-name-pattern="setup progress \+ session Later" tests/whats-next-signpost.test.mjs`
Expected: FAIL (`handleLater` undefined; progress text empty).

- [ ] **Step 4: Implement in `whats-next-banner.js`.**

  (a) Add a session-snooze key + helpers near the top of the IIFE:

```javascript
  const SESSION_SNOOZE_KEY = "jobbored.whatsNext.snoozed";
  function isSessionSnoozed() {
    try { return window.sessionStorage.getItem(SESSION_SNOOZE_KEY) === "1"; }
    catch (_) { return false; }
  }
  function setSessionSnoozed() {
    try { window.sessionStorage.setItem(SESSION_SNOOZE_KEY, "1"); } catch (_) {}
  }
```

  (b) In `shouldRenderBanner(state)`, add the snooze short-circuit as the first check after the null guard (so a snoozed session hides regardless of progress):

```javascript
  function shouldRenderBanner(state) {
    if (!state) return false;
    if (isSessionSnoozed()) return false;
    if (
      state.infraComplete !== true ||
      state.dismissed !== false ||
      state.onboardingComplete !== true
    ) return false;
    if (state.discoveryComplete === true && state.goLiveComplete === true) return false;
    return true;
  }
```

  (c) In `applyCompletionPresentation(state)`, after the existing CTA toggling, set the progress text + reveal the Later button:

```javascript
    const done = (state.discoveryComplete ? 1 : 0) + (state.goLiveComplete ? 1 : 0);
    const progressEl = getEl("whatsNextSetupProgress");
    if (progressEl) {
      progressEl.textContent = `Finish setup — ${done} of 2 complete`;
      progressEl.removeAttribute("hidden");
    }
    const laterEl = getEl("whatsNextLater");
    if (laterEl) laterEl.removeAttribute("hidden");
```

  (d) Add `handleLater` (mirrors `handleDismiss` but session-only, no IndexedDB write):

```javascript
  function handleLater() {
    setSessionSnoozed();
    hideBanner();
  }
```

  (e) Wire it in `wireListeners()`:

```javascript
    getEl("whatsNextLater")?.addEventListener("click", () => { handleLater(); });
```

  (f) Export it in the `Object.assign(banner, {...})` block: add `handleLater,`.

- [ ] **Step 5: Run the test, expect PASS**

Run: `node --test --test-name-pattern="setup progress \+ session Later" tests/whats-next-signpost.test.mjs`
Expected: PASS (3/3). Then `node --test tests/whats-next-signpost.test.mjs` (no regressions) and `node --check whats-next-banner.js`.

- [ ] **Step 6: Commit**

```bash
git add index.html whats-next-banner.js tests/whats-next-signpost.test.mjs
git commit -m "feat(onboarding): setup-progress bar + session Later snooze in whats-next banner"
```

---

## Task 2: Auto-launch discovery after the first-run wizard

**Files:**
- Modify: `first-run-wizard.js` (the done-panel completion path; reuse `handleFirstRunDoneOpenDiscovery` at ~`612`)
- Test: `tests/whats-next-signpost.test.mjs` (first-run section)

- [ ] **Step 1: Write the failing test** asserting that finishing the first-run wizard (the done-panel "complete" path) calls the discovery handoff exactly once without a user click:

```javascript
it("completing first-run auto-launches discovery setup (no button click needed)", () => {
  const calls = [];
  const host = { requestDiscoverySetup: (o) => calls.push(o), getUserContent: () => ({}) };
  const fr = loadFirstRun({ host });           // existing harness in this file
  fr.completeFirstRun();                        // the done-panel completion entry point
  assert.equal(calls.length, 1, "discovery must auto-launch on first-run completion");
  assert.equal(calls[0].entryPoint, "onboarding");
  assert.equal(calls[0].allowWhileOnboarding, true);
});
```

  > Identify the real completion entry point: the function the done panel invokes when the user finishes Provider (search `first-run-wizard.js` for where `showFirstRunDonePanel` is confirmed / the "done" primary button handler). Name the test's `fr.completeFirstRun()` to match it.

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --test-name-pattern="auto-launches discovery" tests/whats-next-signpost.test.mjs`
Expected: FAIL (no auto-launch today).

- [ ] **Step 3: Implement.** In the done-panel completion handler, after the existing dashboard handoff, call the discovery handoff. Reuse the existing `handleFirstRunDoneOpenDiscovery` (it already does `handleFirstRunDoneToDashboard()` then `requestDiscoverySetup`), but ensure the entryPoint is `"onboarding"`:

```javascript
  // After Sheet → Provider, onboarding requires both tracks: push the user
  // straight into discovery setup (it auto-chains to go-live on finish).
  handleFirstRunDoneOpenDiscovery({ entryPoint: "onboarding" });
```

  Update `handleFirstRunDoneOpenDiscovery` to accept an optional `{ entryPoint }` (default `"whats_next"` to preserve existing callers) and thread it into both the `h.requestDiscoverySetup(...)` and `window.requestDiscoverySetup(...)` payloads.

- [ ] **Step 4: Run, expect PASS** — then `node --check first-run-wizard.js`.

- [ ] **Step 5: Commit**

```bash
git add first-run-wizard.js tests/whats-next-signpost.test.mjs
git commit -m "feat(onboarding): auto-launch discovery setup when first-run completes"
```

---

## Task 3: Auto-chain go-live when discovery finishes

**Files:**
- Modify: `discovery-wizard-ui.js` (`recommendGoLiveAfterDiscoveryFinish`, ~`2070`)
- Test: `tests/go-live-cross-rec.test.mjs`

- [ ] **Step 1: Write the failing test** — after discovery finishes connected with go-live incomplete, `requestGoLiveSetup` is invoked (auto-open), and the banner is still refreshed:

```javascript
it("finishing discovery auto-opens the go-live wizard when go-live is incomplete", async () => {
  const calls = [];
  const banner = { refreshBanner: () => { calls.push("refresh"); return Promise.resolve(); } };
  const UC = makeUC({ goLiveComplete: false });          // existing helper
  const host = {
    getUserContent: () => UC,
    requestGoLiveSetup: (o) => calls.push(["golive", o]),
  };
  await runRecommendGoLiveAfterDiscoveryFinish({ host, banner }); // existing test entry
  assert.ok(calls.some((c) => Array.isArray(c) && c[0] === "golive"),
    "must auto-open go-live");
});

it("finishing discovery does NOT auto-open go-live when go-live already complete", async () => {
  const calls = [];
  const UC = makeUC({ goLiveComplete: true });
  const host = { getUserContent: () => UC, requestGoLiveSetup: (o) => calls.push(o) };
  await runRecommendGoLiveAfterDiscoveryFinish({ host });
  assert.equal(calls.length, 0);
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `node --test --test-name-pattern="auto-opens the go-live wizard" tests/go-live-cross-rec.test.mjs`
Expected: FAIL (today only refreshes the banner).

- [ ] **Step 3: Implement.** In `recommendGoLiveAfterDiscoveryFinish`, replace the `if (!goLiveDone) { ...banner refresh only... }` block with an auto-open that falls back to the banner refresh:

```javascript
  if (!goLiveDone) {
    let opened = false;
    try {
      const h = host();
      if (h && typeof h.requestGoLiveSetup === "function") {
        void h.requestGoLiveSetup({ entryPoint: "onboarding_chain", allowWhileOnboarding: true });
        opened = true;
      }
    } catch (e) {
      console.warn("[JobBored] auto-open go-live:", e);
    }
    // Always refresh the bar so it updates to "1 of 2" (and as the fallback
    // surface when the bridge is unavailable).
    try {
      const banner =
        typeof window !== "undefined" && window.JobBoredApp &&
        window.JobBoredApp.whatsNextBanner;
      if (banner && typeof banner.refreshBanner === "function") {
        void Promise.resolve(banner.refreshBanner()).catch(() => {});
      }
    } catch (_) { /* best-effort */ }
    void opened;
  }
```

- [ ] **Step 4: Run, expect PASS** — then `node --test tests/go-live-cross-rec.test.mjs` + `node --check discovery-wizard-ui.js`.

- [ ] **Step 5: Commit**

```bash
git add discovery-wizard-ui.js tests/go-live-cross-rec.test.mjs
git commit -m "feat(onboarding): auto-open go-live wizard when discovery setup finishes"
```

---

## Task 4: Symmetric — auto-open discovery when go-live finishes first

**Files:**
- Modify: `go-live-wizard-ui.js` (done-step handler, ~`1006`)
- Test: `tests/go-live-wizard.test.mjs`

- [ ] **Step 1: Write the failing test** — when the go-live wizard reaches done, `completeGoLiveSetup` is called and, if discovery is incomplete, `requestDiscoverySetup` is invoked:

```javascript
it("finishing go-live auto-opens discovery when discovery is incomplete", async () => {
  const calls = [];
  const UC = makeUC({ discoveryComplete: false });
  const host = { getUserContent: () => UC, requestDiscoverySetup: (o) => calls.push(o) };
  const { api } = loadGoLive({ host });
  await api.handleAction("go_live_finish_done");   // the action that reaches the done step
  assert.equal(UC.__completed.includes("golive"), true);
  assert.equal(calls.length, 1, "must auto-open discovery when incomplete");
});
```

  > Confirm the exact action id that lands on the done step (`grep "moveToStep(\"done\"" go-live-wizard-ui.js`); today it computes `showCta = !(await isDiscoverySetupComplete())`. Reuse that branch.

- [ ] **Step 2: Run, expect FAIL.**

Run: `node --test --test-name-pattern="auto-opens discovery when discovery is incomplete" tests/go-live-wizard.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement.** In the done-step handler where `showCta` is computed (~`1013-1020`), when `showCta` is true (discovery incomplete), also auto-open discovery:

```javascript
      if (showCta) {
        try {
          const h = host();
          if (h && typeof h.requestDiscoverySetup === "function") {
            void h.requestDiscoverySetup({ entryPoint: "onboarding_chain", allowWhileOnboarding: true });
          }
        } catch (e) {
          console.warn("[JobBored] auto-open discovery:", e);
        }
      }
      return moveToStep("done", { _discoveryCtaVisible: showCta });
```

  > Keep the in-wizard "Turn on job discovery" CTA too — the auto-open and the CTA are complementary (CTA is the manual fallback if the user closed the auto-opened wizard).

- [ ] **Step 4: Run, expect PASS** — then `node --test tests/go-live-wizard.test.mjs` + `node --check go-live-wizard-ui.js`.

- [ ] **Step 5: Commit**

```bash
git add go-live-wizard-ui.js tests/go-live-wizard.test.mjs
git commit -m "feat(onboarding): auto-open discovery from go-live done when discovery incomplete"
```

---

## Task 5: Full-gate verification + PR

- [ ] **Step 1: Run the full CI gate** (NOT the `tests/*.test.mjs` glob — that skips `tests/integration/`):

Run: `npm test`
Expected: all pass, 0 fail/skip. Then `npm run typecheck:repo` (exit 0) and `git diff --check` (clean).

- [ ] **Step 2: Manual smoke (optional, over SSH to the always-on Mac):** fresh state (`rm -rf ~/.jobbored && cp config.example.js config.js`), `PORT=8090 npm run web-only`, sign in → confirm discovery auto-opens, finishing it auto-opens go-live, and the "1 of 2 / 2 of 2" bar + "Later" behave.

- [ ] **Step 3: Push + open PR to `main`**

```bash
git push -u origin feat/mandatory-onboarding-setup
gh pr create --base main --title "feat(onboarding): require both setup tracks (guided, not trapping)" --body "<summary + link to spec>"
```

  Let CI run (contract-tests / test / scan), then `gh pr merge <n> --rebase` once green and approved.

---

## Self-review notes

- **Spec coverage:** auto-launch discovery (T2) ✓; auto-chain go-live (T3) ✓; symmetric either-order (T4) ✓; "X of 2" bar (T1) ✓; session "Later" escape, no permanent dismiss during setup (T1, asserted) ✓; completion = setup connected (unchanged — reuses existing finish-gated flags) ✓; not-trapping (no hard block added anywhere) ✓.
- **Naming consistency:** `handleLater` / `whatsNextLater` / `whatsNextSetupProgress` / `SESSION_SNOOZE_KEY` used consistently across Task 1.
- **Integration points to confirm at build time** (the engineer must grep, not guess): the first-run done-panel completion entry point (T2 Step 1) and the go-live action id that reaches the done step (T4 Step 1). Both are named in their tasks; verify the exact symbol before writing the test name.
