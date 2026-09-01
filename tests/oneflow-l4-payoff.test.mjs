import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadPayoff, plain, readRepoFile, textOf } from "./oneflow-l4-harness.mjs";

/* ============================================================
   Beat B6 — You're live (ONE-FLOW-ONBOARDING-SPEC §5 B6).

   WHY: the teardown's worst finding was eleven "done" moments before a
   single job existed. B6 is the ONE payoff, and it only earns that name
   if it reports back what the user actually bought — their real roles,
   their real provider, their real source count, their real sheet — and
   then makes jobs appear. So the probes refuse anything hardcoded:
   every line is asserted against a state stub, and the run action is
   asserted to pre-check the intent that would otherwise make it bail
   silently.
   ============================================================ */

function beat(env) {
  const b = env.flow.getBeat("payoff");
  assert.ok(b, "B6 must register itself against the flow controller");
  return b;
}

/** Render B6 against a resolved view model, the way the shell does. */
async function renderPayoff(env, overrides = {}) {
  const state = await env.payoff.resolvePayoffState({
    state: { skipped: {}, completedBeats: [], ...(overrides.flowState || {}) },
    runtime: overrides.runtime || {},
  });
  const container = env.document.createElement("div");
  env.payoff.renderPayoff(container, state);
  return { container, state };
}

describe("B6 registration (spec §3.1)", () => {
  it("registers as beat 6 — the last one", () => {
    const env = loadPayoff();
    assert.equal(beat(env).order, 6);
    assert.equal(beat(env).label, "Done");
  });

  it("headline and sub are the spec's strings, verbatim", () => {
    const env = loadPayoff();
    // Since routed L7 #9, B6 registers a RESOLVER rather than the frozen
    // template — the shell title has to read the real name too, not just
    // the celebration overlay (spec §5 B6). The template itself is still
    // the spec's string, and the resolver is what fills it.
    assert.equal(env.payoff.HEADLINE, "You're live, {firstName}.");
    assert.equal(typeof beat(env).headline, "function");
    assert.equal(
      beat(env).headline({ runtime: { firstName: "Priya" } }),
      "You're live, Priya.",
    );
    assert.equal(
      beat(env).sub,
      "That was the one-time part. From here, JobBored works for you.",
    );
  });
});

describe("B6 — 'You're live, {firstName}.' (spec §5 B6)", () => {
  it("uses the first name from the Google session", async () => {
    const env = loadPayoff({ givenName: "Priya" });
    const { state } = await renderPayoff(env);
    assert.equal(state.headline, "You're live, Priya.");
  });

  it("falls back gracefully to 'You're live.' when the name is unknown", async () => {
    const env = loadPayoff({ givenName: "" });
    const { state } = await renderPayoff(env);
    assert.equal(
      state.headline,
      "You're live.",
      "spec §5 B6 names this fallback — a dangling comma is worse than no name",
    );
  });

  it("prefers a first name the flow already carries over a second session read", async () => {
    const env = loadPayoff({ givenName: "Priya" });
    const { state } = await renderPayoff(env, { runtime: { firstName: "Sam" } });
    assert.equal(state.headline, "You're live, Sam.");
  });
});

describe("B6 card 1 — Your search (spec §5 B6)", () => {
  it("reads roles, where, floor, and the top THREE strengths from the saved profile", async () => {
    const env = loadPayoff();
    const { container, state } = await renderPayoff(env);
    assert.deepEqual(plain(state.search.roles), [
      "Staff Product Designer",
      "Design Systems Lead",
    ]);
    assert.deepEqual(plain(state.search.locations), ["Remote — US"]);
    assert.equal(state.search.floor, "$185,000");
    assert.deepEqual(
      plain(state.search.edge),
      ["Design systems", "Cross-functional leadership", "Accessibility"],
      "edge is the top 3 strengths — the fourth is not an edge",
    );
    const card = container.querySelector(".oneflow-payoff__search");
    assert.ok(card, "the search card renders");
    const text = textOf(card);
    assert.ok(text.includes("Staff Product Designer"));
    assert.ok(text.includes("Remote — US"));
    assert.ok(text.includes("$185,000"));
    assert.ok(text.includes("Design systems"));
    assert.ok(
      !text.includes("Prototyping"),
      "only the top three strengths are the edge",
    );
  });

  it("omits the floor line rather than inventing one when none was set", async () => {
    const env = loadPayoff({
      fitProfile: {
        profile: {
          identity: { targetRoles: ["Data Engineer"] },
          strengths: [{ name: "Pipelines", rank: 1 }],
          hardConstraints: { acceptableLocations: [], salaryFloor: null },
        },
      },
    });
    const { container, state } = await renderPayoff(env);
    assert.equal(state.search.floor, "");
    assert.ok(
      !textOf(container.querySelector(".oneflow-payoff__search")).includes("Floor"),
      "an unset floor is silence, never $0",
    );
  });

  it("survives an unreachable profile server without losing the payoff", async () => {
    const env = loadPayoff();
    env.window.FitProfileForm.fetchProfile = async () => {
      throw new Error("ECONNREFUSED");
    };
    const { container, state } = await renderPayoff(env);
    assert.deepEqual(plain(state.search.roles), []);
    assert.ok(
      textOf(container).includes("That was the one-time part."),
      "the receipt still renders — a dead /profile is not a dead payoff",
    );
  });
});

