/**
 * Tests for server/materials-request.mjs — the bridge that spawns
 * the Hermes materials-request shell wrapper from a POST request.
 *
 * Covers:
 *   - request body validation (slug, feature, company, title)
 *   - args forwarded to the script as argv (no shell interpolation)
 *   - JSON output parsed and returned
 *   - non-zero exit codes mapped to HTTP-tagged errors
 *   - notes capped to a reasonable size
 */

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { mkdtemp, rm, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  normalizeRequestBody,
  spawnMaterialsRequest,
  getMaterialsRequestBin,
} from "../server/materials-request.mjs";

let stubDir;
let okBin;
let echoBin;
let failBin;
let telegramFailBin;
let invalidBin;

async function writeStubBin(path, body) {
  await writeFile(path, body);
  await chmod(path, 0o755);
}

before(async () => {
  stubDir = await mkdtemp(join(tmpdir(), "jb-mats-req-"));

  /* okBin: prints JSON, exits 0 */
  okBin = join(stubDir, "ok.sh");
  await writeStubBin(okBin, `#!/usr/bin/env bash
echo '{"ok": true, "slug": "test-slug", "telegram_message_id": 42, "pending_path": "/tmp/x", "requested_at": "2026-05-27T20:00:00Z"}'
exit 0
`);

  /* echoBin: writes its argv to a sidecar file so we can assert the
     exact arguments the server passes, then prints JSON OK. */
  echoBin = join(stubDir, "echo.sh");
  await writeStubBin(echoBin, `#!/usr/bin/env bash
echo "$@" > "${stubDir}/echo-args.txt"
echo '{"ok": true, "slug": "echo-slug"}'
exit 0
`);

  /* failBin: bad input (exit 1) */
  failBin = join(stubDir, "fail.sh");
  await writeStubBin(failBin, `#!/usr/bin/env bash
echo '{"ok": false, "error": "bad input"}' >&2
exit 1
`);

  /* telegramFailBin: pending written but telegram failed (exit 2) */
  telegramFailBin = join(stubDir, "tg-fail.sh");
  await writeStubBin(telegramFailBin, `#!/usr/bin/env bash
echo '{"ok": false, "slug": "x", "pending_path": "/tmp/x/pending.json", "telegram_message_id": null, "telegram_error": "HTTP 401"}'
exit 2
`);

  /* invalidBin: garbage output, non-zero exit */
  invalidBin = join(stubDir, "invalid.sh");
  await writeStubBin(invalidBin, `#!/usr/bin/env bash
echo "not json at all"
exit 1
`);
});

after(async () => {
  if (stubDir) await rm(stubDir, { recursive: true, force: true });
});

describe("normalizeRequestBody", () => {
  const valid = {
    slug: "chartis-senior-digital-marketing-consultant",
    company: "Chartis",
    title: "Senior Digital Marketing Consultant",
    feature: "cover_letter",
    jobUrl: "https://example.com/jobs/1",
    notes: "Tighten the opening paragraph.",
  };

  it("accepts a fully-formed body", () => {
    const out = normalizeRequestBody(valid);
    assert.deepEqual(out, valid);
  });

  it("rejects invalid slugs", () => {
    assert.throws(
      () => normalizeRequestBody({ ...valid, slug: "../etc/passwd" }),
      (e) => e.statusCode === 400 && /slug/i.test(e.message),
    );
    assert.throws(
      () => normalizeRequestBody({ ...valid, slug: "UPPER" }),
      (e) => e.statusCode === 400,
    );
  });

  it("rejects unknown features", () => {
    assert.throws(
      () => normalizeRequestBody({ ...valid, feature: "rewrite" }),
      (e) => e.statusCode === 400 && /feature/i.test(e.message),
    );
  });

  it("requires company and title", () => {
    assert.throws(
      () => normalizeRequestBody({ ...valid, company: "" }),
      (e) => e.statusCode === 400 && /company/i.test(e.message),
    );
    assert.throws(
      () => normalizeRequestBody({ ...valid, title: "" }),
      (e) => e.statusCode === 400 && /title/i.test(e.message),
    );
  });

  it("caps notes to a reasonable maximum", () => {
    const huge = "x".repeat(50_000);
    const out = normalizeRequestBody({ ...valid, notes: huge });
    assert.ok(out.notes.length <= 4000, "notes should be capped");
  });

  it("trims whitespace and discards \\r so newlines stay consistent", () => {
    const out = normalizeRequestBody({
      ...valid,
      notes: "  line one\r\nline two  ",
    });
    assert.equal(out.notes, "line one\nline two");
  });
});

