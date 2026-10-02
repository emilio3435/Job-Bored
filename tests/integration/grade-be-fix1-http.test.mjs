import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { LEGACY_V2 } from "../fixtures/materials-qa-v3.mjs";
import { isLimitedRoute } from "../../server/route-limits.mjs";

const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const schema = JSON.parse(await readFile(new URL("../../schemas/api-error.v1.schema.json", import.meta.url), "utf8"));
const validateError = new Ajv2020({ strict: false }).compile(schema);
let home, app, run, child, base, unavailable;
const save = (path, value) => writeFile(path, JSON.stringify(value));
before(async () => {
  const probe = createServer();
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        if (!address || typeof address === "string") reject(new Error("ephemeral loopback address unavailable"));
        else resolve(address.port);
      });
    });
  } catch (error) { unavailable = `ephemeral loopback unavailable: ${error.code || error.message}`; return; }
  finally { if (probe.listening) await new Promise(resolve => probe.close(resolve)); }
  home = await mkdtemp(join(tmpdir(), "grade-fix1-http-"));
  app = join(home, "applications", "acme"); run = join(app, "runs", "original");
  await mkdir(run, { recursive: true });
  for (const dir of [app, run]) {
    await save(join(dir, "run.json"), { runId: "original", feature: "cover_letter" });
    await save(join(dir, "qa.letter.json"), LEGACY_V2);
    await save(join(dir, "qa.json"), { contract: "materials.qa.v2", runId: "original", disposition: "FAIL", quality: { score: 81 } });
    await writeFile(join(dir, "qa-report.md"), "FAIL · 81/100\nQuality score 81");
    await writeFile(join(dir, "cover-letter.html"), "<p>A fictional draft.</p>");
  }
  const outside = join(home, "outside.txt"); await writeFile(outside, "Private fixture.");
  await symlink(outside, join(run, "resume.txt"));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["index.mjs"], { cwd: join(repo, "server"), env: { ...process.env,
    HOME: home, USERPROFILE: home, PORT: String(port), LISTEN_HOST: "127.0.0.1",
    JOBBORED_HOME: join(home, ".jobbored"), JOBBORED_APPLICATIONS_ROOT: join(home, "applications"),
    JOBBORED_PROFILE_PATH: join(home, "profile.json"), HERMES_APPLICATIONS_LEGACY_ROOT: join(home, "no-legacy"),
    JOBBORED_ROUTE_RATE_PER_MINUTE: "2", JOBBORED_ROUTE_CONCURRENCY: "1",
  }, stdio: ["ignore", "pipe", "pipe"] });
  // Consume logs without printing provider configuration or local user paths.
  child.stdout.resume(); child.stderr.resume();
  for (let tries = 0; tries < 100; tries++) {
    if (child.exitCode !== null) throw new Error(`server exited before health: ${child.exitCode}`);
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* wait for startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("server did not become healthy");
});
after(async () => {
  if (child && child.exitCode === null) { const ended = once(child, "exit"); child.kill(); await ended; }
  if (home) await rm(home, { recursive: true, force: true });
});
function available(t) { if (unavailable) { t.skip(unavailable); return false; } return true; }
async function errorResponse(path, status, init) {
  const response = await fetch(base + path, init);
  assert.equal(response.status, status);
  const body = await response.json(); assert.equal(validateError(body), true, JSON.stringify(validateError.errors));
  assert.doesNotMatch(JSON.stringify(body), /Private fixture|\/grade-fix1-http-/);
  return { response, body };
}
it("GRADE-B FIX1-B10: rescore is registered with the production limiter", () => {
  assert.equal(isLimitedRoute("POST", "/api/applications/acme/runs/original/rescore"), true);
  assert.equal(isLimitedRoute("GET", "/api/applications/acme/runs/original/files/cover-letter.html"), false);
});
it("GRADE-B FIX1-B10: HTTP run-file guards, HTML headers and error envelope", async t => {
  if (!available(t)) return;
  const prefix = "/api/applications/acme/runs/original/files/";
  const html = await fetch(base + prefix + "cover-letter.html?download=1");
  assert.equal(html.status, 200); assert.equal(html.headers.get("x-content-type-options"), "nosniff");
  assert.match(html.headers.get("content-security-policy"), /sandbox; default-src 'none'/);
  assert.match(html.headers.get("content-disposition"), /attachment/);
  assert.equal(await html.text(), "<p>A fictional draft.</p>");
  await errorResponse(prefix + "credentials.txt", 400);
  await errorResponse(prefix + "resume.txt", 400);
  await errorResponse("/api/applications/acme/runs/bad..id/files/cover-letter.html", 400);
  await errorResponse("/api/applications/acme/runs/original/files/%2e%2e%2fqa.letter.json", 400);
});
it("GRADE-B FIX1-B3: both HTTP file routes serve legacy QA without totals", async t => {
  if (!available(t)) return;
  for (const prefix of ["/api/applications/acme/files/", "/api/applications/acme/runs/original/files/"]) for (const name of ["qa.json", "qa.letter.json", "qa-report.md"]) {
    const response = await fetch(base + prefix + name); assert.equal(response.status, 200);
    const text = await response.text(); assert.doesNotMatch(text, /81\/100|Quality score|"quality"\s*:/);
    if (name.endsWith("json")) assert.equal(JSON.parse(text).contract, "materials.qa.v3");
  }
  assert.equal(await readFile(join(run, "qa-report.md"), "utf8"), "FAIL · 81/100\nQuality score 81");
  assert.equal((JSON.parse(await readFile(join(run, "qa.letter.json"), "utf8"))).quality.score, 100);
});
it("GRADE-B FIX1-B10: HTTP Rescore returns 409 during drafting and 429 at the limit", async t => {
  if (!available(t)) return;
  await rm(join(run, "resume.txt")); // The preceding GET case's escaping fixture.
  await save(join(app, "pending.json"), { progress: { phase: "writing" } });
  const path = "/api/applications/acme/runs/original/rescore";
  await errorResponse(path, 409, { method: "POST" });
  await errorResponse(path, 409, { method: "POST" });
  const limited = await errorResponse(path, 429, { method: "POST" });
  assert.equal(limited.body.code, "rate_limited"); assert.ok(limited.response.headers.get("retry-after"));
});
