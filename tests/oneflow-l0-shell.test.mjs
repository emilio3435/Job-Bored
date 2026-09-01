import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadShell, serializeTree } from "./oneflow-l0-harness.mjs";

/* ============================================================
   ONEFLOW spec §3.5 — the shell is the ONE chassis. L0 adds three
   things and nothing else:

     1. a 6-beat spine + minutes label that REPLACES the 3-stage
        journey strip when a host passes `spine`;
     2. a `message` / `messageTone` slot under the actions — the fix for
        the invisible-feedback defect that made B2/B5 key checks silent;
     3. `setBusy(actionId, stages)` / `clearBusy()` — a live ✓/◌/· stage
        list with its trigger disabled.

   Every one of them is inert unless the host opts in. The last suite is
   the lock that proves it: byte-for-byte markup for the discovery
   detect step and the go-live journey host, captured from the shell
   BEFORE these additions.
   ============================================================ */

function renderSpineHost(shell, patch = {}) {
  return shell.renderWizardShell({
    variant: "generic",
    headerTitle: "Set up JobBored",
    steps: [{ id: "ai", label: "AI", title: "Now give it a brain." }],
    state: { currentStep: "ai" },
    spine: {
      beats: [
        { id: "google", label: "Google" },
        { id: "ai", label: "AI" },
        { id: "resume", label: "Resume" },
        { id: "fit", label: "Your fit" },
        { id: "discovery", label: "Discovery" },
        { id: "payoff", label: "Done" },
      ],
      current: "ai",
      timeLabel: "about 13 min left",
    },
    onAction() {},
    ...patch,
  });
}

describe("shell spine — 6 beats + minutes label (spec §3.5.1)", () => {
  it("renders one segment per beat with done/current/todo states", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const rootEl = document.getElementById("discoverySetupWizardMount").firstElementChild;
    const segs = rootEl.querySelectorAll(".discovery-setup-wizard__spine-step");
    assert.equal(segs.length, 6, "the spine is six beats — spec §3.1");
    // Beats before the current one read done; the current one reads current;
    // the rest are plain todo. A stranger must always see where they are.
    assert.equal(segs[0].classList.contains("discovery-setup-wizard__spine-step--done"), true);
    assert.equal(segs[1].classList.contains("discovery-setup-wizard__spine-step--current"), true);
    assert.equal(segs[1].getAttribute("aria-current"), "step");
    assert.equal(segs[2].classList.contains("discovery-setup-wizard__spine-step--done"), false);
    assert.equal(segs[2].classList.contains("discovery-setup-wizard__spine-step--current"), false);
    assert.equal(segs[5].textContent.includes("Done"), true);
  });

  it("renders the minutes-remaining label from the beat table", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const rootEl = document.getElementById("discoverySetupWizardMount").firstElementChild;
    const time = rootEl.querySelector(".discovery-setup-wizard__spine-time");
    assert.ok(time, "the deal is fifteen minutes — the shell must always show what is left");
    assert.equal(time.textContent, "about 13 min left");
  });

  it("marks an explicitly-done later beat done even when it sits after the current one", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell, {
      spine: {
        beats: [
          { id: "google", label: "Google", done: true },
          { id: "ai", label: "AI" },
          { id: "resume", label: "Resume" },
          { id: "fit", label: "Your fit", done: true },
          { id: "discovery", label: "Discovery" },
          { id: "payoff", label: "Done" },
        ],
        current: "ai",
        timeLabel: "about 13 min left",
      },
    });
    const rootEl = document.getElementById("discoverySetupWizardMount").firstElementChild;
    const segs = rootEl.querySelectorAll(".discovery-setup-wizard__spine-step");
    assert.equal(segs[3].classList.contains("discovery-setup-wizard__spine-step--done"), true);
  });

  it("replaces the journey strip rather than stacking two progress systems", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell, { journeyStage: "discovery" });
    const rootEl = document.getElementById("discoverySetupWizardMount").firstElementChild;
    assert.equal(
      rootEl.querySelectorAll(".discovery-setup-wizard__journey").length,
      0,
      "spec §2: ONE spine — the flow must never render two progress systems",
    );
    assert.equal(rootEl.querySelectorAll(".discovery-setup-wizard__spine").length, 1);
  });
});

