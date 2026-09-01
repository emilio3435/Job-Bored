/**
 * critical-journey.spec.mjs — JobBored's core user promise in a real browser.
 *
 * The static app and its production browser scripts run unchanged. Every
 * off-origin edge is intercepted by the hermetic fixture harness; an
 * unrecognized external request is aborted and fails the owning test.
 * config.js is never written into the checkout.
 *
 * Two journeys live here:
 *   · the stranger's — screen S0 and the one-flow's entry/escape/resume
 *     contract (ONE-FLOW-ONBOARDING-SPEC §4, §3.4, §3.5, §5 B1);
 *   · the set-up user's — discovery run → pipeline → dossier materials.
 *
 * Copy asserted verbatim below is NORMATIVE (spec §4/§5, ground rules §8):
 * these strings ship exactly as written, so drifting one is a failure, not
 * a test that needs loosening.
 */

import { test, expect } from "@playwright/test";
import {
  DISPOSABLE_AUTH,
  HERMETIC_RUN_ID,
  installHermeticNetworkFence,
  stageSignedInDisposableAuth,
  startHermeticApp,
} from "../e2e-fixtures/hermetic-harness.mjs";

const RUN_ID = HERMETIC_RUN_ID;

/** Screen S0's overlay root (oneflow-demo-board.js ROOT_ID). */
const DEMO_BOARD = "#oneFlowDemoBoard";
/** The single shell mount every beat renders into (spec §3.5). */
const FLOW_MOUNT = "#oneFlowMount";

/** Spec §4 — the invitation card, verbatim. */
const INVITE = {
  headline: "This is your job hunt on autopilot.",
  body:
    "Set it up once — about fifteen focused minutes — and roles scored against your fit land here every morning.",
  privacy:
    "Your resume and pipeline stay in your Google Sheet and on this machine.",
  primary: "Make it mine — 15 min, once",
  secondary: "Poke around first",
  pill: "Set up JobBored — 15 min ▸",
};

/** Spec §5 B1 — the first beat's headline and sub, verbatim. */
const BEAT_ONE = {
  headline: "Your pipeline lives in a Google Sheet you own.",
  sub:
    "Sign in and we'll create it for you. Nothing is stored on our side — there is no 'our side.'",
};

/** Spec §3.5.1 — the six spine segments, in order. */
const SPINE_LABELS = ["Google", "AI", "Resume", "Your fit", "Discovery", "Done"];

let app = null;

test.beforeAll(async () => {
  app = await startHermeticApp();
});

test.afterAll(async () => {
  if (app) await app.close();
});

/**
 * A brand-new clone's first load: no sheet, no keys, no completion flags.
 * `?greenfield=1` neutralizes config.js and drops the user-content store,
 * so this is the same cold start §4 is written about.
 */
async function bootColdStart(page, fence) {
  await page.goto(`${app.baseUrl}/?greenfield=1`, { waitUntil: "load" });
  await expect(page.locator(DEMO_BOARD)).toBeVisible();
  expect(
    fence.unexpectedExternal,
    "cold start must not escape the explicit network fence",
  ).toEqual([]);
}

async function bootSignedIn(page, fence) {
  await stageSignedInDisposableAuth(page, DISPOSABLE_AUTH);
  await page.goto(`${app.baseUrl}/?jb-v2=1`, { waitUntil: "load" });

  // Seed the two user-owned IndexedDB completion flags through the public
  // browser API, then reload so the signed-in journey is not covered by a
  // first-run overlay. This changes test context state only.
  await page.evaluate(async () => {
    await globalThis.CommandCenterUserContent.completeInfraSetup();
    await globalThis.CommandCenterUserContent.completeOnboarding();
  });
  await page.reload({ waitUntil: "load" });

  await expect(page.locator("#dashboard")).toBeVisible();
  await expect(page.locator("#sheetAccessGateScreen")).toBeHidden();
  await expect(page.locator("#authUser")).toBeVisible();
  expect(
    fence.unexpectedExternal,
    "signed-in boot must not escape the explicit network fence",
  ).toEqual([]);
}

