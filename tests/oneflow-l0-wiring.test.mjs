import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOneFlow, readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   SUBSTRATE locked decisions 1–4. L0 owns index.html, package.json and
   the CSS skeleton so beat lanes touch exactly one file each. Three
   things go wrong silently without these probes, and each has cost this
   repo hours before:

     · a script tag placed BEFORE user-content-store.js parses against an
       undefined window.CommandCenterUserContent and dies without a sound
       (the welcome.js death);
     · a browser file missing from `typecheck:repo` passes typecheck while
       broken;
     · the substrate quietly going live before L6 flips boot.
   ============================================================ */

const NEW_BROWSER_FILES = [
  "onboarding-flow.js",
  "oneflow-beat-google.js",
  "oneflow-beat-ai.js",
  "oneflow-beat-resume.js",
  "oneflow-beat-fit.js",
  "oneflow-beat-discovery.js",
  "oneflow-beat-payoff.js",
  "oneflow-demo-board.js",
  "onboarding-celebration.js",
];

const indexHtml = readRepoFile("index.html");
const packageJson = JSON.parse(readRepoFile("package.json"));
const oneflowCss = readRepoFile("css/oneflow.css");

describe("index.html — the one mount and the new script tags (locked decision 2)", () => {
  it("gains #oneFlowMount beside the other wizard mounts", () => {
    assert.match(indexHtml, /id="oneFlowMount"/);
    assert.match(
      indexHtml,
      /id="oneFlowMount"[\s\S]{0,200}?hidden/,
      "the mount ships hidden — the substrate lands dark",
    );
  });

  it("links css/oneflow.css", () => {
    assert.match(indexHtml, /href="css\/oneflow\.css"/);
  });

  it("loads every new module AFTER user-content-store.js", () => {
    const storeIndex = indexHtml.indexOf('src="user-content-store.js"');
    assert.notEqual(storeIndex, -1);
    for (const file of NEW_BROWSER_FILES) {
      const tag = indexHtml.indexOf(`src="${file}"`);
      assert.notEqual(tag, -1, `${file} needs a script tag in index.html`);
      assert.ok(
        tag > storeIndex,
        `${file} must load after user-content-store.js — a parse-time read of ` +
          "window.CommandCenterUserContent from an earlier tag dies silently",
      );
    }
  });

  it("loads onboarding-flow.js before the beats that register against it", () => {
    const controller = indexHtml.indexOf('src="onboarding-flow.js"');
    for (const file of NEW_BROWSER_FILES.filter((f) => f.startsWith("oneflow-beat-"))) {
      assert.ok(
        indexHtml.indexOf(`src="${file}"`) > controller,
        `${file} registers against window.JobBoredOneFlow and must load after it`,
      );
    }
  });

  it("loads the shell before the controller that renders through it", () => {
    assert.ok(
      indexHtml.indexOf('src="discovery-wizard-shell.js"') <
        indexHtml.indexOf('src="onboarding-flow.js"'),
    );
  });
});

describe("package.json — every new browser file is typechecked (locked decision 3)", () => {
  it("typecheck:repo runs node --check on each one", () => {
    const cmd = packageJson.scripts["typecheck:repo"];
    for (const file of NEW_BROWSER_FILES) {
      assert.ok(
        cmd.includes(`node --check ${file}`),
        `${file} is missing from typecheck:repo — it would pass while broken`,
      );
    }
  });
});

describe("css/oneflow.css — per-lane fences (locked decision 4)", () => {
  it("ships one fenced region per lane so appends never collide", () => {
    for (const fence of [
      "/* ONEFLOW:CORE */",
      "/* ONEFLOW:L1 */",
      "/* ONEFLOW:L2 */",
      "/* ONEFLOW:L3 */",
      "/* ONEFLOW:L4 */",
    ]) {
      assert.ok(oneflowCss.includes(fence), `missing fence ${fence}`);
    }
  });

  it("keeps the fences in lane order", () => {
    const positions = ["CORE", "L1", "L2", "L3", "L4"].map((name) =>
      oneflowCss.indexOf(`/* ONEFLOW:${name} */`),
    );
    for (let i = 1; i < positions.length; i += 1) {
      assert.ok(positions[i] > positions[i - 1], "fences must stay in lane order");
    }
  });

  it("styles the shell regions L0 added, so the spine and message slot are not unstyled", () => {
    for (const selector of [
      ".discovery-setup-wizard__spine",
      ".discovery-setup-wizard__spine-step--current",
      ".discovery-setup-wizard__spine-time",
      ".discovery-setup-wizard__message",
      ".discovery-setup-wizard__busy-stage",
    ]) {
      assert.ok(oneflowCss.includes(selector), `${selector} has no styling`);
    }
  });
});