describe("getMaterialsRequestBin", () => {
  it("returns the env override when set", () => {
    const original = process.env.HERMES_MATERIALS_REQUEST_BIN;
    process.env.HERMES_MATERIALS_REQUEST_BIN = "/tmp/override.sh";
    try {
      assert.equal(getMaterialsRequestBin(), "/tmp/override.sh");
    } finally {
      if (original == null) delete process.env.HERMES_MATERIALS_REQUEST_BIN;
      else process.env.HERMES_MATERIALS_REQUEST_BIN = original;
    }
  });

  it("falls back to the bundled wrapper path", () => {
    const original = process.env.HERMES_MATERIALS_REQUEST_BIN;
    delete process.env.HERMES_MATERIALS_REQUEST_BIN;
    try {
      assert.ok(getMaterialsRequestBin().endsWith("materials-request.sh"));
    } finally {
      if (original != null) process.env.HERMES_MATERIALS_REQUEST_BIN = original;
    }
  });
});

describe("spawnMaterialsRequest", () => {
  const goodPayload = {
    slug: "test-slug",
    company: "Test Co",
    title: "Test Role",
    feature: "cover_letter",
    jobUrl: "https://example.com/jobs/1",
    notes: "A note",
  };

  it("returns the parsed JSON when the script exits 0", async () => {
    const result = await spawnMaterialsRequest(goodPayload, { bin: okBin });
    assert.equal(result.ok, true);
    assert.equal(result.slug, "test-slug");
    assert.equal(result.telegram_message_id, 42);
  });

  it("forwards exact args to the script as argv (no shell interpolation)", async () => {
    await spawnMaterialsRequest(
      {
        slug: "echo-slug",
        company: 'Test "quoted" Co',
        title: "Role; rm -rf /",
        feature: "resume",
        jobUrl: "https://x.example.com/path",
        notes: "$(whoami) is curious",
      },
      { bin: echoBin },
    );
    const args = (await readFile(join(stubDir, "echo-args.txt"), "utf8")).trim();
    /* Each value should appear verbatim. If shell interpolation had
       occurred, '$(whoami)' would have been substituted. */
    assert.match(args, /--slug echo-slug/);
    assert.match(args, /--feature resume/);
    assert.match(args, /\$\(whoami\) is curious/);
    assert.match(args, /Role; rm -rf \//);
  });

  it("maps exit code 1 to a 400 error", async () => {
    await assert.rejects(
      () => spawnMaterialsRequest(goodPayload, { bin: failBin }),
      (e) => e.statusCode === 400 && /bad input/.test(e.message),
    );
  });

  it("maps exit code 2 (Telegram failed) to 502 with the body attached", async () => {
    await assert.rejects(
      () => spawnMaterialsRequest(goodPayload, { bin: telegramFailBin }),
      (e) => e.statusCode === 502
        && /HTTP 401/.test(e.message)
        && e.body && e.body.slug === "x",
    );
  });

  it("falls back to stderr/exit-code message when stdout is not JSON", async () => {
    /* invalidBin prints non-JSON to stdout and exits 1 (validation
       failure semantics). The bridge maps exit 1 → 400 even when the
       JSON parse fails, and surfaces a generic error message. */
    await assert.rejects(
      () => spawnMaterialsRequest(goodPayload, { bin: invalidBin }),
      (e) => e.statusCode === 400 && /exited 1/.test(e.message),
    );
  });

  it("forwards --no-telegram when skipTelegram is true", async () => {
    await spawnMaterialsRequest(
      goodPayload,
      { bin: echoBin, skipTelegram: true, applicationsRoot: "/tmp/xyz" },
    );
    const args = (await readFile(join(stubDir, "echo-args.txt"), "utf8")).trim();
    assert.match(args, /--no-telegram/);
    assert.match(args, /--applications-root \/tmp\/xyz/);
  });
});

describe("end-to-end against the real Hermes wrapper", () => {
  /* Smoke test that the real materials-request.sh wrapper still works
     end-to-end (writes pending.json without contacting Telegram). */
  it("writes pending.json via the real wrapper with --no-telegram", async () => {
    const realBin = getMaterialsRequestBin();
    if (!existsSync(realBin)) return; // bundled wrapper missing on this checkout
    const root = await mkdtemp(join(tmpdir(), "jb-mats-e2e-"));
    try {
      const out = await spawnMaterialsRequest(
        {
          slug: "smoke-test-role",
          company: "Smoke Co",
          title: "Smoke Engineer",
          feature: "cover_letter",
          jobUrl: "",
          notes: "Real wrapper smoke",
        },
        { bin: realBin, skipTelegram: true, applicationsRoot: root },
      );
      assert.equal(out.ok, true);
      const pending = JSON.parse(
        await readFile(join(root, "smoke-test-role", "pending.json"), "utf8"),
      );
      assert.equal(pending.feature, "cover_letter");
      assert.equal(pending.company, "Smoke Co");
      assert.equal(pending.source, "jobbored-dossier");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
