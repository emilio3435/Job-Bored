import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const helpersJs = readFileSync(
  join(repoRoot, "discovery-shared-helpers.js"),
  "utf8",
);

// ============================================================
// Behavioral coverage for discovery-shared-helpers.js — the canonical
// URL-normalization + endpoint-classification helpers that every discovery
// surface (wizard steps, bootstrap/verify scripts, app.js) duplicates
// verbatim. The wizard branches its ENTIRE verify/repair flow on these
// answers, so a drifted classifier silently routes users down the wrong
// setup path. The module is a classic-global IIFE under
// window.JobBoredDiscoveryHelpers with a CJS module.exports mirror for
// Node-side scripts; we load it into a fresh VM context (repo pattern,
// see discovery-cross-rec.test.mjs) and drive the exported functions.
// All helpers are pure string->string/bool — no fetch, no DOM, no timers.
// ============================================================

function loadHelpers() {
  const window = {};
  const ctx = {
    window,
    console,
    setTimeout,
    clearTimeout,
    URL,
  };
  vm.createContext(ctx);
  vm.runInContext(helpersJs, ctx, {
    filename: "discovery-shared-helpers.js",
  });
  return { window, helpers: window.JobBoredDiscoveryHelpers };
}

// CJS-like load: `module` exists (Node-side consumers in scripts/ rely on
// the module.exports mirror of the window namespace).
function loadHelpersCjs() {
  const window = {};
  const module = { exports: {} };
  const ctx = { window, module, console, URL };
  vm.createContext(ctx);
  vm.runInContext(helpersJs, ctx, {
    filename: "discovery-shared-helpers.js",
  });
  return { window, moduleExports: module.exports };
}

describe("discovery-shared-helpers — asString (nullable/padded settings input)", () => {
  const { helpers } = loadHelpers();

  it("trims padding and stringifies non-string input so settings values compare canonically across surfaces", () => {
    assert.equal(helpers.asString("  hello  "), "hello");
    assert.equal(helpers.asString(8644), "8644", "numbers (ports) become strings");
  });

  it("returns the fallback for null/undefined/blank so callers never propagate empty values into URLs or ports", () => {
    assert.equal(helpers.asString(null, "fb"), "fb");
    assert.equal(helpers.asString(undefined, "fb"), "fb");
    assert.equal(helpers.asString("   ", "fb"), "fb", "whitespace-only counts as empty");
    assert.equal(helpers.asString(""), "", "default fallback is the empty string");
  });
});

describe("discovery-shared-helpers — normalizeUrl (canonical saved-URL form)", () => {
  const { helpers } = loadHelpers();

  it("strips query and hash so secrets/tracking params never persist into saved webhook URLs", () => {
    assert.equal(
      helpers.normalizeUrl("http://127.0.0.1:8644/webhook?secret=abc#frag"),
      "http://127.0.0.1:8644/webhook",
    );
  });

  it("canonicalizes padded and bare-origin input so the same endpoint compares equal everywhere", () => {
    assert.equal(
      helpers.normalizeUrl("  https://example.com  "),
      "https://example.com/",
      "trimmed + root slash added",
    );
    assert.equal(
      helpers.normalizeUrl("https://example.com#frag"),
      "https://example.com/",
    );
  });

  it("returns empty string (never throws) for scheme-less or garbage input — a pasted bare host must be rejected, not mis-saved", () => {
    assert.equal(helpers.normalizeUrl("example.com/webhook"), "");
    assert.equal(helpers.normalizeUrl("not a url"), "");
    assert.equal(helpers.normalizeUrl(null), "");
    assert.equal(helpers.normalizeUrl(""), "");
  });
});

describe("discovery-shared-helpers — isLocalHost (local-only host detection)", () => {
  const { helpers } = loadHelpers();

  it("recognizes every loopback spelling (localhost, 127.0.0.1, ::1, [::1], LOCALHOST) so local endpoints are flagged however the user typed them", () => {
    assert.equal(helpers.isLocalHost("localhost"), true);
    assert.equal(helpers.isLocalHost("127.0.0.1"), true);
    assert.equal(helpers.isLocalHost("::1"), true);
    assert.equal(helpers.isLocalHost("[::1]"), true, "bracketed IPv6 (URL.hostname form)");
    assert.equal(helpers.isLocalHost("LOCALHOST"), true, "case-insensitive");
  });

  it("recognizes RFC1918 private ranges (10.x, 192.168.x, 172.16-31.x) that remote webhook senders can never reach", () => {
    assert.equal(helpers.isLocalHost("10.0.0.5"), true);
    assert.equal(helpers.isLocalHost("192.168.1.42"), true);
    assert.equal(helpers.isLocalHost("172.16.0.1"), true);
    assert.equal(helpers.isLocalHost("172.31.255.255"), true);
  });

  it("does NOT flag public hosts or near-miss ranges (172.15.x / 172.32.x) — public endpoints must stay saveable", () => {
    assert.equal(helpers.isLocalHost("example.com"), false);
    assert.equal(helpers.isLocalHost("172.15.0.1"), false);
    assert.equal(helpers.isLocalHost("172.32.0.1"), false);
    assert.equal(helpers.isLocalHost("11.0.0.1"), false);
    assert.equal(helpers.isLocalHost(""), false, "empty input is not local");
  });
});

