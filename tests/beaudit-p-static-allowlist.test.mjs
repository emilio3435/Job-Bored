/**
 * BEAUDIT G3 — static serving is an allowlist, not a denylist over the repo.
 * Before the fix gitignored local artifacts (tmp/*.log, docs/redesign/logs,
 * uploads/, profile zips) and server source were served with 200.
 * Promoted from probes/G/g-static-traversal.sh.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { isServableRelativePath, resolvePublicFile } from "../scripts/lib/static-path-guard.mjs";

const SERVED = [
  "index.html",
  "app.js",
  "style.css",
  "jobbored.svg",
  "css/tokens.css",
  "assets/chrome/mascot.webp",
  "partials/header.html",
  "vendor/fonts/fonts.css",
  "lib/ats-score.js",
  "fixtures/demo-pipeline.json",
  "schemas/pipeline-row.v1.json",
  "docs/SELF-HOSTING.md",
  "integrations/apps-script/Code.gs",
  "integrations/browser-use-discovery/README.md",
  // The lone server/ exception: B3's serverless fallback loads it as a
  // classic script. Named one by one — the rest of server/ stays dark.
  "server/profile-draft-shared.js",
];

const REFUSED = [
  "tmp/jobbored-dev.log",
  "tmp/reauth-google-token.py",
  "docs/redesign/logs/fe-dashboard.log",
  "uploads/logo.png",
  "integrations/hermes-job-hunt/profile/export.zip",
  "integrations/hermes-job-hunt/resume-template/uploads/me.png",
  "dev-server.mjs",
  "server/index.mjs",
  "server/profile-from-resume.mjs",
  "scripts/lib/static-path-guard.mjs",
  "start.sh",
  "redact_secrets.py",
  "package.json",
  "evidence/run.txt",
  "brief-mockup.html",
];

describe("BEAUDIT G3 — static allowlist", () => {
  it("names the dashboard's public files as servable and nothing else", () => {
    for (const rel of SERVED) assert.equal(isServableRelativePath(rel), true, `${rel} should be served`);
    for (const rel of REFUSED) assert.equal(isServableRelativePath(rel), false, `${rel} must not be served`);
  });

  it("resolvePublicFile refuses gitignored artifacts that exist on disk", async () => {
    const root = mkdtempSync(join(tmpdir(), "beaudit-p-g3-"));
    try {
      for (const rel of [...SERVED, ...REFUSED]) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), "x\n");
      }
      for (const rel of REFUSED) {
        const result = await resolvePublicFile(`/${rel}`, { root });
        assert.equal(result.ok, false, `${rel} must not be served`);
        assert.ok(result.status === 403 || result.status === 404, `${rel}: ${result.status}`);
      }
      for (const rel of SERVED) {
        const result = await resolvePublicFile(`/${rel}`, { root });
        assert.equal(result.ok, true, `${rel} should be served`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("BEAUDIT G3 repair — the public contract document stays servable", () => {
  it("serves AGENT_CONTRACT.md (the discovery drawer links it) and no other root .md", () => {
    assert.equal(isServableRelativePath("AGENT_CONTRACT.md"), true);
    assert.equal(isServableRelativePath("AGENTS.md"), false);
    assert.equal(isServableRelativePath("CLAUDE.md"), false);
  });
});
