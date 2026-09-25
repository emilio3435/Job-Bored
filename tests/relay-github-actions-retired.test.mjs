// Repair (review P2, templates/cloudflare-worker/worker.js): the relay now
// answers 401 without its per-dashboard bearer, and neither GitHub Actions
// workflow (the Settings-generated one or the template) sends that bearer.
// The docs still promised "GitHub only needs the public Worker URL and Sheet
// ID", so a scheduled GitHub POST to the relay went from HTTP 202 to 401.
// Lane R retires that path explicitly: the relay is not a GitHub Actions
// target, scheduled relay runs come from the relay's own Cloudflare Cron, and
// the docs tell existing users how to migrate. This pins that wording.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

const DOCS = [
  "docs/SETTINGS-SCHEDULE.md",
  "templates/github-actions/README.md",
  "templates/cloudflare-worker/README.md",
];

describe("GitHub Actions to the Cloudflare relay is retired", () => {
  for (const rel of DOCS) {
    it(`${rel} no longer promises GitHub needs only the public Worker URL`, () => {
      const text = read(rel);
      assert.doesNotMatch(text, /GitHub (can then keep|only needs) (only )?the public Worker URL/i);
    });

    it(`${rel} says the relay rejects GitHub Actions and how to migrate`, () => {
      const text = read(rel);
      const section = text.match(/GitHub Actions and the Cloudflare relay[\s\S]{0,1500}/i);
      assert.ok(section, `${rel} has a "GitHub Actions and the Cloudflare relay" note`);
      const body = section[0];
      assert.match(body, /401/);
      assert.match(body, /not a supported GitHub Actions target|does not accept GitHub Actions/i);
      assert.match(body, /Cloudflare Cron/);
      assert.match(body, /--sheet-id/);
      assert.match(body, /COMMAND_CENTER_DISCOVERY_WEBHOOK_URL/);
    });
  }

  it("the GitHub Actions secret table no longer offers the relay as a webhook URL", () => {
    const text = read("templates/github-actions/README.md");
    const row = text.split("\n").find((line) => line.includes("`COMMAND_CENTER_DISCOVERY_WEBHOOK_URL`"));
    assert.ok(row);
    assert.doesNotMatch(row, /Cloudflare Worker relay/i);
  });
});
