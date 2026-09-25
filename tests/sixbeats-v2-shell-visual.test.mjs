import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadShell, readRepoFile, serializeTree } from "./oneflow-l0-harness.mjs";

/* ============================================================
   SIXBEATS lane V2 — shell-visual (claims U2, C7).

   U2 · the flow shell shipped THREE progress systems stacked on one
   screen: the 6-beat spine, the legacy step rail underneath it (a lone
   "GOOGLE" pill on beat 1), and a "Step 1 of 1" kicker inside the beat
   card — plus a footer note pointing at the rail. Spec §2 is "ONE
   spine". These probes pin the single progress system and the framing
   hook the CORE stylesheet paints against.

   C7 · at 390×844 beats 4–5 run past the fold and the actions are not
   reachable without scrolling to the bottom of a long card. The fix is
   structural: the beat body scrolls and the actions dock to a sticky
   bottom bar. The DOM hook is asserted here; the rule that uses it is
   asserted against the CORE region of css/oneflow.css, which is this
   lane's only stylesheet fence.

   Every addition is gated on the host passing `spine`, so the legacy
   hosts keep the byte-identical markup the L0 lock captured. The last
   suite extends that lock to a third legacy render.
   ============================================================ */

const CORE_START = "/* ONEFLOW:CORE */";
const CORE_END = "/* ONEFLOW:L1 */";

/** The CORE fence's text — the only region this lane may write CSS into. */
function coreRegion() {
  const css = readRepoFile("css/oneflow.css");
  const start = css.indexOf(CORE_START);
  const end = css.indexOf(CORE_END);
  assert.ok(start >= 0 && end > start, "css/oneflow.css must keep its CORE fence");
  return css.slice(start + CORE_START.length, end);
}

function renderSpineHost(shell, patch = {}) {
  return shell.renderWizardShell({
    variant: "generic",
    headerTitle: "Set up JobBored",
    steps: [
      {
        id: "google",
        label: "Google",
        title: "Your pipeline lives in a Google Sheet you own.",
        description:
          "Sign in and we'll create it for you. Nothing is stored on our side — there is no 'our side.'",
        actions: [
          { id: "google_start", label: "Continue with Google", variant: "primary" },
        ],
      },
    ],
    state: { currentStep: "google" },
    spine: {
      beats: [
        { id: "google", label: "Google" },
        { id: "ai", label: "AI" },
        { id: "resume", label: "Resume" },
        { id: "fit", label: "Your fit" },
        { id: "discovery", label: "Discovery" },
        { id: "payoff", label: "Done" },
      ],
      current: "google",
      timeLabel: "about 15 min left",
    },
    onAction() {},
    ...patch,
  });
}

function renderedRoot(document, mountId = "discoverySetupWizardMount") {
  return document.getElementById(mountId).firstElementChild;
}