describe("the beat stubs register themselves (locked decision 3)", () => {
  it("loading the six stub files fills the registry in spec order", () => {
    const { flow } = loadOneFlow({ beatFiles: true });
    assert.deepEqual(
      [...flow.getRegisteredBeats().map((b) => b.id)],
      ["google", "ai", "resume", "fit", "discovery", "payoff"],
    );
  });

  it("every stub carries its normative headline, sub, and time label", () => {
    const { flow } = loadOneFlow({ beatFiles: true });
    // Copy is NORMATIVE (spec §5) — these strings ship verbatim, so the
    // stub is where they land first and the lane that fills the beat in
    // inherits them rather than retyping them.
    const expected = {
      google: "Your pipeline lives in a Google Sheet you own.",
      ai: "Now give it a brain.",
      resume: "Drop in your resume. We'll do the typing.",
      fit: "Here's how we'll judge every job for you.",
      discovery: "Now the engine: jobs come to you.",
      payoff: "You're live, {firstName}.",
    };
    for (const beat of flow.getRegisteredBeats()) {
      assert.equal(beat.headline, expected[beat.id]);
      assert.ok(beat.sub, `${beat.id} must carry its normative sub`);
      assert.ok(
        beat.timeLabel,
        `${beat.id} must carry a time label — voice rule §8.2 says every beat shows one`,
      );
    }
  });

  it("renders a six-segment spine once all six beats are registered", async () => {
    const { flow, document } = loadOneFlow({ beatFiles: true });
    await flow.open("resume");
    const mount = document.getElementById("oneFlowMount");
    const segs = mount.querySelectorAll(".discovery-setup-wizard__spine-step");
    assert.equal(segs.length, 6, "spec §3.1: six beats, one spine");
    assert.equal(
      segs[2].classList.contains("discovery-setup-wizard__spine-step--current"),
      true,
    );
    assert.equal(
      mount.querySelector(".discovery-setup-wizard__spine-time").textContent,
      "about 8 min left",
      "the spine shows the CURRENT beat's remaining-time label",
    );
  });

  // RETIRED (integration, 2026-09-01): "an UNFILLED beat still renders its
  // placeholder card" was transitional scaffolding for the dark-landing
  // period — it needed at least one stub beat to exist. L1 filled
  // google/ai/resume, L3 filled discovery, L4 filled payoff, and L2 filled
  // fit; there is no unfilled beat left to point it at, and the controller
  // intentionally has no runtime placeholder path (beats are static files,
  // so an unfilled beat cannot exist in shipped code).

  it("the demo board and celebration modules load without registering a beat", () => {
    const { window: win, flow } = loadOneFlow({ beatFiles: true });
    assert.ok(win.JobBoredOneFlowDemoBoard, "S0 is a screen, not a beat");
    assert.ok(win.JobBoredOnboardingCelebration);
    assert.equal(flow.getRegisteredBeats().length, 6);
  });
});

describe("the substrate is LIT — and only at the two boot files (L6 cutover)", () => {
  // Locked decision 1 held the substrate dark through L1-L5 so every
  // intermediate merge kept the legacy chain running. L6 flipped it: the
  // two boot files, and only those two, now reach for the flow.
  it("the boot chain runs the flow's entry decision", () => {
    assert.ok(
      readRepoFile("discovery-status-handoff.js").includes("maybeStart"),
      "the post-access chain must ask the controller (spec §3.3)",
    );
    assert.ok(
      readRepoFile("app-bootstrap.js").includes("JobBoredOneFlowDemoBoard"),
      "the cold start must open S0 (spec §4)",
    );
  });

  it("the legacy onboarding surfaces reference the flow only to STAND DOWN", () => {
    // Three surfaces still paint over the dashboard on paths the flow now
    // owns: the first-run infra wizard and the starter-setup screen fire
    // on post-sign-in (Beat 1's own state), and welcome.js's onboarding
    // card mounts on every cold start (screen S0's). Each asks whether the
    // flow is there and declines; none drives it. L7 deletes all three.
    const sources = {
      "first-run-wizard.js": readRepoFile("first-run-wizard.js"),
      "sheet-access-setup.js": readRepoFile("sheet-access-setup.js"),
      "welcome.js": readRepoFile("welcome.js"),
    };
    assert.match(
      sources["first-run-wizard.js"],
      /if \(window\.JobBoredOneFlow\) return false;/,
      "checkInfraSetupGate must decline while the one-flow is on the page",
    );
    assert.match(sources["sheet-access-setup.js"], /function oneFlowOwnsSurface\(\)/);
    assert.match(
      sources["welcome.js"],
      /if \(window\.JobBoredOneFlow\) return false;/,
      "welcome's onboarding half must not mount over S0",
    );
    for (const [file, source] of Object.entries(sources)) {
      assert.equal(
        /JobBoredOneFlow\.(open|goToBeat|completeBeat|registerBeat)/.test(source),
        false,
        `${file} may ask about the flow, never drive it`,
      );
    }
  });

  it("no OTHER shipped module reaches for JobBoredOneFlow", () => {
    // Everything else stays on its own wiring until L7 deletes it; a
    // stray reference here would mean the cutover leaked past boot.
    for (const file of [
      "app.js",
      "app-compat.js",
      "whats-next-banner.js",
      "onboarding-wizard.js",
    ]) {
      assert.equal(
        readRepoFile(file).includes("JobBoredOneFlow"),
        false,
        `${file} must stay on the legacy chain until L7`,
      );
    }
  });
});
