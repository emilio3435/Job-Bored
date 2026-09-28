import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile } from "./oneflow-l0-harness.mjs";

/* ============================================================
   GFX FE-B1 — setup docs and the voice sheet (G10, G14, G17–G20,
   G22, B1-N5, B2-8, N-B3-5, X4).

   A stranger reads SETUP.md and README.md before the app. These
   probes pin the rows where the docs described deleted screens, put
   steps in an impossible order, or named a concept three ways.
   ============================================================ */

const ONE_FLOW =
  "Open http://localhost:8080 and follow the one setup flow — step 1 signs you in with Google and creates your Sheet.";

const setup = () => readRepoFile("SETUP.md");
const readme = () => readRepoFile("README.md");

function headers() {
  const src = readRepoFile("app-config-core.js");
  const block = src.match(/STARTER_PIPELINE_HEADERS = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("G14 · the one-flow sentence replaces the deleted login gate and wizard", () => {
  for (const [name, read] of [
    ["SETUP.md", setup],
    ["README.md", readme],
  ]) {
    it(`${name} never mentions the login gate or the first-run wizard`, () => {
      const doc = read();
      assert.equal(/login gate/i.test(doc), false);
      assert.equal(/first-run wizard/i.test(doc), false);
      assert.ok(doc.includes(ONE_FLOW));
    });
  }
});

describe("B1-N5 · SETUP.md orders the Client ID before the Sheet", () => {
  it("§1 is the Client ID and §2 is the Sheet", () => {
    const doc = setup();
    const clientId = doc.indexOf("### 1. Create a Google Client ID");
    const sheet = doc.indexOf("### 2. Create or connect your Sheet");
    assert.ok(clientId > 0 && sheet > clientId);
  });
});

describe("G10 · the permission table has the optional Apps Script row", () => {
  it("names script.projects, script.deployments and the Apps Script API", () => {
    const row = setup()
      .split("\n")
      .find((line) => line.startsWith("| Optional: Apps Script webhook"));
    assert.ok(row);
    assert.match(row, /script\.projects/);
    assert.match(row, /script\.deployments/);
    assert.match(row, /Apps Script API/);
  });
});

describe("G17 · the blank-sheet path lists the starter headers", () => {
  it("SETUP.md carries all 26 headers, in order, from app-config-core.js", () => {
    const list = headers();
    assert.equal(list.length, 26);
    assert.ok(setup().includes(list.join("\t")), "one tab-separated row, pasteable into row 1");
  });

  it("the greenfield Sheets stub accepts the canonical starter header row", () => {
    const spec = readRepoFile("tests/e2e-onboarding/greenfield-onboarding.spec.mjs");
    const block = spec.match(/const STARTER_HEADERS = \[([\s\S]*?)\];/);
    assert.ok(block, "greenfield Sheets stub must declare its accepted header row");
    const accepted = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    const canonical = JSON.parse(readRepoFile("schemas/pipeline-row.v1.json")).headerRow;
    assert.deepEqual(accepted, canonical, "a stale stub rejects Sheet creation and strands the Google beat");
  });
});

describe("G18 · G19 · G20 · G22 · the sheet section", () => {
  it("G18: one duplicate-rows warning, worded the same in both docs", () => {
    const warning =
      "Google's Make a copy duplicates every row in the template, so delete any rows below the header before you connect it.";
    assert.equal(setup().split(warning).length - 1, 1);
    assert.equal(readme().split(warning).length - 1, 1);
    assert.equal(/duplicates \*\*every row/.test(setup() + readme()), false);
  });

  it("G19: the maintainer note lives in CONTRIBUTING.md, not the user path", () => {
    assert.equal(/Maintainers:/.test(setup()), false);
    assert.match(readRepoFile("CONTRIBUTING.md"), /header-only/);
  });

  it("G20: Create new and Connect existing are separate bullets", () => {
    for (const doc of [setup(), readme()]) {
      assert.match(doc, /^- \*\*Create new \(recommended\):\*\*/m);
      assert.match(doc, /^- \*\*Connect existing:\*\*/m);
    }
  });

  it("G22: says where the sign-in and the Client ID are kept", () => {
    assert.ok(
      setup().includes(
        "Your sign-in lasts for this tab only; your\nClient ID and Sheet link are saved in this browser",
      ),
    );
  });
});

describe("B2-8 · N-B3-5 · adjacent SETUP.md rows", () => {
  it("B2-8: the AI Studio link goes straight to the key page", () => {
    const links = [...setup().matchAll(/https:\/\/aistudio\.google\.com[^\s)]*/g)].map((m) => m[0]);
    assert.ok(links.length > 0);
    for (const link of links) assert.equal(link, "https://aistudio.google.com/app/apikey");
  });

  it("N-B3-5: the first-visit paragraph describes the setup flow, not the deleted onboarding", () => {
    const doc = setup();
    assert.equal(doc.includes("Until you finish onboarding, the main UI stays behind the wizard."), false);
    assert.match(doc, /\*\*First visit:\*\* step 3 of the setup flow asks for your resume/);
  });
});

describe("D8 · Get JobBored in the docs", () => {
  it("SETUP.md describes the Mac download and the copy-command path", () => {
    const doc = setup();
    assert.ok(doc.includes("## Get JobBored"));
    assert.ok(doc.includes("https://github.com/emilio3435/jobbored-desktop/releases/latest"));
    assert.ok(
      doc.includes(
        "git clone https://github.com/emilio3435/Job-Bored.git && cd Job-Bored && ./start.sh",
      ),
    );
  });
});

describe("X4 · the voice sheet", () => {
  it("docs/COPY.md names one term per concept", () => {
    const copy = readRepoFile("docs/COPY.md");
    assert.match(copy, /\*\*Client ID\*\*/);
    assert.match(copy, /\*\*JobBored on this computer\*\*/);
    assert.match(copy, /double-click start\.command/);
    assert.match(copy, /Open the JobBored app/);
    assert.match(copy, /at most one light metaphor per beat/i);
  });
});
