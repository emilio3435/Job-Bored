/**
 * F2B-DISC01-ORIGIN — discovery drawer /profile origin.
 *
 * loadMasterFitProfile currently fetch("/profile")s against the dashboard
 * origin. It must reuse the canonical API-base helper so a :8080 dashboard
 * talks to the :3847 API.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const drawerJs = readFileSync(join(repoRoot, "discovery-drawer.js"), "utf8");
const backcompatJs = readFileSync(
  join(repoRoot, "fit-profile-backcompat.js"),
  "utf8",
);

function sliceFn(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `expected to find ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `expected ${endNeedle} after ${startNeedle}`);
  return source.slice(start, end);
}

describe("F2B-DISC01-ORIGIN — discovery drawer must not fetch /profile on the dashboard origin", () => {
  it("loadMasterFitProfile does not call fetch('/profile') relative to :8080", () => {
    const fn = sliceFn(
      drawerJs,
      "function profileApiPath",
      "function getEffectiveFitProfileFields",
    );
    assert.doesNotMatch(
      fn,
      /fetch\(\s*["']\/profile["']/,
      "relative fetch('/profile') 404s on the static dashboard port",
    );
    assert.match(
      fn,
      /getProfileApiBase|profileUrl|JobBoredProfileApi|FitProfileForm/,
      "must reuse the canonical API-base resolver",
    );
  });

  it("loadMasterFitProfile GETs the resolved /profile URL when jobBoredApiUrl is set", async () => {
    const fetchCalls = [];
    const window = {
      COMMAND_CENTER_CONFIG: { jobBoredApiUrl: "http://127.0.0.1:3847" },
      JobBoredProfileApi: {
        getProfileApiBase() {
          return "http://127.0.0.1:3847";
        },
        profileUrl(path) {
          return "http://127.0.0.1:3847" + path;
        },
      },
      FitProfileForm: {
        getProfileApiBase() {
          return "http://127.0.0.1:3847";
        },
        profileUrl(path) {
          return "http://127.0.0.1:3847" + path;
        },
      },
    };
    const ctx = {
      window,
      console: { log() {}, warn() {}, error() {} },
      fetch: async (url, opts = {}) => {
        fetchCalls.push({
          url: String(url),
          method: (opts && opts.method) || "GET",
        });
        return {
          ok: true,
          json: async () => ({
            ok: true,
            profile: { identity: { targetRoles: ["Staff Engineer"] } },
          }),
        };
      },
    };
    vm.createContext(ctx);
    vm.runInContext(drawerJs, ctx, { filename: "discovery-drawer.js" });
    const drawer = ctx.window.JobBoredDiscovery.drawer;
    assert.equal(
      typeof drawer.loadMasterFitProfile,
      "function",
      "drawer must export loadMasterFitProfile so origin can be tested",
    );
    const profile = await drawer.loadMasterFitProfile();
    assert.equal(profile.identity.targetRoles[0], "Staff Engineer");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "http://127.0.0.1:3847/profile");
    assert.equal(fetchCalls[0].method, "GET");
  });
});

describe("F2B-DISC01-ORIGIN — fit-profile-backcompat uses the same API base", () => {
  it("rescore / migrate / GET profile calls are not relative dashboard fetches", () => {
    assert.doesNotMatch(
      backcompatJs,
      /fetch\(\s*["']\/profile(?:\/rescore|\/migrate)?["']/,
      "backcompat must not fetch /profile* against the dashboard origin",
    );
    assert.match(
      backcompatJs,
      /getProfileApiBase|profileUrl|JobBoredProfileApi|FitProfileForm/,
      "backcompat must reuse the canonical API-base resolver",
    );
  });
});
