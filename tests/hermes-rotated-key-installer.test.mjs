import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = join(
  repoRoot,
  "integrations",
  "hermes-job-hunt",
  "scripts",
  "install-rotated-worker-keys.sh",
);

test("rotated worker key installer remains valid bash", () => {
  execFileSync("bash", ["-n", scriptPath], { stdio: "pipe" });
});

test("rotated worker key installer merges secrets without printing them", async () => {
  const root = mkdtempSync(join(tmpdir(), "jobbored-key-installer-"));
  const keyDir = join(root, "keys");
  const privateDir = join(keyDir, "private");
  const repoDir = join(root, "repo");
  const workerDir = join(repoDir, "integrations", "browser-use-discovery");

  await mkdir(privateDir, { recursive: true });
  await mkdir(workerDir, { recursive: true });

  const secrets = {
    webhook: "rotated-webhook-secret-abc123",
    gemini: "rotated-gemini-secret-abc123",
    serpapi: "test-serpapi-key",
  };

  writeFileSync(
    join(privateDir, "browser-use-discovery.env"),
    [
      `BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=${secrets.webhook}`,
      `BROWSER_USE_DISCOVERY_GEMINI_API_KEY=${secrets.gemini}`,
      `SERPAPI_API_KEY=${secrets.serpapi}`,
      "",
    ].join("\n"),
  );
  writeFileSync(join(privateDir, "service-account-key.json"), '{"client_email":"test@example.com"}\n');
  writeFileSync(
    join(workerDir, ".env"),
    [
      "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=old-webhook",
      "BROWSER_USE_DISCOVERY_GEMINI_API_KEY=old-gemini",
      "SERPAPI_API_KEY=old-serpapi",
      "UNCHANGED_SETTING=keep-me",
      "",
    ].join("\n"),
  );

  const output = execFileSync("bash", [scriptPath, keyDir], {
    cwd: repoRoot,
    env: {
      ...process.env,
      JOBBORED_REPO: repoDir,
    },
    encoding: "utf8",
  });

  assert.doesNotMatch(output, new RegExp(secrets.webhook));
  assert.doesNotMatch(output, new RegExp(secrets.gemini));
  assert.doesNotMatch(output, new RegExp(secrets.serpapi));
  assert.match(output, /updated BROWSER_USE_DISCOVERY_WEBHOOK_SECRET/);
  assert.match(output, /backup:/);

  const envText = await readFile(join(workerDir, ".env"), "utf8");
  assert.match(envText, new RegExp(`BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=${secrets.webhook}`));
  assert.match(envText, new RegExp(`BROWSER_USE_DISCOVERY_GEMINI_API_KEY=${secrets.gemini}`));
  assert.match(envText, new RegExp(`SERPAPI_API_KEY=${secrets.serpapi}`));
  assert.match(envText, /BROWSER_USE_DISCOVERY_GOOGLE_SERVICE_ACCOUNT_FILE=.*service-account-key\.json/);
  assert.match(envText, /UNCHANGED_SETTING=keep-me/);

  const serviceAccountText = await readFile(join(workerDir, "service-account-key.json"), "utf8");
  assert.equal(serviceAccountText, '{"client_email":"test@example.com"}\n');

  const backups = (await readdir(workerDir)).filter((entry) => entry.startsWith(".env.bak-"));
  assert.equal(backups.length, 1);
});

test("rotated worker key installer auto-detects HOME Downloads bundle", async () => {
  const root = mkdtempSync(join(tmpdir(), "jobbored-key-installer-home-"));
  const homeDir = join(root, "home");
  const keyDir = join(homeDir, "Downloads", "Jobbored-Rotated-Keys-2026-05-27");
  const privateDir = join(keyDir, "private");
  const repoDir = join(root, "repo");
  const workerDir = join(repoDir, "integrations", "browser-use-discovery");

  await mkdir(privateDir, { recursive: true });
  await mkdir(workerDir, { recursive: true });
  writeFileSync(
    join(privateDir, "browser-use-discovery.env"),
    [
      "BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=auto-webhook",
      "BROWSER_USE_DISCOVERY_GEMINI_API_KEY=auto-gemini",
      "SERPAPI_API_KEY=auto-serpapi",
      "",
    ].join("\n"),
  );
  writeFileSync(join(privateDir, "service-account-key.json"), '{"ok":true}\n');

  execFileSync("bash", [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      JOBBORED_REPO: repoDir,
    },
    stdio: "pipe",
  });

  const envText = readFileSync(join(workerDir, ".env"), "utf8");
  assert.match(envText, /BROWSER_USE_DISCOVERY_WEBHOOK_SECRET=auto-webhook/);
  assert.equal((statSync(join(workerDir, ".env")).mode & 0o777), 0o600);
});