async function openDiscoveryAndRun(page) {
  await page.locator("#discoveryBtn").click();
  const drawer = page.locator("#discoveryDrawer");
  await expect(drawer).toBeVisible();
  await drawer.locator("#dpTargetRoles").fill("Platform Engineer");
  await drawer.locator("#discoveryPrefsRun").click();
  await expect(drawer).toBeHidden();
}

/** The beat currently rendered in the shell, or "" when it is closed. */
function renderedBeatId(page) {
  return page
    .locator(`${FLOW_MOUNT} .oneflow-beat`)
    .getAttribute("data-beat-id");
}

test("should open a zero-config visit on the demo board, not a credential ask", async ({
  page,
}) => {
  // spec §4 + §2.1 "give before you ask": the credential-first opening this
  // replaces demanded a Client ID before showing anything at all. What must
  // hold now is that a stranger sees the PRODUCT — scored, watermarked demo
  // cards — with the login gate nowhere on screen.
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await bootColdStart(page, fence);

  await expect(page.locator("#sheetAccessGateScreen")).toBeHidden();
  await expect(page.locator("#dashboard")).toBeHidden();
  await expect(page.locator(FLOW_MOUNT)).toBeHidden();

  const cards = page.locator(`${DEMO_BOARD} .oneflow-demo__card`);
  expect(await cards.count(), "the fixture board should render rows").toBeGreaterThan(0);
  await expect(cards.first().locator(".oneflow-demo__chip")).toHaveText("DEMO");

  const invite = page.locator(".oneflow-demo__invite");
  await expect(invite.locator(".oneflow-demo__invite-headline")).toHaveText(
    INVITE.headline,
  );
  await expect(invite.locator(".oneflow-demo__invite-body")).toHaveText(INVITE.body);
  await expect(invite.locator(".oneflow-demo__invite-privacy")).toHaveText(
    INVITE.privacy,
  );
  await expect(
    invite.getByRole("button", { name: INVITE.primary, exact: true }),
  ).toBeVisible();
  await expect(
    invite.getByRole("button", { name: INVITE.secondary, exact: true }),
  ).toBeVisible();

  expect(fence.unexpectedExternal).toEqual([]);
});

test("should collapse the invitation to a corner pill that still opens the flow", async ({
  page,
}) => {
  // spec §4: "Poke around first" is an escape from the ask, never from the
  // deal — the pill has to survive as a live re-entry point, otherwise a
  // visitor who looks around first can never start.
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await bootColdStart(page, fence);

  await page
    .getByRole("button", { name: INVITE.secondary, exact: true })
    .click();

  await expect(page.locator(".oneflow-demo__invite")).toHaveCount(0);
  const pill = page.locator(".oneflow-demo__pill");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveText(INVITE.pill);
  // The board itself stays — collapsing the ask must not take the product
  // with it.
  await expect(page.locator(`${DEMO_BOARD} .oneflow-demo__card`).first()).toBeVisible();

  await pill.click();
  await expect(page.locator(`${FLOW_MOUNT} .oneflow-beat`)).toBeVisible();
  expect(await renderedBeatId(page)).toBe("google");

  expect(fence.unexpectedExternal).toEqual([]);
});