describe("shell message slot — the silent-feedback fix (spec §3.5.2)", () => {
  it("renders no message node at all when the host passes none", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const rootEl = document.getElementById("discoverySetupWizardMount").firstElementChild;
    assert.equal(rootEl.querySelectorAll(".discovery-setup-wizard__message").length, 0);
  });

  it("renders the message under the actions region", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell, { message: "Checking your key…", messageTone: "info" });
    const rootEl = document.getElementById("discoverySetupWizardMount").firstElementChild;
    const footer = rootEl.querySelector(".discovery-setup-wizard__footer");
    const msg = footer.querySelector(".discovery-setup-wizard__message");
    assert.ok(msg, "a key check with no rendered result is the defect this slot exists to fix");
    assert.equal(msg.textContent, "Checking your key…");
    const actionsIdx = footer.children.findIndex((c) =>
      c.classList.contains("discovery-setup-wizard__actions"),
    );
    const msgIdx = footer.children.findIndex((c) =>
      c.classList.contains("discovery-setup-wizard__message"),
    );
    assert.ok(msgIdx > actionsIdx, "the message renders UNDER the actions");
  });

  it("re-renders by tone — success and error carry different classes and live regions", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const mount = document.getElementById("discoverySetupWizardMount");

    shell.setMessage("✓ Connected — llama-3.1-8b responded", "success");
    let msg = mount.firstElementChild.querySelector(".discovery-setup-wizard__message");
    assert.equal(msg.classList.contains("discovery-setup-wizard__message--success"), true);
    assert.equal(msg.getAttribute("role"), "status");
    assert.equal(msg.textContent, "✓ Connected — llama-3.1-8b responded");

    shell.setMessage("That key was rejected (401).", "error");
    msg = mount.firstElementChild.querySelector(".discovery-setup-wizard__message");
    assert.equal(msg.classList.contains("discovery-setup-wizard__message--error"), true);
    assert.equal(msg.classList.contains("discovery-setup-wizard__message--success"), false);
    assert.equal(
      msg.getAttribute("role"),
      "alert",
      "a failure must interrupt a screen reader, not wait its turn",
    );

    shell.clearMessage();
    assert.equal(
      mount.firstElementChild.querySelectorAll(".discovery-setup-wizard__message").length,
      0,
    );
  });

  it("falls back to the info tone for a tone nobody defined", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell, { message: "Working…", messageTone: "chartreuse" });
    const msg = document
      .getElementById("discoverySetupWizardMount")
      .firstElementChild.querySelector(".discovery-setup-wizard__message");
    assert.equal(msg.classList.contains("discovery-setup-wizard__message--info"), true);
  });
});

describe("shell busy state — live stages with a disabled trigger (spec §3.5.3)", () => {
  function renderWithAction(shell) {
    return shell.renderWizardShell({
      variant: "generic",
      steps: [
        {
          id: "ai",
          label: "AI",
          title: "Now give it a brain.",
          actions: [
            { id: "ai_check", label: "Check & continue", variant: "primary", kind: "action" },
          ],
        },
      ],
      state: { currentStep: "ai" },
      onAction() {},
    });
  }

  function actionButton(document) {
    return document
      .getElementById("discoverySetupWizardMount")
      .firstElementChild.querySelector('[data-action-id="ai_check"]');
  }

  it("disables only the busy action's trigger", () => {
    const { document, shell } = loadShell();
    renderWithAction(shell);
    assert.equal(actionButton(document).disabled, false);
    shell.setBusy("ai_check", ["Checking your key…"]);
    assert.equal(
      actionButton(document).disabled,
      true,
      "a double-submit during a 20s check is how the old wizard lost runs",
    );
  });

  it("renders every stage with a ✓ / ◌ / · glyph for its state", () => {
    const { document, shell } = loadShell();
    renderWithAction(shell);
    shell.setBusy("ai_check", [
      { label: "Reading your resume", state: "done" },
      { label: "Drafting target roles & strengths", state: "active" },
      { label: "Writing your first-person narrative", state: "todo" },
    ]);
    const rows = document
      .getElementById("discoverySetupWizardMount")
      .firstElementChild.querySelectorAll(".discovery-setup-wizard__busy-stage");
    assert.equal(rows.length, 3);
    assert.equal(rows[0].textContent, "✓ Reading your resume");
    assert.equal(rows[1].textContent, "◌ Drafting target roles & strengths");
    assert.equal(rows[2].textContent, "· Writing your first-person narrative");
    assert.equal(rows[0].classList.contains("discovery-setup-wizard__busy-stage--done"), true);
    assert.equal(rows[1].classList.contains("discovery-setup-wizard__busy-stage--active"), true);
    assert.equal(rows[2].classList.contains("discovery-setup-wizard__busy-stage--todo"), true);
  });

  it("advances stages on a second setBusy call — the list is live, not a snapshot", () => {
    const { document, shell } = loadShell();
    renderWithAction(shell);
    shell.setBusy("ai_check", [
      { label: "Checking your key", state: "active" },
      { label: "Saving", state: "todo" },
    ]);
    shell.setBusy("ai_check", [
      { label: "Checking your key", state: "done" },
      { label: "Saving", state: "active" },
    ]);
    const rows = document
      .getElementById("discoverySetupWizardMount")
      .firstElementChild.querySelectorAll(".discovery-setup-wizard__busy-stage");
    assert.equal(rows[0].textContent, "✓ Checking your key");
    assert.equal(rows[1].textContent, "◌ Saving");
  });

  it("treats a bare string stage as not-yet-started", () => {
    const { document, shell } = loadShell();
    renderWithAction(shell);
    shell.setBusy("ai_check", ["Saving key…", "Verifying"]);
    const rows = document
      .getElementById("discoverySetupWizardMount")
      .firstElementChild.querySelectorAll(".discovery-setup-wizard__busy-stage");
    assert.equal(rows[0].textContent, "· Saving key…");
  });

  it("clearBusy re-enables the trigger and removes the stage list", () => {
    const { document, shell } = loadShell();
    renderWithAction(shell);
    shell.setBusy("ai_check", ["Checking your key…"]);
    shell.clearBusy();
    assert.equal(actionButton(document).disabled, false);
    assert.equal(
      document
        .getElementById("discoverySetupWizardMount")
        .firstElementChild.querySelectorAll(".discovery-setup-wizard__busy").length,
      0,
    );
  });

  it("leaves an action the host disabled on its own disabled after clearBusy", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      variant: "generic",
      steps: [
        {
          id: "ai",
          label: "AI",
          actions: [{ id: "ai_check", label: "Check & continue", disabled: true }],
        },
      ],
      state: { currentStep: "ai" },
      onAction() {},
    });
    shell.setBusy("ai_check", ["Checking…"]);
    shell.clearBusy();
    assert.equal(actionButton(document).disabled, true);
  });
});