describe("V2 · U2 — the flow shell shows ONE progress system (spec §2, §3.5.1)", () => {
  it("renders no legacy step rail beneath the spine", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const rootEl = renderedRoot(document);
    assert.equal(
      rootEl.querySelectorAll(".discovery-setup-wizard__stepper").length,
      0,
      "a second rail under the spine is claim U2 — the flow must never ship two rails",
    );
    assert.equal(
      rootEl.querySelectorAll(".discovery-setup-wizard__seg").length,
      0,
      "the rail's segments go with the rail, not just its container",
    );
    assert.equal(rootEl.querySelectorAll(".discovery-setup-wizard__spine").length, 1);
  });

  it("renders no 'Step 1 of 1' counter inside the beat card", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const rootEl = renderedRoot(document);
    assert.equal(
      rootEl.querySelectorAll(".discovery-setup-wizard__step-kicker-text").length,
      0,
      "the spine already says where you are; a per-beat counter is a third progress system",
    );
  });

  it("drops the footer note that points at the removed rail", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const note = renderedRoot(document).querySelector(
      ".discovery-setup-wizard__footer-note",
    );
    assert.equal(
      note.textContent.includes("step rail"),
      false,
      "the note pointed at a rail this lane deletes — a stale instruction is worse than none",
    );
  });

  it("keeps the back arrow, which is navigation and not progress", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell, {
      steps: [
        { id: "google", label: "Google", title: "One." },
        { id: "ai", label: "AI", title: "Two." },
      ],
      state: { currentStep: "ai", completedSteps: ["google"] },
      activeStepId: "ai",
    });
    const rootEl = renderedRoot(document);
    assert.equal(
      rootEl.querySelectorAll(".discovery-setup-wizard__back-arrow").length,
      1,
      "going back is how a stranger fixes a wrong answer — it survives the rail",
    );
  });

  it("keeps the title and Close together in the header", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const header = renderedRoot(document).querySelector(
      ".discovery-setup-wizard__header",
    );
    assert.equal(
      header.querySelector(".discovery-setup-wizard__title").textContent,
      "Set up JobBored",
    );
    assert.ok(
      header.querySelector(".discovery-setup-wizard__close"),
      "spec §3.4: closing is pausing — the exit is always on screen",
    );
  });

  it("marks the root with the one-flow variant hook the CORE sheet paints against", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    assert.equal(
      renderedRoot(document).classList.contains("discovery-setup-wizard--spine"),
      true,
    );
  });

  it("leaves the rail, the counter and the hook alone for a host with no spine", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      steps: [
        { id: "detect", label: "Status", title: "Current setup status." },
        { id: "path_select", label: "Path", title: "Choose a connection method." },
      ],
      state: { currentStep: "detect" },
      onAction() {},
    });
    const rootEl = renderedRoot(document);
    assert.equal(rootEl.classList.contains("discovery-setup-wizard--spine"), false);
    assert.equal(rootEl.querySelectorAll(".discovery-setup-wizard__stepper").length, 1);
    assert.equal(
      rootEl.querySelectorAll(".discovery-setup-wizard__step-kicker-text").length,
      1,
    );
  });
});

describe("V2 · U2 — the CORE fence carries the shell's framing (spec §3.5)", () => {
  it("scopes every new shell rule to the one-flow hook", () => {
    const core = coreRegion();
    for (const selector of [
      ".discovery-setup-wizard--spine .discovery-setup-wizard__panel",
      ".discovery-setup-wizard--spine .discovery-setup-wizard__frame",
      ".discovery-setup-wizard--spine .discovery-setup-wizard__header",
      ".discovery-setup-wizard--spine .discovery-setup-wizard__step-title",
    ]) {
      assert.ok(
        core.includes(selector),
        `the shell's framing must be painted in CORE and scoped: ${selector}`,
      );
    }
  });

  it("keeps the spine's segments and the minutes label styled as one row", () => {
    const core = coreRegion();
    assert.ok(
      core.includes(".discovery-setup-wizard--spine .discovery-setup-wizard__spine-dot"),
      "the prototype reads the spine as six filled segments, not six bullets",
    );
    assert.ok(
      core.includes(".discovery-setup-wizard--spine .discovery-setup-wizard__spine-time"),
      "'fifteen minutes, once' is the deal — the minutes label is styled, never inherited",
    );
  });

  it("styles the busy stage list and the message slot in the same fence", () => {
    const core = coreRegion();
    assert.ok(
      core.includes(
        ".discovery-setup-wizard--spine .discovery-setup-wizard__busy-stage",
      ),
    );
    assert.ok(
      core.includes(".discovery-setup-wizard--spine .discovery-setup-wizard__message"),
    );
  });

  it("writes nothing outside CORE", () => {
    const css = readRepoFile("css/oneflow.css");
    const afterCore = css.slice(css.indexOf(CORE_END));
    assert.equal(
      afterCore.includes("discovery-setup-wizard--spine"),
      false,
      "V2's fence is the CORE region only (SIXBEATS locked decision 4)",
    );
  });
});