describe("discovery-shared-helpers — isLikelyAppsScriptWebAppUrl (stub detection)", () => {
  const { helpers } = loadHelpers();

  it("accepts https script.google.com /macros/s/{id}/exec and /dev — both deployment flavors of the Apps Script stub", () => {
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl("https://script.google.com/macros/s/AKfycbx123/exec"),
      true,
    );
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl("https://script.google.com/macros/s/AKfycbx123/dev"),
      true,
    );
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl("https://script.google.com/macros/s/AKfycbx123/exec/"),
      true,
      "trailing slash variant",
    );
  });

  it("rejects http, lookalike hosts, and non-macros paths — misclassifying a stub flips the whole verify flow (stubs skip the auth-probe header)", () => {
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl("http://script.google.com/macros/s/AKfycbx123/exec"),
      false,
      "stubs are https-only",
    );
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl("https://script.google.com.evil.com/macros/s/x/exec"),
      false,
      "host suffix spoof must not classify as a stub",
    );
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl("https://script.google.com/home/projects/x"),
      false,
      "non-webapp Apps Script pages are not stubs",
    );
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl("https://script.google.com/macros/s/x/exec/extra"),
      false,
      "extra path segments past exec are not the webapp endpoint",
    );
  });

  it("still detects a stub URL embedded in pasted text (regex fallback when URL parsing fails) so sloppy pastes classify correctly", () => {
    assert.equal(
      helpers.isLikelyAppsScriptWebAppUrl(
        "deployed at https://script.google.com/macros/s/ABC/exec just now",
      ),
      true,
    );
    assert.equal(helpers.isLikelyAppsScriptWebAppUrl("no url in here"), false);
    assert.equal(helpers.isLikelyAppsScriptWebAppUrl(""), false);
  });
});

describe("discovery-shared-helpers — isLikelyCloudflareWorkerUrl / isLikelyWorkerUrl", () => {
  const { helpers } = loadHelpers();

  it("accepts *.workers.dev and *.cloudflareworkers.com over https — the relay's two hosting shapes", () => {
    assert.equal(
      helpers.isLikelyCloudflareWorkerUrl("https://relay.foo.workers.dev/webhook"),
      true,
    );
    assert.equal(
      helpers.isLikelyCloudflareWorkerUrl("https://relay.cloudflareworkers.com/webhook"),
      true,
    );
  });

  it("rejects http workers, bare workers.dev, and lookalike hosts (myworkers.dev) so only real relays get worker treatment", () => {
    assert.equal(
      helpers.isLikelyCloudflareWorkerUrl("http://relay.foo.workers.dev/webhook"),
      false,
      "workers are https-only",
    );
    assert.equal(
      helpers.isLikelyCloudflareWorkerUrl("https://workers.dev/"),
      false,
      "the bare registry domain is not a worker",
    );
    assert.equal(
      helpers.isLikelyCloudflareWorkerUrl("https://myworkers.dev/webhook"),
      false,
      "suffix lookalike must not classify as a worker",
    );
    assert.equal(helpers.isLikelyCloudflareWorkerUrl(""), false);
  });

  it("isLikelyWorkerUrl (the short alias used by other copies) answers identically — split callers must never diverge", () => {
    for (const input of [
      "https://relay.foo.workers.dev/webhook",
      "https://relay.cloudflareworkers.com/webhook",
      "http://relay.foo.workers.dev/webhook",
      "https://example.com/webhook",
      "",
    ]) {
      assert.equal(
        helpers.isLikelyWorkerUrl(input),
        helpers.isLikelyCloudflareWorkerUrl(input),
        `alias diverged for ${JSON.stringify(input)}`,
      );
    }
  });
});