describe("B6 card 2 — What happens now (spec §5 B6)", () => {
  it("names the provider the user actually configured", async () => {
    const env = loadPayoff({ provider: "anthropic" });
    const { container } = await renderPayoff(env);
    assert.ok(
      textOf(container).includes("✓ AI connected — Anthropic"),
      "the provider line is read from config, never hardcoded to Gemini",
    );
  });

  it("counts armed sources from the discovery snapshot and credits Google's index", async () => {
    const env = loadPayoff();
    const { container, state } = await renderPayoff(env);
    assert.equal(state.sourceCount, 3);
    assert.ok(
      textOf(container).includes(
        "✓ Discovery armed — 3 sources watching, including Google's job index",
      ),
    );
  });

  it("says 'source' not 'sources' when exactly one lane is armed", async () => {
    const env = loadPayoff();
    env.window.JobBoredDiscoveryPayload = {
      buildSearchPlan: () => ({ facets: { sourceLanes: ["serpapi_google_jobs"] } }),
    };
    const { container } = await renderPayoff(env);
    assert.ok(
      textOf(container).includes(
        "✓ Discovery armed — 1 source watching, including Google's job index",
      ),
    );
  });

  it("links the connected sheet so 'open it ↗' is a real door", async () => {
    const env = loadPayoff({ sheetId: "SHEET_ABC" });
    const { container } = await renderPayoff(env);
    const link = container.querySelector(".oneflow-payoff__sheet-link");
    assert.ok(link, "the sheet line carries a link");
    assert.equal(textOf(link), "open it ↗");
    assert.equal(
      link.getAttribute("href"),
      "https://docs.google.com/spreadsheets/d/SHEET_ABC/edit",
    );
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener");
  });

  it("ships the ETA line verbatim", async () => {
    const env = loadPayoff();
    const { container } = await renderPayoff(env);
    assert.ok(
      textOf(container).includes(
        "⏱ First matches land tomorrow morning — or run it right now and watch.",
      ),
    );
  });

  it("ships the footer line verbatim", async () => {
    const env = loadPayoff();
    const { container } = await renderPayoff(env);
    assert.ok(
      textOf(container).includes(
        "More power-ups — URL import, grounded search, other devices — live in Settings → Upgrades, each one click, none required.",
      ),
    );
  });
});

describe("B6 skipped-connect variant (spec §5 B6)", () => {
  const skipped = { flowState: { skipped: { discoveryConnect: true } } };

  it("replaces the armed line with the honest keys-saved line", async () => {
    const env = loadPayoff();
    const { container } = await renderPayoff(env, skipped);
    const text = textOf(container);
    assert.ok(
      text.includes(
        "○ Connection is off — your AI and Google-index keys are saved; connect anytime from the banner below",
      ),
    );
    assert.ok(
      !text.includes("Discovery armed"),
      "claiming discovery is armed when it isn't is the lie this variant exists to prevent",
    );
  });

  it("makes 'Go to my dashboard' the primary and offers the connect escape", async () => {
    const env = loadPayoff();
    const { state } = await renderPayoff(env, skipped);
    assert.deepEqual(
      plain(state.actions).map((a) => [a.id, a.label, a.variant]),
      [
        ["payoff_dashboard", "Go to my dashboard", "primary"],
        ["payoff_connect_discovery", "Actually — connect discovery", "ghost"],
      ],
    );
  });

  it("keeps 'Run discovery now' primary on the connected path", async () => {
    const env = loadPayoff();
    const { state } = await renderPayoff(env);
    assert.deepEqual(
      plain(state.actions).map((a) => [a.id, a.label, a.variant]),
      [
        ["payoff_run_now", "Run discovery now", "primary"],
        ["payoff_dashboard", "Take me to my dashboard", "ghost"],
      ],
    );
  });

  it("never renders a three-circles-of-skip screen", async () => {
    const env = loadPayoff();
    const { container } = await renderPayoff(env, skipped);
    const text = textOf(container).toLowerCase();
    for (const dead of ["skip for now", "you can do this later", "remind me later"]) {
      assert.ok(!text.includes(dead), `"${dead}" is the pattern §5 B6 forbids`);
    }
  });
});