test("should enter the one shell at beat 1 with the six-beat spine when the visitor accepts", async ({
  page,
}) => {
  // spec §3.4 entry + §3.5 chassis + §5 B1 copy. One shell, one progress
  // system: the four competing progress systems the teardown found are the
  // reason the spine is asserted here segment by segment.
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await bootColdStart(page, fence);

  await page.getByRole("button", { name: INVITE.primary, exact: true }).click();

  const mount = page.locator(FLOW_MOUNT);
  await expect(mount).toBeVisible();
  await expect(mount.locator(".oneflow-beat")).toBeVisible();
  expect(await renderedBeatId(page)).toBe("google");

  await expect(mount.locator(".discovery-setup-wizard__step-title")).toHaveText(
    BEAT_ONE.headline,
  );
  await expect(mount.locator(".discovery-setup-wizard__step-lede")).toHaveText(
    BEAT_ONE.sub,
  );
  await expect(
    mount.getByRole("button", { name: "Continue with Google", exact: true }),
  ).toBeVisible();

  const spine = mount.locator(".discovery-setup-wizard__spine");
  await expect(spine.locator(".discovery-setup-wizard__spine-label")).toHaveText(
    SPINE_LABELS,
  );
  await expect(
    spine.locator(".discovery-setup-wizard__spine-step--current"),
  ).toHaveAttribute("data-beat-id", "google");
  await expect(mount.locator(".discovery-setup-wizard__spine-time")).toHaveText(
    "about 15 min left",
  );

  // The board stays mounted behind the shell: closing must land somewhere.
  await expect(page.locator(DEMO_BOARD)).toBeVisible();
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should treat closing the flow as pausing — Esc returns to the board and re-entry resumes the saved beat", async ({
  page,
}) => {
  // spec §3.4: "Closing is pausing, never skipping", and reopening lands on
  // onboardingFlowState.beat with drafts restored. The regression this pins
  // is the one the teardown found across six wizards — an escape that threw
  // the visitor back to the start of the chain.
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await bootColdStart(page, fence);

  await page.getByRole("button", { name: INVITE.primary, exact: true }).click();
  await expect(page.locator(`${FLOW_MOUNT} .oneflow-beat`)).toBeVisible();

  // Advance past B1 through the controller: completing beat 1 for real needs
  // a live Google OAuth grant, which the hermetic fence deliberately refuses.
  // The claim under test is the state machine's, not B1's.
  await page.evaluate(() => globalThis.JobBoredOneFlow.goToBeat("fit"));
  await expect(page.locator(`${FLOW_MOUNT} .oneflow-beat`)).toHaveAttribute(
    "data-beat-id",
    "fit",
  );

  await page.keyboard.press("Escape");
  await expect(page.locator(FLOW_MOUNT)).toBeHidden();
  await expect(page.locator(DEMO_BOARD)).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.JobBoredOneFlow.getState().beat),
    "closing must leave the saved beat intact",
  ).toBe("fit");
  expect(
    await page.evaluate(() => globalThis.JobBoredOneFlow.getState().completedBeats),
    "closing must not mark the paused beat complete",
  ).toEqual([]);

  // A full reload, without the greenfield reset: this is the refresh a real
  // visitor does mid-flow, and §3.4 says it resumes.
  await page.goto(`${app.baseUrl}/`, { waitUntil: "load" });
  await expect(page.locator(DEMO_BOARD)).toBeVisible();
  await page.getByRole("button", { name: INVITE.primary, exact: true }).click();

  await expect(page.locator(`${FLOW_MOUNT} .oneflow-beat`)).toHaveAttribute(
    "data-beat-id",
    "fit",
  );
  await expect(
    page.locator(`${FLOW_MOUNT} .discovery-setup-wizard__spine-step--current`),
  ).toHaveAttribute("data-beat-id", "fit");

  expect(fence.unexpectedExternal).toEqual([]);
});

