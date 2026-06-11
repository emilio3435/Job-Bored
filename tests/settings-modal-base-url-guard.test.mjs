/**
 * Pins the settings-modal.js write-time baseUrl guard.
 *
 * Defence in depth: resume-generate's assertSafeBaseUrl stops the bad
 * request, but a leaked Bearer key in localStorage is still a bad
 * footprint. writeFormToConfig refuses to persist a baseUrl that the
 * runtime guard would reject — the user sees a Settings error toast
 * and the bad value never lands.
 *
 * Source-shape pin: the writeFormToConfig flow runs against a real DOM
 * + Tabs system + host() bridge we don't have here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const settingsModalJs = readFileSync(
  join(repoRoot, "settings-modal.js"),
  "utf8",
);

describe("settings-modal write-time baseUrl guard", () => {
  it("calls the resume-generate guard before persisting the payload", () => {
    // The guard MUST run between payload construction and the
    // mergeStoredConfigOverridePatch call. Otherwise a rejected save
    // still writes localStorage.
    const writeFn = settingsModalJs.indexOf("mergeStoredConfigOverridePatch(payload)");
    assert.ok(writeFn > -1, "could not locate the mergeStoredConfigOverridePatch(payload) call");
    const guardCall = settingsModalJs.indexOf("CommandCenterResumeBaseUrlGuard");
    assert.ok(guardCall > -1, "expected settings-modal.js to reference CommandCenterResumeBaseUrlGuard");
    assert.ok(
      guardCall < writeFn,
      "the baseUrl guard must run BEFORE mergeStoredConfigOverridePatch (otherwise rejected values still persist)",
    );
  });

  it("checks both resumeOpenRouterBaseUrl and resumeLocalBaseUrl form fields", () => {
    assert.match(
      settingsModalJs,
      /settingsResumeOpenRouterBaseUrl/,
      "expected the openrouter base url field to be validated",
    );
    assert.match(
      settingsModalJs,
      /settingsResumeLocalBaseUrl/,
      "expected the local base url field to be validated",
    );
  });

  it("aborts save (returns) when the guard throws", () => {
    // Spot-check: the guarded block contains a `return;` inside the
    // catch path so writeFormToConfig stops before the merge call.
    const region = settingsModalJs.match(
      /CommandCenterResumeBaseUrlGuard[\s\S]{0,1500}return;/,
    );
    assert.ok(
      region,
      "expected the baseUrl guard catch path to `return;` (abort save) before the merge",
    );
  });

  it("surfaces a user-visible toast on guard rejection", () => {
    // Failing silently is what 'security warning fatigue' looks like —
    // the user needs to know which field tripped the check. showToast
    // with "error" must be reachable from the rejection path.
    const region = settingsModalJs.match(
      /CommandCenterResumeBaseUrlGuard[\s\S]{0,1500}showToast\([^)]*"error"/,
    );
    assert.ok(
      region,
      "expected showToast(..., 'error') in the baseUrl guard rejection path",
    );
  });
});