describe("B6 — the one celebration fires here and only here (spec §5 B6, §7)", () => {
  it("plays the flow finale stage with the resolved headline", async () => {
    const env = loadPayoff({ givenName: "Priya" });
    const state = await env.payoff.resolvePayoffState({
      state: { skipped: {}, completedBeats: [] },
      runtime: {},
    });
    env.payoff.celebrate(state);
    assert.deepEqual(env.calls.celebration, ["flow_payoff"]);
  });

  it("fires at most once per flow, even if the beat re-renders", async () => {
    const env = loadPayoff();
    const state = await env.payoff.resolvePayoffState({
      state: { skipped: {}, completedBeats: [] },
      runtime: {},
    });
    env.payoff.celebrate(state);
    env.payoff.celebrate(state);
    assert.equal(
      env.calls.celebration.length,
      1,
      "spec §10 Phase 1 acceptance: exactly ONE confetti burst per profile",
    );
  });
});

describe("B6 'Run discovery now' (spec §5 B6)", () => {
  function ctxFor(env, sink) {
    return {
      state: { skipped: {}, completedBeats: [] },
      runtime: {},
      setMessage: (text, tone) => sink.messages.push([text, tone]),
      setBusy: (id, stages) => sink.busy.push([id, stages]),
      clearBusy: () => sink.busy.push(["clear"]),
      completeBeat: (detail) => {
        sink.completed.push(detail || {});
        return Promise.resolve();
      },
      skipBeat: () => Promise.resolve(),
      goToBeat: () => Promise.resolve(),
    };
  }
  const sink = () => ({ messages: [], busy: [], completed: [] });

  it("pre-checks intent so the run cannot bail on blank_intent", async () => {
    const env = loadPayoff();
    const s = sink();
    await beat(env).onAction("payoff_run_now", ctxFor(env, s));
    assert.equal(env.calls.discoveryRuns.length, 1, "the run actually fires");
    assert.equal(
      env.calls.discoveryRuns[0].trigger,
      "onboarding_payoff",
      "the run is labelled so the funnel can see it",
    );
  });

  it("refuses to fire — loudly — when B4 somehow left no intent behind", async () => {
    // "Guaranteed full-power" is the promise. If the invariant is broken,
    // the user must see WHY, not a run that silently returns blank_intent.
    const env = loadPayoff({
      intent: { targetRoles: [], includeKeywords: [] },
    });
    const s = sink();
    await beat(env).onAction("payoff_run_now", ctxFor(env, s));
    assert.equal(env.calls.discoveryRuns.length, 0, "no silent-bail run is sent");
    assert.equal(s.messages.length, 1, "the message slot carries the reason");
    assert.equal(s.messages[0][1], "error");
    assert.match(
      s.messages[0][0],
      /roles|keywords/i,
      "spec §8.4 — every error names the next action",
    );
    assert.equal(
      s.completed.length,
      0,
      "a broken invariant must not be flagged as a completed flow",
    );
  });

  it("completes the beat so the controller writes the flags and closes the shell", async () => {
    const env = loadPayoff();
    const s = sink();
    await beat(env).onAction("payoff_run_now", ctxFor(env, s));
    assert.equal(s.completed.length, 1);
    assert.equal(s.completed[0].ran, true);
  });

  it("'Take me to my dashboard' completes the beat WITHOUT running", async () => {
    const env = loadPayoff();
    const s = sink();
    await beat(env).onAction("payoff_dashboard", ctxFor(env, s));
    assert.equal(env.calls.discoveryRuns.length, 0);
    assert.equal(s.completed.length, 1, "exiting either way ends the flow (spec §5 B6 Exit)");
    assert.equal(s.completed[0].ran, false);
  });

  it("shows its stages instead of the 20–120s silence the teardown found", async () => {
    const env = loadPayoff();
    const s = sink();
    await beat(env).onAction("payoff_run_now", ctxFor(env, s));
    assert.ok(s.busy.length >= 1, "the trigger renders a live stage list");
    assert.equal(s.busy[0][0], "payoff_run_now");
    assert.ok(Array.isArray(s.busy[0][1]) && s.busy[0][1].length >= 1);
  });
});

describe("B6 first_results telemetry (spec §9)", () => {
  it("emits first_results {count, ms} the first time the poll reports rows", async () => {
    const env = loadPayoff();
    const seen = [];
    env.payoff._armFirstResults((detail) => seen.push(detail));
    env.payoff._onRunUpdate({ leadsWritten: 0, leadsUpdated: 0 });
    assert.equal(seen.length, 0, "an empty poll is not a result");
    env.payoff._onRunUpdate({ leadsWritten: 4, leadsUpdated: 1 });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].count, 5, "written plus updated is what landed on the board");
    assert.equal(typeof seen[0].ms, "number");
    assert.ok(seen[0].ms >= 0);
    env.payoff._onRunUpdate({ leadsWritten: 9 });
    assert.equal(seen.length, 1, "FIRST results — the event fires once per run");
  });

  it("reads the frozen step name from the telemetry vocabulary, never a literal", () => {
    const src = readRepoFile("oneflow-beat-payoff.js");
    assert.match(
      src,
      /STEPS\.FIRST_RESULTS|steps\(\)\.FIRST_RESULTS/,
      "spec §9: every emit site references STEPS.*",
    );
  });
});

