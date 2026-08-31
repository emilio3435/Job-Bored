/**
 * F2D-AUTH01-CSP
 *
 * WHY this exists: the shipped dashboard CSP in dev-server.mjs omits
 * hosts the current code actually contacts (www.googleapis.com userinfo,
 * script.googleapis.com Apps Script API, docs.google.com gviz JSONP/CSV,
 * Clearbit autocomplete, and user-configured custom origins). F0-A owns
 * applying the header; this lane owns the tested policy module F0-A must
 * consume. A test that only greps the current hardcoded string would go
 * green on the broken policy.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REQUIRED_CONNECT_SRC,
  REQUIRED_SCRIPT_SRC,
  buildContentSecurityPolicy,
} from "../scripts/lib/browser-csp-policy.mjs";

describe("F2D-AUTH01-CSP browser policy module", () => {
  it("requires connect-src hosts the dashboard actually fetches", () => {
    const required = [
      "https://www.googleapis.com",
      "https://script.googleapis.com",
      "https://docs.google.com",
      "https://autocomplete.clearbit.com",
      "https://accounts.google.com",
      "https://sheets.googleapis.com",
    ];
    for (const origin of required) {
      assert.ok(
        REQUIRED_CONNECT_SRC.includes(origin),
        `expected REQUIRED_CONNECT_SRC to include ${origin}, got ${REQUIRED_CONNECT_SRC.join(" ")}`,
      );
    }
  });

  it("requires script-src for GIS and docs.google.com JSONP fallback", () => {
    const required = [
      "https://accounts.google.com",
      "https://docs.google.com",
    ];
    for (const origin of required) {
      assert.ok(
        REQUIRED_SCRIPT_SRC.includes(origin),
        `expected REQUIRED_SCRIPT_SRC to include ${origin}, got ${REQUIRED_SCRIPT_SRC.join(" ")}`,
      );
    }
  });

  it("emits a CSP string covering required hosts plus custom connect-src origins", () => {
    const csp = buildContentSecurityPolicy({
      extraConnectSrc: ["https://scraper.example.com", "http://127.0.0.1:3847"],
    });
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /connect-src/);
    assert.match(csp, /script-src/);
    assert.ok(csp.includes("https://www.googleapis.com"));
    assert.ok(csp.includes("https://script.googleapis.com"));
    assert.ok(csp.includes("https://docs.google.com"));
    assert.ok(csp.includes("https://autocomplete.clearbit.com"));
    assert.ok(csp.includes("https://scraper.example.com"));
    assert.ok(csp.includes("http://127.0.0.1:3847"));
  });

  it("ignores non-http(s) custom origins instead of widening the policy", () => {
    const csp = buildContentSecurityPolicy({
      extraConnectSrc: ["javascript:alert(1)", "data:text/html,x", "https://ok.example"],
    });
    assert.equal(csp.includes("javascript:"), false);
    assert.equal(csp.includes("data:text/html"), false);
    assert.ok(csp.includes("https://ok.example"));
  });
});
