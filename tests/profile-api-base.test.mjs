/**
 * F2B-DISC01-ORIGIN — canonical API-base resolver.
 *
 * Fit Profile and the discovery drawer must not fetch `/profile` against the
 * static dashboard origin (:8080). The dedicated JobBored API (default
 * 127.0.0.1:3847) is reached through getProfileApiBase / profileUrl.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperPath = join(repoRoot, "profile-api-base.js");

function loadHelper({ config = {}, protocol = "http:" } = {}) {
  assert.equal(
    existsSync(helperPath),
    true,
    "profile-api-base.js must exist as the isolated canonical resolver",
  );
  const source = readFileSync(helperPath, "utf8");
  const window = {
    COMMAND_CENTER_CONFIG: config,
    location: { protocol, pathname: "/", search: "" },
  };
  const ctx = { window, globalThis: { } };
  ctx.globalThis = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: "profile-api-base.js" });
  const api = ctx.window.JobBoredProfileApi;
  assert.ok(api, "helper must attach window.JobBoredProfileApi");
  return { api, window };
}

describe("F2B-DISC01-ORIGIN — getProfileApiBase / profileUrl", () => {
  it("explicit jobBoredApiUrl wins (trailing slashes stripped) so a :8080 dashboard talks to the :3847 API", () => {
    const { api } = loadHelper({
      config: { jobBoredApiUrl: "http://127.0.0.1:3847///" },
    });
    assert.equal(api.getProfileApiBase(), "http://127.0.0.1:3847");
    assert.equal(api.profileUrl("/profile"), "http://127.0.0.1:3847/profile");
  });

  it("falls back to jobPostingScrapeUrl when jobBoredApiUrl is empty — the scraper co-hosts /profile", () => {
    const { api } = loadHelper({
      config: { jobPostingScrapeUrl: "https://api.example.test" },
    });
    assert.equal(api.profileUrl("/profile"), "https://api.example.test/profile");
  });

  it("jobBoredApiUrl beats jobPostingScrapeUrl when both are set", () => {
    const { api } = loadHelper({
      config: {
        jobBoredApiUrl: "http://api.primary.test",
        jobPostingScrapeUrl: "http://scraper.other.test",
      },
    });
    assert.equal(api.profileUrl("/profile"), "http://api.primary.test/profile");
  });

  it("an http(s) origin with no config resolves RELATIVE so reverse proxies just work", () => {
    const { api } = loadHelper({ config: {}, protocol: "https:" });
    assert.equal(api.getProfileApiBase(), "");
    assert.equal(api.profileUrl("/profile"), "/profile");
  });

  it("file:// has no origin to be relative to — falls back to the default dev port 3847", () => {
    const { api } = loadHelper({ config: {}, protocol: "file:" });
    assert.equal(api.profileUrl("/profile"), "http://127.0.0.1:3847/profile");
  });
});
