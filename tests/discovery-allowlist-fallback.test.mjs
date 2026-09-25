import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/* ============================================================
   A dashboard company allowlist is a preference, not a catalog reference.

   The worker resolves companyAllowlist against a catalog built ONLY from
   the stored worker config (companies + history + ATS seeds). A local
   install ships that list empty, so every name the AI Suggester proposes
   is "unknown" and the run fails closed:

     400 companyAllowlist did not match the configured company catalog.
     Unknown companyAllowlist entries: The Trade Desk, LiveRamp, HubSpot…

   The contract's own escape hatch is `allowUnrestrictedFallback` — "when
   true AND a per-run companyAllowlist matches zero catalog entries, the
   run may fall back to unrestricted stored-company search" — and no
   dashboard path ever set it. Nothing the dashboard sends is drawn from a
   curated catalog, so the dashboard opts in whenever it sends a list.
   Fail-closed stays the default for API callers that omit the field.
   ============================================================ */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const payloadJs = readFileSync(join(repoRoot, "discovery-payload.js"), "utf8");

function loadPayloadBuilder() {
  const window = {};
  const ctx = vm.createContext({ window, globalThis: window, console });
  vm.runInContext(payloadJs, ctx, { filename: "discovery-payload.js" });
  return window.JobBoredDiscoveryPayload;
}

function build(profileExtra, sourceExtra = {}) {
  return loadPayloadBuilder().buildDiscoveryWebhookPayload({
    sheetId: "SHEET_1",
    requestedAt: "2026-09-02T16:00:00.000Z",
    variationKey: "v-1",
    trigger: "onboarding_payoff",
    discoveryProfile: {
      targetRoles: "Director of Integrated Marketing",
      ...profileExtra,
    },
    ...sourceExtra,
  });
}

const COMPANIES = ["The Trade Desk", "LiveRamp", "HubSpot"];

describe("buildDiscoveryWebhookPayload — an allowlist ships with its escape hatch", () => {
  it("sets allowUnrestrictedFallback when it sends a companyAllowlist", () => {
    const payload = build({ companyAllowlist: COMPANIES });
    assert.deepEqual([...payload.companyAllowlist], COMPANIES);
    assert.equal(
      payload.allowUnrestrictedFallback,
      true,
      "without this the worker 400s on any install with an empty company catalog",
    );
  });

  it("omits the flag when there is no allowlist to resolve", () => {
    const payload = build({});
    assert.equal("companyAllowlist" in payload, false);
    assert.equal(
      "allowUnrestrictedFallback" in payload,
      false,
      "an unrestricted run has nothing to fall back from",
    );
  });

  it("honours an explicit opt-out — a caller that wants fail-closed keeps it", () => {
    const payload = build(
      { companyAllowlist: COMPANIES },
      { allowUnrestrictedFallback: false },
    );
    assert.deepEqual([...payload.companyAllowlist], COMPANIES);
    assert.equal(payload.allowUnrestrictedFallback, false);
  });

  it("a blocklist alone does not opt into the fallback", () => {
    const payload = build({ companyBlocklist: ["Meta"] });
    assert.deepEqual([...payload.companyBlocklist], ["Meta"]);
    assert.equal("allowUnrestrictedFallback" in payload, false);
  });
});
