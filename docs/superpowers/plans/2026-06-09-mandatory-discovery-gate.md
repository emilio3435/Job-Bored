# Mandatory Discovery Setup Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make discovery setup a hard, unmissable gate between the resume/persona wizard and the go-live (multi-device) wizard. A new user cannot reach a usable dashboard until `isDiscoverySetupComplete` is true, with one clearly-secondary, confirm-gated escape hatch. The gate re-asserts (blocking panel) when the discovery wizard closes without completing. The existing wizard internals are untouched.

**Architecture:** Pure rewiring of existing classic-global IIFE modules. No new modules. New pieces: (a) `discoverySetupSkipped` flag trio in `user-content-store.js`; (b) `onComplete` callback slot + visible "Discovery is connected ✓" confirmation in `openDiscoverySetupWizard` for `entryPoint:"onboarding"`; (c) gated, blocking `advanceToDiscoveryAfterOnboarding` that re-asserts the gate on close-without-complete; (d) a `#discoverySetupGate` blocking overlay partial; (e) banner nudge confirmed to not count skip as complete; (f) first-run reconciliation so the gate and the first-run→discovery chain do not race. Spec: `docs/superpowers/specs/2026-06-09-mandatory-discovery-gate-design.md`.

**Tech Stack:** Vanilla JS (classic-global IIFEs on `window.JobBoredApp` / `window.JobBoredDiscoveryWizard`), `node --test` (run via `npm test` via `scripts/run-tests.mjs` which includes `tests/integration/`), IndexedDB-backed `user-content-store.js` settings store.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `user-content-store.js` | Persist the skip escape | Add `discoverySetupSkipped` flag trio (is/set/reset) following the existing completion-flag pattern (~line 789); export on `window.CommandCenterUserContent` (~line 1145) |
| `discovery-wizard-ui.js` | Visible confirmation on healthy autodetect; callback seam | `openDiscoverySetupWizard`: (a) accept `options.onComplete`/`options.onClose` callbacks; (b) for `entryPoint:"onboarding"` when `verdict.ready`, skip the silent toast-and-return and instead call `options.onComplete({ alreadyConnected: true })` so the gate gets a synchronous resolved signal |
| `onboarding-wizard.js` | Gated, blocking discovery handoff | Upgrade `advanceToDiscoveryAfterOnboarding` (~line 76) from fire-and-forget to gated: pass `onComplete` + `onClose` callbacks into `requestDiscoverySetup`; on `onClose`-without-complete show the `#discoverySetupGate` blocking panel; on `onComplete` satisfy the gate and continue to the next step |
| `partials/onboarding-wizard.html` | Blocking gate panel markup | Add `#discoverySetupGate` overlay (hidden by default) with a primary [Set up discovery] button and a small confirm-gated "I can't do this right now" escape link |
| `whats-next-banner.js` | Confirm skip does not satisfy discovery row | Verify `readGateState` does not read `discoverySetupSkipped` as `discoveryComplete`; add `discoverySetupSkipped` to the state object so tests can assert the discovery row still shows |
| `first-run-wizard.js` | Prevent double-open race | Add a guard in `handleFirstRunDoneOpenDiscovery` so when `entryPoint:"onboarding"` it sets a `sessionStorage` flag that `advanceToDiscoveryAfterOnboarding` checks to avoid a second simultaneous open |
| `tests/user-content-store-discovery-skip.test.mjs` | New: flag trio coverage | Source-sniff tests mirroring `tests/go-live-cross-rec.test.mjs` style |
| `tests/onboarding-celebration.test.mjs` | Extend: gated handoff coverage | New cases for gate re-assert, onComplete satisfaction, confirmed escape |
| `tests/discovery-cross-rec.test.mjs` | Extend: onComplete callback and onboarding lane | New cases for `options.onComplete` call when `verdict.ready` + `entryPoint:"onboarding"` |
| `tests/whats-next-signpost.test.mjs` | Extend: skip-does-not-satisfy | Source-sniff asserting `discoverySetupSkipped` is read but does not gate the discovery row off |

---