describe("discovery-shared-helpers — isLocalWebhookUrl (local-only endpoint guard)", () => {
  const { helpers } = loadHelpers();

  it("flags http(s) URLs on loopback/private hosts — cloud-hosted senders can never deliver to them", () => {
    assert.equal(helpers.isLocalWebhookUrl("http://localhost:8644/webhook"), true);
    assert.equal(helpers.isLocalWebhookUrl("http://192.168.1.5/webhook"), true);
    assert.equal(helpers.isLocalWebhookUrl("https://127.0.0.1/webhook"), true);
  });

  it("does not flag public endpoints, non-web schemes, or garbage — only a real local web endpoint warrants the local-only warning", () => {
    assert.equal(helpers.isLocalWebhookUrl("https://mac.tailnet.ts.net/webhook"), false);
    assert.equal(
      helpers.isLocalWebhookUrl("ftp://localhost/webhook"),
      false,
      "scheme guard: a local host on a non-web scheme is not a local WEBHOOK",
    );
    assert.equal(helpers.isLocalWebhookUrl("not a url"), false);
    assert.equal(helpers.isLocalWebhookUrl(""), false);
  });
});

describe("discovery-shared-helpers — isWorkerForwardUrl (/forward auth-header trap)", () => {
  const { helpers } = loadHelpers();

  it("detects the /forward suffix in all its spellings (trailing slash, query, nested path) — browsers cannot supply its auth headers, so it must be rejected as a webhook", () => {
    assert.equal(helpers.isWorkerForwardUrl("https://r.foo.workers.dev/forward"), true);
    assert.equal(helpers.isWorkerForwardUrl("https://r.foo.workers.dev/forward/"), true);
    assert.equal(
      helpers.isWorkerForwardUrl("https://r.foo.workers.dev/forward?x=1"),
      true,
      "query string must not hide the suffix",
    );
    assert.equal(helpers.isWorkerForwardUrl("https://r.foo.workers.dev/api/forward"), true);
  });

  it("does not flag /forwarding, the worker root, or unparseable input — a false positive blocks a perfectly valid endpoint", () => {
    assert.equal(helpers.isWorkerForwardUrl("https://r.foo.workers.dev/forwarding"), false);
    assert.equal(helpers.isWorkerForwardUrl("https://r.foo.workers.dev/"), false);
    assert.equal(helpers.isWorkerForwardUrl("not a url"), false);
    assert.equal(helpers.isWorkerForwardUrl(""), false);
  });
});

describe("discovery-shared-helpers — classifySavedWebhookKind (the wizard's routing switch)", () => {
  const { helpers } = loadHelpers();

  it("maps each endpoint shape to its kind — the wizard branches its entire verify/repair flow on this answer", () => {
    assert.equal(helpers.classifySavedWebhookKind(""), "none", "no URL saved");
    assert.equal(helpers.classifySavedWebhookKind(null), "none");
    assert.equal(
      helpers.classifySavedWebhookKind("http://127.0.0.1:8644/webhook"),
      "local_http",
    );
    assert.equal(
      helpers.classifySavedWebhookKind("https://relay.foo.workers.dev/webhook"),
      "worker",
    );
    assert.equal(
      helpers.classifySavedWebhookKind("https://script.google.com/macros/s/ABC/exec"),
      "apps_script_stub",
    );
    assert.equal(
      helpers.classifySavedWebhookKind("https://mac.tailnet.ts.net/webhook"),
      "generic_https",
    );
    assert.equal(
      helpers.classifySavedWebhookKind("http://example.com/webhook"),
      "generic_https",
      "a plain-http PUBLIC endpoint still routes through the generic lane",
    );
  });

  it("returns 'none' for non-web schemes and unparseable input — an ftp:// URL can never receive a webhook", () => {
    assert.equal(helpers.classifySavedWebhookKind("ftp://example.com/webhook"), "none");
    assert.equal(helpers.classifySavedWebhookKind("not a url"), "none");
  });

  it("a privately-hosted endpoint classifies local_http even when its path looks like another kind — local-only beats shape", () => {
    assert.equal(
      helpers.classifySavedWebhookKind("http://10.0.0.5/macros/s/x/exec"),
      "local_http",
    );
  });

  it("classifyWebhookUrl is the same function (backward-compat alias) — older callers must keep getting identical answers", () => {
    assert.equal(helpers.classifyWebhookUrl, helpers.classifySavedWebhookKind);
  });
});

describe("discovery-shared-helpers — buildLocalHealthUrl (probe targeting)", () => {
  const { helpers } = loadHelpers();

  it("rewrites any local webhook path to /health while preserving scheme+host+port — the probe must hit the SAME server the webhook would", () => {
    assert.equal(
      helpers.buildLocalHealthUrl("http://127.0.0.1:8644/webhook?secret=x#f"),
      "http://127.0.0.1:8644/health",
      "port preserved, path replaced, query/hash dropped",
    );
    assert.equal(
      helpers.buildLocalHealthUrl("https://localhost/some/deep/path"),
      "https://localhost/health",
    );
  });

  it("returns empty string for unparseable input so callers skip the probe instead of fetching garbage", () => {
    assert.equal(helpers.buildLocalHealthUrl("not a url"), "");
    assert.equal(helpers.buildLocalHealthUrl(""), "");
    assert.equal(helpers.buildLocalHealthUrl(null), "");
  });
});