describe("B6 in the real shell — the footer carries the right primary", () => {
  /* This is the probe that guards an ordering coupling: the beat resolves
     its action variant while its body renders, and the shell builds the
     footer from the SAME array afterwards. If that order ever changes,
     the payoff would ship the wrong primary silently — so the claim is
     asserted end-to-end through renderWizardShell, not on the view model. */
  async function openPayoff(env) {
    await env.flow.goToBeat("payoff");
    const mount = env.document.getElementById("oneFlowMount");
    return mount
      .querySelectorAll(".discovery-setup-wizard__btn")
      .map((btn) => [
        btn.dataset.actionId,
        textOf(btn),
        btn.classList.contains("discovery-setup-wizard__btn--primary")
          ? "primary"
          : btn.classList.contains("discovery-setup-wizard__btn--ghost")
            ? "ghost"
            : "secondary",
      ]);
  }

  it("connected: Run discovery now is the footer primary", async () => {
    const env = loadPayoff();
    assert.deepEqual(plain(await openPayoff(env)), [
      ["payoff_run_now", "Run discovery now", "primary"],
      ["payoff_dashboard", "Take me to my dashboard", "ghost"],
    ]);
  });

  it("skipped connect: Go to my dashboard is the footer primary", async () => {
    const env = loadPayoff();
    await env.store.saveOnboardingFlowState({
      skipped: { discoveryConnect: true },
    });
    assert.deepEqual(plain(await openPayoff(env)), [
      ["payoff_dashboard", "Go to my dashboard", "primary"],
      ["payoff_connect_discovery", "Actually — connect discovery", "ghost"],
    ]);
  });

  it("renders the payoff body into the shell, not a placeholder card", async () => {
    const env = loadPayoff();
    await env.flow.goToBeat("payoff");
    const mount = env.document.getElementById("oneFlowMount");
    assert.equal(
      mount.querySelector(".oneflow-placeholder"),
      null,
      "the L0 stub is gone",
    );
    assert.ok(mount.querySelector(".oneflow-payoff__now"), "B6's own body renders");
  });
});

describe("B6 intent pre-check reads the SAME payload the run will send", () => {
  it("guards on the run's own payload, not a second guess at it", async () => {
    // If the pre-check and triggerDiscoveryRun's guard resolved intent from
    // different sources, this beat could either block a run the worker
    // would accept, or wave through one that bails on blank_intent — both
    // of which reintroduce the dead end B6 exists to close.
    const env = loadPayoff();
    const s = {
      messages: [],
      busy: [],
      completed: [],
    };
    await env.flow.getBeat("payoff").onAction("payoff_run_now", {
      state: { skipped: {}, completedBeats: [] },
      runtime: {},
      setMessage: (t, tone) => s.messages.push([t, tone]),
      setBusy: (id, stages) => s.busy.push([id, stages]),
      clearBusy: () => {},
      completeBeat: (d) => {
        s.completed.push(d);
        return Promise.resolve();
      },
      goToBeat: () => Promise.resolve(),
    });
    assert.equal(env.calls.payloads.length, 1, "the run payload is built once");
    assert.equal(env.calls.intentInputs.length, 1);
    const input = env.calls.intentInputs[0];
    assert.ok(input.discoveryProfile, "the free-form profile feeds the check");
    assert.ok(
      input.mergedUserProfile,
      "and so does the fit profile — B4's roles are intent (AGENT_CONTRACT row 120)",
    );
  });

  it("falls back to the stored profile when no host bridge is present", async () => {
    const env = loadPayoff();
    delete env.window.JobBoredApp.core.host.buildDiscoveryWebhookPayload;
    const s = { completed: [], messages: [] };
    await env.flow.getBeat("payoff").onAction("payoff_run_now", {
      state: { skipped: {}, completedBeats: [] },
      runtime: {},
      setMessage: (t, tone) => s.messages.push([t, tone]),
      setBusy: () => {},
      clearBusy: () => {},
      completeBeat: (d) => {
        s.completed.push(d);
        return Promise.resolve();
      },
      goToBeat: () => Promise.resolve(),
    });
    assert.equal(env.calls.intentInputs.length, 1, "the check still runs");
    assert.equal(
      s.completed.length,
      1,
      "a missing bridge must not turn the payoff into a dead end",
    );
  });
});