// =====================================================================
// The lock. These two trees were captured from discovery-wizard-shell.js
// BEFORE the spine/message/busy additions. A legacy host passes none of
// the three, so its markup must still serialize identically — attribute
// for attribute, class for class, node for node.
// =====================================================================

const LEGACY_DISCOVERY_DETECT = `div.discovery-setup-wizard aria-describedby="discoverySetupWizardIntro" aria-labelledby="discoverySetupWizardTitle" aria-modal="true" role="dialog"
  div.discovery-setup-wizard__scrim aria-hidden="true" data:wizardAction="close"
  section.discovery-setup-wizard__panel data-wizard-panel="true" tabindex="-1"
    header.discovery-setup-wizard__header
      div.discovery-setup-wizard__title-block
        h2#discoverySetupWizardTitle.discovery-setup-wizard__title "Discovery setup"
      div.discovery-setup-wizard__header-meta
        button.discovery-setup-wizard__close aria-label="Close wizard" title="Close wizard" data:wizardAction="close"
          span.discovery-setup-wizard__close-icon "×"
          span.discovery-setup-wizard__close-label "Close"
    nav.discovery-setup-wizard__stepper aria-label="Discovery setup steps"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--active discovery-setup-wizard__seg--first aria-current="step" aria-label="Status. Current step." data:stepId="detect" data:wizardAction="step"
        span.discovery-setup-wizard__seg-label "Status"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--last aria-label="Path. Available." data:stepId="path_select" data:wizardAction="step"
        span.discovery-setup-wizard__seg-label "Path"
    div.discovery-setup-wizard__body
      section.discovery-setup-wizard__frame aria-live="polite"
        div.discovery-setup-wizard__step-kicker
          p.discovery-setup-wizard__step-kicker-text "Step 1 of 2"
        h3#discoverySetupWizardStepTitle.discovery-setup-wizard__step-title "Current setup status."
        p.discovery-setup-wizard__step-lede "Shows what's already connected and what still needs work."
        div.discovery-setup-wizard__default-body discovery-setup-wizard__step-content
          p.discovery-setup-wizard__copy discovery-setup-wizard__copy--lead "Shows what's already connected and what still needs work."
    footer.discovery-setup-wizard__footer
      div.discovery-setup-wizard__footer-note
        p.discovery-setup-wizard__copy "Use the step rail above to jump between steps."
      div.discovery-setup-wizard__actions
        button.discovery-setup-wizard__btn discovery-setup-wizard__btn--primary data:actionId="detect_refresh" data:actionKind="action" data:stepId="detect" data:wizardAction="action" "Re-check"
        button.discovery-setup-wizard__btn discovery-setup-wizard__btn--ghost data:actionId="detect_close" data:actionKind="close" data:stepId="detect" data:wizardAction="action" "Close"`;