## Task 1: `discoverySetupSkipped` flag trio in `user-content-store.js`

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/user-content-store.js` (after line 789; export block ~line 1145)
- Create: `/Users/emilionunezgarcia/Job-Bored/tests/user-content-store-discovery-skip.test.mjs`

- [ ] **Step 1: Write the failing test.** Create `tests/user-content-store-discovery-skip.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const userContentStoreJs = readFileSync(
  join(repoRoot, "user-content-store.js"),
  "utf8",
);

describe("user-content-store — discoverySetupSkipped flag trio", () => {
  it("exposes isDiscoverySetupSkipped that reads the discoverySetupSkipped setting", () => {
    assert.match(
      userContentStoreJs,
      /async function isDiscoverySetupSkipped\(\)\s*\{\s*return !!\(await getSetting\("discoverySetupSkipped"\)\);/,
    );
  });
  it("exposes setDiscoverySetupSkipped that writes the discoverySetupSkipped setting", () => {
    assert.match(
      userContentStoreJs,
      /async function setDiscoverySetupSkipped\(\)\s*\{\s*await setSetting\("discoverySetupSkipped", true\);/,
    );
  });
  it("exposes resetDiscoverySetupSkipped that clears the discoverySetupSkipped setting", () => {
    assert.match(
      userContentStoreJs,
      /async function resetDiscoverySetupSkipped\(\)\s*\{\s*await setSetting\("discoverySetupSkipped", false\);/,
    );
  });
  it("registers all three helpers on window.CommandCenterUserContent", () => {
    for (const fn of [
      "isDiscoverySetupSkipped",
      "setDiscoverySetupSkipped",
      "resetDiscoverySetupSkipped",
    ]) {
      assert.match(userContentStoreJs, new RegExp(`\\n\\s*${fn},`));
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `node --test tests/user-content-store-discovery-skip.test.mjs` — FAIL (helpers not defined).

- [ ] **Step 3: Implement.** Insert after `resetDiscoverySetupCompletion` (~line 789):

```javascript
  async function isDiscoverySetupSkipped() {
    return !!(await getSetting("discoverySetupSkipped"));
  }

  async function setDiscoverySetupSkipped() {
    await setSetting("discoverySetupSkipped", true);
  }

  /** Clears the skip flag so a new discovery run attempt starts fresh. */
  async function resetDiscoverySetupSkipped() {
    await setSetting("discoverySetupSkipped", false);
  }
```

Then in the `window.CommandCenterUserContent` export block (after `resetDiscoverySetupCompletion,`), add:

```javascript
    isDiscoverySetupSkipped,
    setDiscoverySetupSkipped,
    resetDiscoverySetupSkipped,
```

- [ ] **Step 4: Run, expect PASS.** `node --test tests/user-content-store-discovery-skip.test.mjs` (4/4). Then `node --check user-content-store.js` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add user-content-store.js tests/user-content-store-discovery-skip.test.mjs
git commit -m "feat(discovery-gate): add discoverySetupSkipped flag trio to user-content-store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `onComplete` callback seam in `openDiscoverySetupWizard` + suppress silent toast for onboarding entry point

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/discovery-wizard-ui.js` (the autodetect lane ~2153–2228; the `onClose` handler ~2039–2071)
- Modify: `/Users/emilionunezgarcia/Job-Bored/tests/discovery-cross-rec.test.mjs` (new describe block)

**Why:** When opened from the onboarding gate with `entryPoint:"onboarding"`, the autodetect lane shows a silent toast and returns — the gate's `onComplete` never fires, so it never advances. Pass an optional `options.onComplete`; when `entryPoint:"onboarding"` and `verdict.ready`, call `options.onComplete({ alreadyConnected: true })` instead of the silent return. Also thread `options.onClose` into `renderDiscoverySetupWizard`'s `onClose` so the gate re-asserts after close-without-complete.

- [ ] **Step 1: Write the failing tests.** Append to `tests/discovery-cross-rec.test.mjs`:

```javascript
describe("discovery-wizard-ui — openDiscoverySetupWizard onComplete seam", () => {
  it("references options.onComplete and options.onClose", () => {
    assert.match(
      discoveryWizardUiJs,
      /async function openDiscoverySetupWizard\(options\s*=\s*\{\}\)/,
    );
    assert.match(discoveryWizardUiJs, /options\.onComplete\b/);
    assert.match(discoveryWizardUiJs, /options\.onClose\b/);
  });

  it("the autodetect-ready lane calls options.onComplete for entryPoint:onboarding instead of returning silently", () => {
    const start = discoveryWizardUiJs.indexOf(
      "// ====== [discovery-autodetect lane: silent recover] ======",
    );
    const block = discoveryWizardUiJs.slice(start, start + 4000);
    assert.match(block, /entryPoint.*onboarding|onboarding.*entryPoint/);
    assert.match(block, /options\.onComplete\s*\(\s*\{/);
    assert.match(block, /alreadyConnected:\s*true/);
  });

  it("the onClose handler forwards (reason, ctx) to options.onClose when provided", () => {
    const onCloseIdx = discoveryWizardUiJs.indexOf("onClose: (reason, ctx) =>");
    assert.ok(onCloseIdx !== -1);
    const body = discoveryWizardUiJs.slice(onCloseIdx, onCloseIdx + 3000);
    assert.match(body, /typeof options\.onClose === "function"/);
    assert.match(body, /options\.onClose\(reason,\s*ctx\)/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `node --test tests/discovery-cross-rec.test.mjs` — FAIL on the 3 new cases.

- [ ] **Step 3: Implement.**

(a) In the `if (verdict && verdict.ready)` block, before the final `return;`, add the onboarding branch:

```javascript
        // Mandatory discovery gate: for the onboarding entry point never
        // silently short-circuit — the gate needs to advance. Call the
        // caller's onComplete callback instead of returning quietly.
        if (
          options.entryPoint === "onboarding" &&
          typeof options.onComplete === "function"
        ) {
          try {
            options.onComplete({ alreadyConnected: true });
          } catch (e) {
            console.warn("[JobBored] discovery gate onComplete (autodetect):", e);
          }
          return;
        }
        return;
```

(b) At the end of the `onClose: (reason, ctx) => { ... }` block (after `host().showOnboardingWizard()`), add:

```javascript
      if (typeof options.onClose === "function") {
        try {
          options.onClose(reason, ctx);
        } catch (e) {
          console.warn("[JobBored] discovery gate onClose callback:", e);
        }
      }
```

- [ ] **Step 4: Run, expect PASS.** `node --test tests/discovery-cross-rec.test.mjs`. Then `node --check discovery-wizard-ui.js` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add discovery-wizard-ui.js tests/discovery-cross-rec.test.mjs
git commit -m "feat(discovery-gate): add onComplete/onClose seam to openDiscoverySetupWizard; suppress silent return for entryPoint:onboarding

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **NOTE for executor:** confirm the exact current line of the `if (verdict && verdict.ready)` block's terminal `return;` and the `onClose` closing brace before editing — the autodetect lane comment markers may differ from the `[/discovery-autodetect lane]` end marker assumed in the test; if the end marker is absent, slice the block by `indexOf("recoverIfPossible")` + a fixed length instead.

---

## Task 3: Blocking gate panel markup in `partials/onboarding-wizard.html`

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/partials/onboarding-wizard.html` (append `#discoverySetupGate` overlay)
- Modify: `/Users/emilionunezgarcia/Job-Bored/tests/onboarding-celebration.test.mjs` (new describe block)

- [ ] **Step 1: Write the failing markup test.** Append to `tests/onboarding-celebration.test.mjs`:

```javascript
describe("onboarding-wizard partial — discoverySetupGate markup", () => {
  const onboardingPartial = readFileSync(
    join(repoRoot, "partials", "onboarding-wizard.html"),
    "utf8",
  );
  it("defines #discoverySetupGate hidden by default", () => {
    assert.match(onboardingPartial, /id="discoverySetupGate"/);
    const i = onboardingPartial.indexOf('id="discoverySetupGate"');
    const openTag = onboardingPartial.slice(
      onboardingPartial.lastIndexOf("<div", i),
      onboardingPartial.indexOf(">", i) + 1,
    );
    assert.match(openTag, /\bhidden\b/);
  });
  it("contains the primary [Set up discovery] button (id=discoveryGateOpenWizard)", () => {
    assert.match(onboardingPartial, /id="discoveryGateOpenWizard"/);
  });
  it("contains the confirm-gated escape (id=discoveryGateSkipEscape)", () => {
    assert.match(onboardingPartial, /id="discoveryGateSkipEscape"/);
  });
  it("the escape is visually secondary (not the primary button class)", () => {
    const i = onboardingPartial.indexOf('id="discoveryGateSkipEscape"');
    const ctx = onboardingPartial.slice(i - 300, i + 100);
    assert.ok(!ctx.includes("btn-modal-primary"));
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `node --test tests/onboarding-celebration.test.mjs` — FAIL.

- [ ] **Step 3: Implement.** Append after the `#onboardingWizard` closing `</div>` in `partials/onboarding-wizard.html`:

```html
    <!-- Discovery setup gate — mandatory before reaching the dashboard. Shown
         by onboarding-wizard.js when discovery is still incomplete; re-asserted
         if the wizard closes without completing. The confirm-gated escape
         writes discoverySetupSkipped and lets the user through — the "Finish
         setup" card keeps nudging. -->
    <div
      id="discoverySetupGate"
      class="onboarding-wizard"
      hidden
      aria-hidden="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discoveryGateTitle"
    >
      <div class="onboarding-wizard__inner">
        <div class="onboarding-wizard__brand">
          <h2 id="discoveryGateTitle" class="onboarding-wizard__title">
            One more step
          </h2>
        </div>
        <div class="onboarding-wizard__body">
          <p class="onboarding-wizard__lede">
            Discovery is the engine that finds jobs for you. Set it up now —
            it only takes a few minutes.
          </p>
          <button
            type="button"
            class="btn-modal-primary onboarding-wizard__cta-block"
            id="discoveryGateOpenWizard"
          >
            Set up discovery
          </button>
          <button
            type="button"
            class="onboarding-wizard__escape-link"
            id="discoveryGateSkipEscape"
          >
            I can&rsquo;t do this right now — finish later from Settings
          </button>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: Run, expect PASS.** `node --test tests/onboarding-celebration.test.mjs`. Then verify the assembled index still builds — confirm the project's index-assembly command first (e.g. `grep -rn "@include" scripts/` / check `scripts/lib/expand-index-includes.mjs`) and run it.

- [ ] **Step 5: Commit.**

```bash
git add partials/onboarding-wizard.html tests/onboarding-celebration.test.mjs
git commit -m "feat(discovery-gate): add blocking #discoverySetupGate overlay to onboarding partial

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **NOTE for executor:** verify the exact onboarding-wizard partial class names (`onboarding-wizard__inner`, `__lede`, `btn-modal-primary`) exist; if the partial uses different class names, reuse the partial's real classes so the gate matches the wizard's visual language. Add a small `.onboarding-wizard__escape-link` style to `css/legacy-onboarding.css` if absent (secondary/link style, muted color).

---

## Task 4: Gated, blocking `advanceToDiscoveryAfterOnboarding` + re-assert on close-without-complete

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/onboarding-wizard.js` (`advanceToDiscoveryAfterOnboarding` ~76–113; add `showDiscoveryGate`/`hideDiscoveryGate`; wire gate buttons in `initOnboardingWizard`)
- Modify: `/Users/emilionunezgarcia/Job-Bored/tests/onboarding-celebration.test.mjs` (new describe block)

- [ ] **Step 1: Write the failing tests.** Append to `tests/onboarding-celebration.test.mjs`:

```javascript
describe("advanceToDiscoveryAfterOnboarding — gated blocking handoff", () => {
  function loadOnboardingWithGate({ discoveryComplete, skipFlag = false, confirmResult = true }) {
    const calls = { requestDiscovery: [], setSkipped: 0, completeDiscovery: 0 };
    let hidden = true;
    const gateEl = {
      get hidden() { return hidden; },
      removeAttribute(n) { if (n === "hidden") hidden = false; },
      setAttribute(n) { if (n === "hidden") hidden = true; },
      hasAttribute(n) { return n === "hidden" ? hidden : false; },
    };
    const window = {
      JobBoredApp: { core: { host: {
        requestDiscoverySetup: (o) => calls.requestDiscovery.push(o),
        getUserContent: () => ({
          isDiscoverySetupComplete: async () => discoveryComplete,
          isDiscoverySetupSkipped: async () => skipFlag,
          completeDiscoverySetup: async () => { calls.completeDiscovery++; },
          setDiscoverySetupSkipped: async () => { calls.setSkipped++; },
          openDb: async () => {},
        }),
        resumePendingDiscoverySetupIfNeeded: async () => false,
      } } },
      confirm: () => confirmResult,
      sessionStorage: { getItem: () => null, removeItem: () => {} },
    };
    const document = {
      getElementById: (id) => (id === "discoverySetupGate" ? gateEl : null),
      createElement: () => ({ className: "", style: {}, setAttribute() {}, appendChild() {} }),
    };
    const ctx = { window, document, console, setTimeout, clearTimeout };
    vm.createContext(ctx);
    vm.runInContext(onboardingWizardJs, ctx, { filename: "onboarding-wizard.js" });
    return { onboarding: window.JobBoredApp.onboarding, gateEl, calls, window };
  }

  it("when discovery is incomplete, requestDiscoverySetup is called with onComplete + onClose callbacks", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(env.calls.requestDiscovery.length, 1);
    assert.equal(typeof env.calls.requestDiscovery[0].onComplete, "function");
    assert.equal(typeof env.calls.requestDiscovery[0].onClose, "function");
  });

  it("onClose with reason !== finish shows the gate panel", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("dismiss", {});
    assert.equal(env.gateEl.hidden, false);
  });

  it("onClose does NOT show the gate when discoverySetupSkipped is true", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false, skipFlag: true });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onClose("dismiss", {});
    assert.equal(env.gateEl.hidden, true);
  });

  it("onComplete with alreadyConnected:true persists discoverySetupComplete and hides the gate", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    env.gateEl.removeAttribute("hidden");
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    await env.calls.requestDiscovery[0].onComplete({ alreadyConnected: true });
    assert.equal(env.calls.completeDiscovery, 1);
    assert.equal(env.gateEl.hidden, true);
  });

  it("is idempotent when discoverySetupComplete is already true", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: true });
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(env.calls.requestDiscovery.length, 0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `node --test tests/onboarding-celebration.test.mjs` — FAIL (no onComplete/onClose; no gate helpers).

- [ ] **Step 3: Implement.**

(a) Add helpers after `advanceToDiscoveryAfterOnboarding`:

```javascript
  function showDiscoveryGate() {
    const gate = typeof document !== "undefined"
      ? document.getElementById("discoverySetupGate") : null;
    if (!gate) return;
    gate.removeAttribute("hidden");
    gate.setAttribute("aria-hidden", "false");
  }
  function hideDiscoveryGate() {
    const gate = typeof document !== "undefined"
      ? document.getElementById("discoverySetupGate") : null;
    if (!gate) return;
    gate.setAttribute("hidden", "hidden");
    gate.setAttribute("aria-hidden", "true");
  }
```

(b) Replace the tail of `advanceToDiscoveryAfterOnboarding` (from `if (discoveryDone) return;` through the `requestDiscoverySetup` call) with:

```javascript
    if (discoveryDone) return;
    const onComplete = async (detail) => {
      if (detail && detail.alreadyConnected) {
        try {
          const UC2 = getUserContent();
          if (UC2 && typeof UC2.completeDiscoverySetup === "function") {
            if (typeof UC2.openDb === "function") await UC2.openDb();
            await UC2.completeDiscoverySetup();
          }
        } catch (e) {
          console.warn("[JobBored] persist discovery complete (gate onComplete):", e);
        }
      }
      hideDiscoveryGate();
    };
    const onClose = async (reason, _ctx) => {
      let skipped = false;
      try {
        const UC2 = getUserContent();
        if (UC2 && typeof UC2.isDiscoverySetupSkipped === "function") {
          skipped = !!(await UC2.isDiscoverySetupSkipped());
        }
      } catch (_) {
        skipped = false;
      }
      if (!skipped) showDiscoveryGate();
    };
    try {
      const h = host();
      if (h && typeof h.requestDiscoverySetup === "function") {
        void h.requestDiscoverySetup({
          entryPoint: "onboarding",
          allowWhileOnboarding: true,
          onComplete,
          onClose,
        });
      }
    } catch (e) {
      console.warn("[JobBored] auto-open discovery after onboarding:", e);
    }
```

(c) Wire the gate buttons inside `initOnboardingWizard` (respecting its listeners-wired guard):

```javascript
    getEl("discoveryGateOpenWizard")?.addEventListener("click", () => {
      hideDiscoveryGate();
      void advanceToDiscoveryAfterOnboarding();
    });
    getEl("discoveryGateSkipEscape")?.addEventListener("click", () => {
      const confirmed = typeof window.confirm === "function"
        ? window.confirm(
            "Skip discovery setup for now? You can finish it anytime from Settings. The app will work, but no jobs will be found until you connect discovery.",
          )
        : true;
      if (!confirmed) return;
      void (async () => {
        try {
          const UC = getUserContent();
          if (UC) {
            if (typeof UC.openDb === "function") await UC.openDb();
            if (typeof UC.setDiscoverySetupSkipped === "function") {
              await UC.setDiscoverySetupSkipped();
            }
          }
        } catch (e) {
          console.warn("[JobBored] discovery gate skip persist:", e);
        }
        hideDiscoveryGate();
      })();
    });
```

Then add `showDiscoveryGate` / `hideDiscoveryGate` to the `Object.assign(onboarding, {...})` export block if the tests need them (the cases above only need `advanceToDiscoveryAfterOnboarding`, already exported).

- [ ] **Step 4: Run, expect PASS.** `node --test tests/onboarding-celebration.test.mjs`. Then `node --check onboarding-wizard.js` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add onboarding-wizard.js tests/onboarding-celebration.test.mjs
git commit -m "feat(discovery-gate): gate advanceToDiscoveryAfterOnboarding; re-assert on close-without-complete; wire gate CTA + escape

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **NOTE for executor:** verify `getEl` exists in onboarding-wizard.js (it uses `document.getElementById` directly in places — if there is no `getEl`, use `document.getElementById(...)?.addEventListener` instead). Confirm the listeners-wired guard pattern before adding the two listeners so re-init never double-wires.

---

## Task 5: `whats-next-banner.js` — confirm `discoverySetupSkipped` does not satisfy the discovery row

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/whats-next-banner.js` (`readGateState` output)
- Modify: `/Users/emilionunezgarcia/Job-Bored/tests/whats-next-signpost.test.mjs` (new describe block)

- [ ] **Step 1: Write the failing test.** Append to `tests/whats-next-signpost.test.mjs`:

```javascript
describe("whats-next-banner — discoverySetupSkipped does not satisfy discovery row", () => {
  it("banner reads isDiscoverySetupSkipped (observable, not a completion gate)", () => {
    assert.match(whatsNextBannerJs, /isDiscoverySetupSkipped/);
  });
  it("shouldRenderBanner does NOT reference the skip flag", () => {
    const i = whatsNextBannerJs.indexOf("function shouldRenderBanner(");
    assert.ok(i !== -1);
    const body = whatsNextBannerJs.slice(i, i + 600);
    assert.ok(!body.includes("discoverySetupSkipped") && !body.includes("setupSkipped"));
  });
  it("store keeps discoverySetupSkipped and discoverySetupComplete as separate keys", () => {
    assert.match(userContentStoreJs, /getSetting\("discoverySetupSkipped"\)/);
    assert.match(userContentStoreJs, /getSetting\("discoverySetupComplete"\)/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (first assertion — banner does not read the skip flag yet): `node --test --test-name-pattern="discoverySetupSkipped does not satisfy" tests/whats-next-signpost.test.mjs`.

- [ ] **Step 3: Implement.** In `readGateState()`, after the `goLiveComplete` block, build a skip-augmented result and return it:

```javascript
    const outWithSkip = { ...out, discoverySetupSkipped: false };
    try {
      outWithSkip.discoverySetupSkipped = !!(
        typeof UC.isDiscoverySetupSkipped === "function"
          ? await UC.isDiscoverySetupSkipped()
          : false
      );
    } catch (_) {
      outWithSkip.discoverySetupSkipped = false;
    }
    return outWithSkip;
```

Replace the final `return out;` with `return outWithSkip;`. Do NOT touch `shouldRenderBanner` / `applyCompletionPresentation` — `discoveryComplete` alone controls the discovery CTA (correct: skip ≠ complete).

- [ ] **Step 4: Run, expect PASS.** `node --test --test-name-pattern="discoverySetupSkipped does not satisfy" tests/whats-next-signpost.test.mjs` (3/3). Then `node --test tests/whats-next-signpost.test.mjs` (no regressions). Then `node --check whats-next-banner.js` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add whats-next-banner.js tests/whats-next-signpost.test.mjs
git commit -m "feat(discovery-gate): expose discoverySetupSkipped in banner gate state; assert skip does not satisfy discovery row

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Reconcile first-run→discovery chain to prevent double-open race

**Files:**
- Modify: `/Users/emilionunezgarcia/Job-Bored/first-run-wizard.js` (`handleFirstRunDoneOpenDiscovery`, ~line 612–642)
- Modify: `/Users/emilionunezgarcia/Job-Bored/onboarding-wizard.js` (`advanceToDiscoveryAfterOnboarding` sentinel check)
- Modify: tests as below

**Context:** First-run done → `handleFirstRunDoneOpenDiscovery({entryPoint:"onboarding"})` opens discovery; later the persona finish → `advanceToDiscoveryAfterOnboarding` also opens it. Prevent the duplicate via a `sessionStorage` sentinel.

- [ ] **Step 1: Write the failing tests.**

In `tests/onboarding-celebration.test.mjs` (inside the gated-handoff describe), add:

```javascript
  it("skips the open when jobbored.discovery.openedFromFirstRun sentinel is set", async () => {
    const env = loadOnboardingWithGate({ discoveryComplete: false });
    env.window.sessionStorage = {
      getItem: (k) => (k === "jobbored.discovery.openedFromFirstRun" ? "1" : null),
      removeItem: () => {},
    };
    await env.onboarding.advanceToDiscoveryAfterOnboarding();
    assert.equal(env.calls.requestDiscovery.length, 0);
  });
```

(Confirm `loadOnboardingWithGate`'s window stub exposes a mutable `sessionStorage`.)

In `tests/whats-next-signpost.test.mjs`, add a source-sniff case asserting the sentinel write:

```javascript
describe("first-run wizard — discovery double-open sentinel", () => {
  it("handleFirstRunDoneOpenDiscovery sets the openedFromFirstRun sentinel for entryPoint:onboarding", () => {
    const i = firstRunWizardJs.indexOf("function handleFirstRunDoneOpenDiscovery");
    assert.ok(i !== -1);
    const body = firstRunWizardJs.slice(i, i + 1400);
    assert.match(body, /entryPoint === "onboarding"/);
    assert.match(body, /jobbored\.discovery\.openedFromFirstRun/);
    assert.match(body, /sessionStorage\.setItem/);
  });
});
```

(`firstRunWizardJs` is already read at the top of `tests/whats-next-signpost.test.mjs`.)

- [ ] **Step 2: Run, expect FAIL.** `node --test tests/onboarding-celebration.test.mjs` and `node --test tests/whats-next-signpost.test.mjs` — FAIL on the new cases.

- [ ] **Step 3: Implement.**

(a) In `first-run-wizard.js` `handleFirstRunDoneOpenDiscovery`, after `handleFirstRunDoneToDashboard()` and before the `requestDiscoverySetup` call:

```javascript
    if (entryPoint === "onboarding") {
      try {
        window.sessionStorage.setItem("jobbored.discovery.openedFromFirstRun", "1");
      } catch (_) {
        /* sessionStorage unavailable — sentinel is best-effort */
      }
    }
```

(b) In `onboarding-wizard.js` `advanceToDiscoveryAfterOnboarding`, after `if (discoveryDone) return;` and before the `requestDiscoverySetup` block:

```javascript
    let firstRunAlreadyOpened = false;
    try {
      if (
        window.sessionStorage &&
        window.sessionStorage.getItem("jobbored.discovery.openedFromFirstRun") === "1"
      ) {
        window.sessionStorage.removeItem("jobbored.discovery.openedFromFirstRun");
        firstRunAlreadyOpened = true;
      }
    } catch (_) {
      firstRunAlreadyOpened = false;
    }
    if (firstRunAlreadyOpened) return;
```

- [ ] **Step 4: Run, expect PASS.** `node --test tests/onboarding-celebration.test.mjs` + `node --test tests/whats-next-signpost.test.mjs`. Then `node --check first-run-wizard.js && node --check onboarding-wizard.js` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add first-run-wizard.js onboarding-wizard.js tests/whats-next-signpost.test.mjs tests/onboarding-celebration.test.mjs
git commit -m "feat(discovery-gate): prevent double-open race via sessionStorage sentinel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **NOTE for executor:** verify `handleFirstRunDoneOpenDiscovery` already binds `entryPoint` (it does: `const entryPoint = (opts && opts.entryPoint) || "whats_next";`). Place the sentinel write inside both the `h.requestDiscoverySetup` and the `window.requestDiscoverySetup` fallback branches, OR once before both — but only when `entryPoint === "onboarding"`.

---

## Task 7: Full-gate verification + PR

- [ ] **Step 1: Full CI gate** (NOT the `tests/*.test.mjs` glob — it omits `tests/integration/`):

```
npm test
```

Expected: 0 failing, 0 skipped.

- [ ] **Step 2: Typecheck.** `npm run typecheck:repo` — exit 0.

- [ ] **Step 3: Whitespace/markers.** `git diff --check` — clean.

- [ ] **Step 4: (Optional) Manual smoke.** Greenfield (`?greenfield=1` / Clear), sign in, finish first-run → discovery wizard opens (not a silent toast). Close without completing → `#discoverySetupGate` appears. "Set up discovery" → wizard re-opens. Confirm the escape → dashboard loads; the "Finish setup" card still shows the discovery row. On a healthy local stack (autodetect `verdict.ready`): after the onboarding celebration the gate's onComplete path runs (visible), gate clears, go-live auto-opens.

- [ ] **Step 5: Push + PR.**

```bash
git push -u origin feat/mandatory-discovery-gate
gh pr create --base main \
  --title "feat(discovery-gate): mandatory discovery setup gate between persona and go-live" \
  --body "Implements docs/superpowers/specs/2026-06-09-mandatory-discovery-gate-design.md. Discovery is now a hard, visible, required step with a confirm-gated 'set up later' escape (discoverySetupSkipped; skip != complete — banner keeps nudging). Autodetect healthy-stack path calls onComplete instead of silently returning. Double-open race prevented via sessionStorage sentinel."
```

Let CI run, then `gh pr merge <n> --rebase` once green.

---

## Self-review notes

| Spec requirement | Task |
|---|---|
| `discoverySetupSkipped` flag (set only via escape; skip ≠ complete) | T1 |
| `onComplete`/`onClose` seam; suppress silent toast-and-return for `entryPoint:"onboarding"` (call `onComplete({alreadyConnected:true})`) | T2 |
| Blocking `#discoverySetupGate` panel (primary CTA + confirm-gated escape) | T3 |
| Gated `advanceToDiscoveryAfterOnboarding`: callbacks; re-assert on close-without-complete; satisfy on `onComplete`; escape writes the skip flag | T4 |
| `whats-next-banner` discovery row keeps nudging while incomplete (skip ≠ complete) | T5 |
| First-run→discovery chain reconciled (no competing double-open) | T6 |
| Full CI gate green | T7 |

**Conventions preserved:** `getEl`/`document.getElementById` lazy lookups, `void` fire-and-forget, `console.warn("[JobBored] ...", e)` on catch, `typeof x === "function"` guards, no `.skip`, behavioral VM-context tests + targeted source-sniff, commit-per-task with the Co-Authored-By trailer.

> **Executor caveats (verify before coding):** (1) the index-assembly command in T3; (2) exact autodetect-lane terminal `return;` + `onClose` brace positions in T2; (3) `getEl` availability in onboarding-wizard.js (T4); (4) the `.onboarding-wizard__escape-link` CSS may need adding to `css/legacy-onboarding.css`.
