import assert from "node:assert/strict";
import test from "node:test";

import { computeListingFingerprintKey } from "../../src/discovery/listing-fingerprint.ts";
import {
  applyDeclaredFrontierSignals,
  recallFingerprintMemory,
} from "../../src/browser/providers/frontier-memory.ts";

test("F4A-P2-MEM: declared frontier signals affect selection", () => {
  const baseline = applyDeclaredFrontierSignals({
    baseScore: 50,
    signals: {},
  });
  const boosted = applyDeclaredFrontierSignals({
    baseScore: 50,
    signals: {
      verifiedSurface: true,
      presetAligned: true,
      priorAcceptedYield: 90,
    },
  });
  const penalized = applyDeclaredFrontierSignals({
    baseScore: 50,
    signals: {
      recentCoveragePenalty: 80,
      cooldownPenalty: 40,
    },
  });

  assert.ok(
    boosted.score > baseline.score,
    "Verified surface, preset alignment, and prior yield must raise the score",
  );
  assert.ok(
    penalized.score < baseline.score,
    "Coverage and cooldown penalties must lower the score",
  );
  assert.ok(boosted.attribution.includes("verified_surface"));
  assert.ok(boosted.attribution.includes("preset_aligned"));
  assert.ok(boosted.attribution.some((entry) => entry.startsWith("yield:")));
  assert.ok(penalized.attribution.some((entry) => entry.startsWith("coverage:")));
  assert.ok(penalized.attribution.some((entry) => entry.startsWith("cooldown:")));
});

test("F4A-P2-MEM: cross-run fingerprint memory is observable from a fixture", () => {
  const listing = {
    sourceId: "greenhouse",
    title: "Backend Engineer",
    company: "Acme AI",
    location: "Remote",
    url: "https://boards.greenhouse.io/acme-ai/jobs/1",
  };
  const fingerprintKey = computeListingFingerprintKey(listing);
  assert.ok(fingerprintKey);

  const priorRunMemory = {
    fingerprints: [
      {
        fingerprintKey,
        sourceId: "greenhouse",
        canonicalUrl: listing.url,
        priorAcceptedYield: 88,
        seenCount: 2,
        seenAt: "2026-04-01T00:00:00.000Z",
      },
    ],
  };

  const recalled = recallFingerprintMemory(priorRunMemory, listing);
  assert.ok(recalled, "A later run must recall the prior fingerprint");
  assert.equal(recalled?.fingerprintKey, fingerprintKey);
  assert.equal(recalled?.sourceId, "greenhouse");
  assert.equal(recalled?.priorAcceptedYield, 88);
  assert.equal(recalled?.seenCount, 2);

  const scored = applyDeclaredFrontierSignals({
    baseScore: 40,
    signals: {
      fingerprintRecall: recalled,
    },
  });
  assert.ok(scored.score > 40);
  assert.ok(scored.attribution.includes("fingerprint_memory"));
});