describe("discovery-shared-helpers — localHealthProxyUrl (CORS detour for loopback probes)", () => {
  const { helpers } = loadHelpers();

  it("routes loopback health checks through /__proxy/local-health with the explicit port — the browser cannot hit localhost cross-origin directly", () => {
    assert.equal(
      helpers.localHealthProxyUrl("http://127.0.0.1:8644/health"),
      "/__proxy/local-health?port=8644",
    );
    assert.equal(
      helpers.localHealthProxyUrl("http://[::1]:8644/health"),
      "/__proxy/local-health?port=8644",
      "bracketed IPv6 loopback takes the same detour",
    );
  });

  it("infers 80/443 from the scheme when the loopback URL omits the port — the proxy must dial the port the URL implies", () => {
    assert.equal(
      helpers.localHealthProxyUrl("http://localhost/health"),
      "/__proxy/local-health?port=80",
    );
    assert.equal(
      helpers.localHealthProxyUrl("https://localhost/health"),
      "/__proxy/local-health?port=443",
    );
  });

  it("passes non-loopback and unparseable URLs through untouched — only localhost needs the proxy detour", () => {
    assert.equal(
      helpers.localHealthProxyUrl("https://mac.tailnet.ts.net/health"),
      "https://mac.tailnet.ts.net/health",
    );
    assert.equal(
      helpers.localHealthProxyUrl("http://192.168.1.5:8644/health"),
      "http://192.168.1.5:8644/health",
      "private-LAN IPs are reachable directly; only loopback is proxied",
    );
    assert.equal(helpers.localHealthProxyUrl("not a url"), "not a url");
  });
});

describe("discovery-shared-helpers — inferPortFromUrl + DEFAULT_LOCAL_PORT (worker port contract)", () => {
  const { helpers } = loadHelpers();

  it("returns the explicit port, or infers 443/80 from the scheme — bootstrap must serve the exact port the saved URL implies", () => {
    assert.equal(helpers.inferPortFromUrl("http://127.0.0.1:8644/webhook"), "8644");
    assert.equal(helpers.inferPortFromUrl("https://example.com/webhook"), "443");
    assert.equal(helpers.inferPortFromUrl("http://example.com/webhook"), "80");
  });

  it("falls back to the discovery worker default 8644 for invalid input (and when the custom fallback itself is blank)", () => {
    assert.equal(helpers.DEFAULT_LOCAL_PORT, "8644", "the worker port every surface assumes");
    assert.equal(helpers.inferPortFromUrl("not a url"), "8644");
    assert.equal(helpers.inferPortFromUrl(""), "8644");
    assert.equal(helpers.inferPortFromUrl("", "9999"), "9999", "explicit fallback wins");
    assert.equal(
      helpers.inferPortFromUrl("not a url", ""),
      "8644",
      "a blank fallback still lands on the default — never an empty port",
    );
  });
});

describe("discovery-shared-helpers — export contract (one API for browser AND Node)", () => {
  it("module.exports IS the window.JobBoredDiscoveryHelpers namespace in a CJS-like context — Node scripts and browser code must see one identical API", () => {
    const { window, moduleExports } = loadHelpersCjs();
    assert.equal(
      moduleExports,
      window.JobBoredDiscoveryHelpers,
      "the two export surfaces must be the same live object, not copies",
    );
    assert.equal(
      moduleExports.normalizeUrl("https://example.com/x?y=1"),
      "https://example.com/x",
      "the CJS surface is functional, not just present",
    );
    assert.equal(
      moduleExports.classifySavedWebhookKind("https://relay.foo.workers.dev/webhook"),
      "worker",
    );
  });

  it("loading into a window that already owns the namespace MERGES instead of clobbering — sibling discovery scripts attach to the same root", () => {
    const sibling = () => "sibling";
    const preSeeded = { existingSiblingHelper: sibling };
    const ctx = {
      window: { JobBoredDiscoveryHelpers: preSeeded },
      console,
      URL,
    };
    vm.createContext(ctx);
    vm.runInContext(helpersJs, ctx, {
      filename: "discovery-shared-helpers.js",
    });
    const root = ctx.window.JobBoredDiscoveryHelpers;
    assert.equal(root, preSeeded, "the pre-existing namespace object survives");
    assert.equal(root.existingSiblingHelper, sibling, "sibling helpers survive the load");
    assert.equal(typeof root.normalizeUrl, "function", "and the shared helpers are added");
  });
});