test("should never show the one-flow to a user who already finished setup", async ({
  page,
}) => {
  // spec §3.3: legacy completion flags migrate forward, so an existing user
  // is never re-onboarded. The dashboard is the whole surface — no demo
  // board over it, no shell, no credential gate.
  const fence = await installHermeticNetworkFence(page, { baseUrl: app.baseUrl });
  await bootSignedIn(page, fence);

  await expect(page.locator('[data-region="pipeline"]')).toBeVisible();
  await expect(page.locator(DEMO_BOARD)).toHaveCount(0);
  await expect(page.locator(FLOW_MOUNT)).toBeHidden();
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should show queued, running, and partial discovery outcomes", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, {
    baseUrl: app.baseUrl,
    runId: RUN_ID,
    statusResponses: [
      {
        runId: RUN_ID,
        status: "running",
        terminal: false,
        message: "Scanning direct company sources.",
        lifecycle: { companyCount: 2 },
        writeResult: { appended: 0, updated: 0 },
      },
      {
        runId: RUN_ID,
        status: "partial",
        terminal: true,
        error: "One source timed out",
        message: "Completed with one unavailable source.",
        lifecycle: { companyCount: 3 },
        writeResult: { appended: 1, updated: 0 },
      },
    ],
  });
  await bootSignedIn(page, fence);
  await openDiscoveryAndRun(page);

  const discoveryButton = page.locator("#discoveryBtn");
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /accepted — checking status/,
  );

  await page.getByRole("button", { name: "Open discovery run history" }).click();
  const runsDialog = page.getByRole("dialog", { name: "Discovery runs" });
  await expect(runsDialog).toBeVisible();

  fence.releaseStatus(0);
  await expect(
    runsDialog.locator('[data-runs-live="job-discovery"]'),
  ).toContainText("Running");
  await runsDialog.getByRole("button", { name: "Close" }).click();

  fence.releaseStatus(1);
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /Discovery finished with partial results.*One source timed out/,
  );
  expect(fence.unexpectedExternal).toEqual([]);
});

test("should carry completed discovery into the pipeline and ready dossier materials", async ({
  page,
}) => {
  const fence = await installHermeticNetworkFence(page, {
    baseUrl: app.baseUrl,
    runId: RUN_ID,
    statusResponses: [
      {
        runId: RUN_ID,
        status: "running",
        terminal: false,
        message: "Scoring matching roles.",
        lifecycle: { companyCount: 2 },
        writeResult: { appended: 0, updated: 0 },
      },
      {
        runId: RUN_ID,
        status: "completed",
        terminal: true,
        message: "Discovery completed.",
        completedAt: "2026-08-30T14:30:00.000Z",
        lifecycle: { companyCount: 3 },
        writeResult: { appended: 1, updated: 0 },
      },
    ],
  });
  await bootSignedIn(page, fence);
  await expect(page.locator(".pipe-sticker")).toHaveCount(0);

  await openDiscoveryAndRun(page);
  const discoveryButton = page.locator("#discoveryBtn");
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /accepted — checking status/,
  );

  fence.releaseStatus(0);
  fence.releaseStatus(1);
  await expect(discoveryButton).toHaveAttribute(
    "aria-label",
    /Discovery complete/,
  );

  const discoveredColumn = page.getByRole("region", {
    name: "Discovered column",
  });
  await expect(discoveredColumn).toContainText("Discovered 1");
  await discoveredColumn.getByRole("button", { name: "Expand Discovered" }).click();

  const discoveredJob = page.locator(".pipe-sticker", {
    hasText: "Platform Engineer",
  });
  await expect(discoveredJob).toContainText("Acme");
  await expect(discoveredJob).toBeVisible();
  await discoveredJob.click();

  const dossier = page.locator('[data-region="role"]');
  await expect(
    dossier.getByRole("button", { name: "Draft a cover letter for this role" }),
  ).toBeVisible();
  await dossier
    .getByRole("button", { name: "Draft a cover letter for this role" })
    .click();

  const notesForm = dossier.getByRole("form", {
    name: "Notes for the cover letter",
  });
  await expect(notesForm).toBeVisible();
  await notesForm
    .getByRole("textbox")
    .fill("Emphasize reliable platforms and developer experience.");
  await notesForm.getByRole("button", { name: "Start draft" }).click();

  await expect(dossier.getByText("WAITING IN QUEUE", { exact: true })).toBeVisible();
  await expect(dossier.getByText("Queued for the drafting worker.")).toBeVisible();

  fence.releaseMaterialsReady();
  const materialsSection = dossier.locator(".brief-materials");
  await expect(
    materialsSection.getByText("Cover Letter", { exact: true }),
  ).toBeVisible();
  await expect(materialsSection.getByText("Ready", { exact: true })).toBeVisible();
  await expect(materialsSection.getByRole("link", { name: "Preview" })).toBeVisible();
  await expect(materialsSection.locator(".brief-materials__progress")).toHaveCount(0);

  expect(fence.unexpectedExternal).toEqual([]);
});
