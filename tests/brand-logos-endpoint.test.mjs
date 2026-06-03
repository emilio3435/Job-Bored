/**
 * E2E coverage for the brand logo API surface.
 *
 * The server runs against a temp resume-template root and a stub Python
 * resolver, so these tests never touch ~/.hermes and never fetch favicons.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PNG_HEX =
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
  "890000000a49444154789c6300010000050001a5f645400000000049454e44ae426082";
const TINY_PNG = Buffer.from(PNG_HEX, "hex");

const PORT = 38520 + Math.floor(Math.random() * 100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let tmpDir = "";
let templateRoot = "";
let profilePath = "";
let resolverScript = "";
let serverProcess = null;

function writeResolverStub(path) {
  writeFileSync(
    path,
    `#!/usr/bin/env python3
import argparse, json
from pathlib import Path

PNG = bytes.fromhex("${PNG_HEX}")
parser = argparse.ArgumentParser()
parser.add_argument("--template-dir", required=True)
parser.add_argument("--force", action="store_true")
args = parser.parse_args()
root = Path(args.template_dir)
manifest = json.loads((root / "logos.json").read_text())
(root / "assets").mkdir(parents=True, exist_ok=True)
for item in manifest.get("logos", []):
    slug = item["slug"]
    upload = item.get("upload")
    target = root / "assets" / f"logo-{slug}.png"
    if upload and (root / upload).is_file():
        target.write_bytes((root / upload).read_bytes())
        print(f"  ↑ {slug:<14} upload    {upload}")
    else:
        target.write_bytes(PNG)
        print(f"  ✎ {slug:<14} monogram  stub")
print(f"\\n{len(manifest.get('logos', []))} marks: stub")
`,
    "utf8",
  );
  chmodSync(path, 0o755);
}

function multipartBody(filename, contentType, buffer) {
  const boundary = "jb-brand-logo-test-boundary";
  return {
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`,
      ),
      buffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    const r = await fetch(`${BASE_URL}/health`).catch(() => null);
    if (r && r.ok) return;
    await sleep(200);
  }
  throw new Error("brand logos test server failed to start");
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "jb-brand-logos-"));
  templateRoot = join(tmpDir, "resume-template");
  profilePath = join(tmpDir, "profile.json");
  resolverScript = join(tmpDir, "resolver-stub.py");
  mkdirSync(join(templateRoot, "assets"), { recursive: true });
  mkdirSync(join(templateRoot, "uploads"), { recursive: true });
  writeFileSync(join(templateRoot, "logos.json"), JSON.stringify({ logos: [] }, null, 2));
  writeResolverStub(resolverScript);

  serverProcess = spawn("node", ["index.mjs"], {
    cwd: resolve("server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      LISTEN_HOST: "127.0.0.1",
      JOBBORED_PROFILE_PATH: profilePath,
      HERMES_RESUME_TEMPLATE_DIR: templateRoot,
      HERMES_LOGO_RESOLVER_SCRIPT: resolverScript,
      HOME: tmpDir,
      USERPROFILE: tmpDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test("POST /api/brand-logos/:slug accepts a real image upload and exposes it via GET", async () => {
  const upload = multipartBody("acme.png", "image/png", TINY_PNG);
  const post = await fetch(`${BASE_URL}/api/brand-logos/acme`, {
    method: "POST",
    headers: upload.headers,
    body: upload.body,
  });
  assert.equal(post.status, 200);
  const postData = await post.json();
  assert.equal(postData.ok, true);
  assert.equal(postData.slug, "acme");
  assert.ok(existsSync(join(templateRoot, "uploads", "logo-acme.png")));
  assert.ok(existsSync(join(templateRoot, "assets", "logo-acme.png")));

  const get = await fetch(`${BASE_URL}/api/brand-logos`);
  assert.equal(get.status, 200);
  const getData = await get.json();
  const acme = getData.logos.find((logo) => logo.slug === "acme");
  assert.equal(acme.source, "upload");
  assert.match(acme.mark.dataUrl, /^data:image\/png;base64,/);
});

test("POST /api/brand-logos/:slug rejects a non-image upload", async () => {
  const upload = multipartBody("bad.png", "image/png", Buffer.from("not an image"));
  const post = await fetch(`${BASE_URL}/api/brand-logos/bad`, {
    method: "POST",
    headers: upload.headers,
    body: upload.body,
  });
  assert.equal(post.status, 400);
  const data = await post.json();
  assert.match(data.error, /image/i);
});

test("POST /api/brand-logos/:slug rejects invalid slugs", async () => {
  const upload = multipartBody("acme.png", "image/png", TINY_PNG);
  const post = await fetch(`${BASE_URL}/api/brand-logos/UPPER`, {
    method: "POST",
    headers: upload.headers,
    body: upload.body,
  });
  assert.equal(post.status, 400);
  const data = await post.json();
  assert.match(data.error, /slug/i);
});

test("POST /api/brand-logos/:slug rejects unsupported file extensions", async () => {
  const upload = multipartBody("acme.txt", "image/png", TINY_PNG);
  const post = await fetch(`${BASE_URL}/api/brand-logos/acme-text`, {
    method: "POST",
    headers: upload.headers,
    body: upload.body,
  });
  assert.equal(post.status, 400);
  const data = await post.json();
  assert.match(data.error, /png, jpg, svg, or webp/i);
});

test("POST /api/brand-logos/:slug rejects multipart requests without a boundary", async () => {
  const post = await fetch(`${BASE_URL}/api/brand-logos/no-boundary`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data" },
    body: TINY_PNG,
  });
  assert.equal(post.status, 400);
  const data = await post.json();
  assert.match(data.error, /multipart/i);
});

test("POST /api/brand-logos/:slug rejects malformed multipart bodies", async () => {
  const post = await fetch(`${BASE_URL}/api/brand-logos/malformed`, {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=missing" },
    body: Buffer.from("not a multipart body"),
  });
  assert.equal(post.status, 400);
  const data = await post.json();
  assert.match(data.error, /malformed/i);
});

test("POST /api/brand-logos/:slug rejects uploads over 2 MB", async () => {
  const upload = multipartBody("large.png", "image/png", Buffer.alloc(2 * 1024 * 1024 + 1, 1));
  const post = await fetch(`${BASE_URL}/api/brand-logos/large`, {
    method: "POST",
    headers: upload.headers,
    body: upload.body,
  });
  assert.equal(post.status, 413);
  const data = await post.json();
  assert.match(data.error, /2 MB/i);
});

test("POST /api/brand-logos/:slug rejects uploads when uploads dir escapes template root", async () => {
  const uploadsDir = join(templateRoot, "uploads");
  const outsideDir = join(tmpDir, "outside-uploads");
  rmSync(uploadsDir, { recursive: true, force: true });
  mkdirSync(outsideDir, { recursive: true });
  symlinkSync(outsideDir, uploadsDir);
  try {
    const upload = multipartBody("escape.png", "image/png", TINY_PNG);
    const post = await fetch(`${BASE_URL}/api/brand-logos/escape`, {
      method: "POST",
      headers: upload.headers,
      body: upload.body,
    });
    assert.equal(post.status, 400);
    const data = await post.json();
    assert.match(data.error, /escapes/i);
    assert.equal(existsSync(join(outsideDir, "logo-escape.png")), false);
  } finally {
    rmSync(uploadsDir, { recursive: true, force: true });
    mkdirSync(uploadsDir, { recursive: true });
  }
});

test("POST /profile regenerates logos.json from experiences and projects", async () => {
  writeFileSync(
    join(templateRoot, "logos.json"),
    JSON.stringify({
      logos: [
        {
          slug: "jobbored",
          label: "Prior JobBored",
          upload: "uploads/logo-jobbored.png",
        },
      ],
    }, null, 2),
  );
  const profile = {
    version: 1,
    identity: {
      targetRoles: ["Staff Software Engineer"],
      targetSeniority: "ic_staff",
      primaryNarrative:
        "I'm a staff backend engineer focused on durable distributed systems and applied AI tooling.",
    },
    strengths: [{ name: "backend systems", rank: 1 }],
    experiences: [
      {
        slug: "audacy",
        company: "Audacy",
        title: "Digital Sales Manager",
        logoDomain: "audacy.com",
      },
    ],
    projects: [
      {
        slug: "audacy",
        name: "Duplicate Audacy",
        logoDomain: "duplicate.example",
      },
      {
        slug: "jobbored",
        name: "JobBored",
        logoDomain: "jobbored.dev",
      },
    ],
    hardConstraints: { workMode: "any" },
  };
  const post = await fetch(`${BASE_URL}/profile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  assert.equal(post.status, 200);
  const data = await post.json();
  assert.equal(data.ok, true);
  assert.equal(data.logoRefresh.ok, true);

  const manifest = JSON.parse(readFileSync(join(templateRoot, "logos.json"), "utf8"));
  assert.deepEqual(
    manifest.logos.map((entry) => ({
      slug: entry.slug,
      label: entry.label,
      domain: entry.domain,
      upload: entry.upload || "",
    })),
    [
      { slug: "audacy", label: "Audacy", domain: "audacy.com", upload: "" },
      {
        slug: "jobbored",
        label: "JobBored",
        domain: "jobbored.dev",
        upload: "uploads/logo-jobbored.png",
      },
    ],
  );
  assert.ok(existsSync(join(templateRoot, "assets", "logo-audacy.png")));
  assert.ok(existsSync(join(templateRoot, "assets", "logo-jobbored.png")));
});