const LEGACY_GOLIVE_JOURNEY = `div.discovery-setup-wizard aria-describedby="discoverySetupWizardIntro" aria-labelledby="discoverySetupWizardTitle" aria-modal="true" role="dialog"
  div.discovery-setup-wizard__scrim aria-hidden="true" data:wizardAction="close"
  section.discovery-setup-wizard__panel data-wizard-panel="true" tabindex="-1"
    header.discovery-setup-wizard__header
      div.discovery-setup-wizard__title-block
        img.discovery-setup-wizard__mascot-thumb alt="" aria-hidden="true" decoding="async" src="assets/mascot.webp"
        h2#discoverySetupWizardTitle.discovery-setup-wizard__title "Use JobBored on your other devices"
      div.discovery-setup-wizard__header-meta
        button.discovery-setup-wizard__close aria-label="Close wizard" title="Close wizard" data:wizardAction="close"
          span.discovery-setup-wizard__close-icon "×"
          span.discovery-setup-wizard__close-label "Close"
    ol.discovery-setup-wizard__journey aria-label="Setup progress"
      li.discovery-setup-wizard__journey-step discovery-setup-wizard__journey-step--done
        span.discovery-setup-wizard__journey-dot aria-hidden="true" "✓"
        span " Profile"
      li.discovery-setup-wizard__journey-step discovery-setup-wizard__journey-step--done
        span.discovery-setup-wizard__journey-dot aria-hidden="true" "✓"
        span " Job discovery"
      li.discovery-setup-wizard__journey-step discovery-setup-wizard__journey-step--current aria-current="step"
        span.discovery-setup-wizard__journey-dot aria-hidden="true" "3"
        span " Other devices"
    nav.discovery-setup-wizard__stepper aria-label="Discovery setup steps"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--active discovery-setup-wizard__seg--first aria-current="step" aria-label="Intro. Current step." data:stepId="intro" data:wizardAction="step"
        span.discovery-setup-wizard__seg-label "Intro"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--last aria-label="Done. Available." data:stepId="done" data:wizardAction="step"
        span.discovery-setup-wizard__seg-label "Done"
    div.discovery-setup-wizard__body
      section.discovery-setup-wizard__frame aria-live="polite"
        div.discovery-setup-wizard__step-kicker
          p.discovery-setup-wizard__step-kicker-text "Step 1 of 2"
        h3#discoverySetupWizardStepTitle.discovery-setup-wizard__step-title "Take it with you."
        p.discovery-setup-wizard__step-lede "Sync your setup."
        div.discovery-setup-wizard__default-body discovery-setup-wizard__step-content
          p.discovery-setup-wizard__copy discovery-setup-wizard__copy--lead "Sync your setup."
    footer.discovery-setup-wizard__footer
      div.discovery-setup-wizard__footer-note
        p.discovery-setup-wizard__copy "Use the step rail above to jump between steps."
      div.discovery-setup-wizard__actions
        button.discovery-setup-wizard__btn discovery-setup-wizard__btn--primary data:actionId="wizard_next" data:actionKind="next" data:stepId="intro" data:wizardAction="action" "Continue"`;

describe("legacy hosts render unchanged (SUBSTRATE locked decision 1)", () => {
  it("the discovery wizard's detect step is byte-identical to the pre-change shell", () => {
    const { document, shell } = loadShell({
      mountIds: ["discoverySetupWizardMount", "goLiveSetupWizardMount"],
    });
    shell.renderWizardShell({
      steps: [
        {
          id: "detect",
          label: "Status",
          title: "Current setup status.",
          description: "Shows what's already connected and what still needs work.",
          actions: [
            { id: "detect_refresh", label: "Re-check", variant: "primary", kind: "action" },
          ],
          secondaryActions: [
            { id: "detect_close", label: "Close", variant: "ghost", kind: "close" },
          ],
        },
        { id: "path_select", label: "Path", title: "Choose a connection method." },
      ],
      state: { currentStep: "detect", completedSteps: [] },
      snapshot: { sheetConfigured: true, engineState: "unverified" },
      onAction() {},
    });
    assert.equal(
      serializeTree(document.getElementById("discoverySetupWizardMount").firstElementChild),
      LEGACY_DISCOVERY_DETECT,
    );
  });

  it("the go-live host's journey strip is byte-identical to the pre-change shell", () => {
    const { document, shell } = loadShell({
      mountIds: ["discoverySetupWizardMount", "goLiveSetupWizardMount"],
    });
    shell.renderWizardShell({
      mountId: "goLiveSetupWizardMount",
      variant: "generic",
      headerTitle: "Use JobBored on your other devices",
      journeyStage: "devices",
      mascotSrc: "assets/mascot.webp",
      steps: [
        { id: "intro", label: "Intro", title: "Take it with you.", description: "Sync your setup." },
        { id: "done", label: "Done", title: "All set." },
      ],
      state: { currentStep: "intro", completedSteps: [] },
      onAction() {},
    });
    assert.equal(
      serializeTree(document.getElementById("goLiveSetupWizardMount").firstElementChild),
      LEGACY_GOLIVE_JOURNEY,
    );
  });
});