describe("V2 · C7 — the phone gets a sticky action bar and a scrolling body", () => {
  it("docks the footer with its own hook when a host passes a spine", () => {
    const { document, shell } = loadShell();
    renderSpineHost(shell);
    const footer = renderedRoot(document).querySelector(
      ".discovery-setup-wizard__footer",
    );
    assert.equal(
      footer.classList.contains("discovery-setup-wizard__footer--dock"),
      true,
      "claim C7: on a phone the actions must not sit below a long card",
    );
  });

  it("leaves a spine-less host's footer undocked", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({
      steps: [{ id: "detect", label: "Status", title: "Current setup status." }],
      state: { currentStep: "detect" },
      onAction() {},
    });
    assert.equal(
      renderedRoot(document)
        .querySelector(".discovery-setup-wizard__footer")
        .classList.contains("discovery-setup-wizard__footer--dock"),
      false,
    );
  });

  it("pins the dock and the scrolling body inside a max-width 480px block", () => {
    const core = coreRegion();
    const start = core.indexOf("@media (max-width: 480px)");
    assert.ok(start >= 0, "the phone layout is a real breakpoint, not a guess about width");
    // Read to the end of the media block by brace balance so the assertions
    // below can only pass on rules that are actually inside it.
    let depth = 0;
    let i = core.indexOf("{", start);
    const open = i;
    for (; i < core.length; i += 1) {
      if (core[i] === "{") depth += 1;
      else if (core[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const block = core.slice(open, i);
    assert.ok(
      /\.discovery-setup-wizard__footer--dock[^{]*\{[^}]*position:\s*sticky/.test(block),
      "the actions dock to the bottom of the viewport on a phone",
    );
    assert.ok(
      /\.discovery-setup-wizard__body[^{]*\{[^}]*overflow-y:\s*auto/.test(block),
      "the body — not the page — is what scrolls behind the dock",
    );
  });
});

// =====================================================================
// The lock, extended. Two trees were captured by the L0 suite; this adds
// the third legacy render — the shell's own default blueprint, used when
// a host passes no steps at all. All three pass no spine, so all three
// must serialize exactly as they did before this lane.
// =====================================================================

const LEGACY_DEFAULT_BLUEPRINT = `div.discovery-setup-wizard aria-describedby="discoverySetupWizardIntro" aria-labelledby="discoverySetupWizardTitle" aria-modal="true" role="dialog"
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
      button.discovery-setup-wizard__seg aria-label="Path. Available." data:stepId="path_select" data:wizardAction="step"
        span.discovery-setup-wizard__seg-label "Path"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Manual. Locked." data:stepId="no_webhook" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Manual"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Endpoint. Locked." data:stepId="existing_endpoint" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Endpoint"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Config. Locked." data:stepId="bootstrap" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Config"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Server. Locked." data:stepId="local_health" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Server"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Tunnel. Locked." data:stepId="tunnel" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Tunnel"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Relay. Locked." data:stepId="relay_deploy" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Relay"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Test. Locked." data:stepId="verify" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Test"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--locked aria-label="Done. Locked." data:stepId="ready" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Done"
      button.discovery-setup-wizard__seg discovery-setup-wizard__seg--last discovery-setup-wizard__seg--locked aria-label="Stub. Locked." data:stepId="stub_only" data:wizardAction="step" [disabled]
        span.discovery-setup-wizard__seg-label "Stub"
    div.discovery-setup-wizard__body
      section.discovery-setup-wizard__frame aria-live="polite"
        div.discovery-setup-wizard__step-kicker
          p.discovery-setup-wizard__step-kicker-text "Step 1 of 11"
        h3#discoverySetupWizardStepTitle.discovery-setup-wizard__step-title "Current setup status."
        p.discovery-setup-wizard__step-lede "Shows what's already connected and what still needs work."
        div.discovery-setup-wizard__default-body discovery-setup-wizard__step-content
          p.discovery-setup-wizard__copy discovery-setup-wizard__copy--lead "Shows what's already connected and what still needs work."
    footer.discovery-setup-wizard__footer
      div.discovery-setup-wizard__footer-note
        p.discovery-setup-wizard__copy "Use the step rail above to jump between steps."
      div.discovery-setup-wizard__actions
        button.discovery-setup-wizard__btn discovery-setup-wizard__btn--primary data:actionId="wizard_next" data:actionKind="next" data:stepId="detect" data:wizardAction="action" "Continue"`;

describe("V2 · the third legacy host renders unchanged (SUBSTRATE locked decision 1)", () => {
  it("the shell's default blueprint is byte-identical to the pre-lane shell", () => {
    const { document, shell } = loadShell();
    shell.renderWizardShell({ onAction() {} });
    assert.equal(
      serializeTree(renderedRoot(document)),
      LEGACY_DEFAULT_BLUEPRINT,
      "V2 adds nothing to a host that passes no spine — not a class, not a node",
    );
  });
});
