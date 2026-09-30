/*
 * JOBQA hermetic fixture: browser stubs. Served by serve.mjs as the FIRST
 * script on the page. Everything outside the fixture's own two loopback
 * origins is answered here with a labeled MOCK or refused; nothing reaches
 * Google, an AI provider, Sheets or a discovery worker.
 *
 *   Accounts (Google sign-in is mocked):  ?fixtureAccount=a  Morgan Existing
 *                                         ?fixtureAccount=b  Alex Example (default)
 *   AI keys (provider checks are mocked): fixture-ok, fixture-slow (4 s),
 *                                         fixture-fail (provider error);
 *                                         anything else is "invalid key".
 *   Refused requests are reported to /__jobqa__/egress as method + origin +
 *   path only (never the query string or body, so no key is ever logged).
 */
/* global window, document, navigator, sessionStorage, Request, Response, XMLHttpRequest, URL, URLSearchParams, setTimeout */
(function () {
  "use strict";
  var FIXTURE = /*JOBQA_CONFIG*/ {};
  window.__JOBQA_FIXTURE__ = FIXTURE;

  var ACCOUNTS = {
    a: { email: "morgan.existing@fixture.test", given_name: "Morgan", name: "Morgan Existing" },
    b: { email: "alex.example@fixture.test", given_name: "Alex", name: "Alex Example" },
  };
  var accountKey = "b";
  try {
    var requested = new URLSearchParams(window.location.search).get("fixtureAccount");
    if (requested && ACCOUNTS[requested]) sessionStorage.setItem("jobqa.fixtureAccount", requested);
    var stored = sessionStorage.getItem("jobqa.fixtureAccount");
    if (stored && ACCOUNTS[stored]) accountKey = stored;
  } catch (_) {
    /* sessionStorage blocked: stay on the default account */
  }
  FIXTURE.account = accountKey;

  var realFetch = window.fetch.bind(window);
  var ownOrigins = [window.location.origin].concat(FIXTURE.apiOrigins || []);

  function report(kind, method, url) {
    try {
      var parsed = new URL(url, window.location.href);
      realFetch("/__jobqa__/egress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: kind, method: method, origin: parsed.origin, path: parsed.pathname }),
      }).catch(function () {});
    } catch (_) {
      /* never let reporting break the page */
    }
  }

  function json(body, status, mockKind) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "content-type": "application/json", "x-jobqa-mock": mockKind || "fixture" },
    });
  }

  function delay(ms) {
    return new Promise(function (done) {
      setTimeout(done, ms);
    });
  }

  function headerOf(init, request, name) {
    var lower = name.toLowerCase();
    var headers = (init && init.headers) || (request && request.headers) || null;
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get(name) || "";
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) return String(headers[key]);
    }
    return "";
  }

  var PIPELINE_HEADERS = [
    "Date Found", "Title", "Company", "Location", "Link", "Source", "Salary", "Fit Score", "Priority",
    "Tags", "Fit Assessment", "Contact", "Status", "Applied Date", "Notes", "Follow-up Date",
    "Talking Points", "Last contact", "Did they reply?", "Logo URL", "Match Score", "Favorite",
    "Dismissed At", "Approval Status", "Edit Lock",
  ];
  var SHEET_ID = "jobqa-fixture-sheet-" + accountKey;

  function sheetsMock(method, url) {
    var path = url.pathname;
    var meta = {
      spreadsheetId: SHEET_ID,
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/edit",
      properties: { title: "JobBored Pipeline (JOBQA fixture mock)" },
      sheets: [{ properties: { sheetId: 0, title: "Pipeline", index: 0 } }],
    };
    if (method === "POST" && /\/v4\/spreadsheets\/?$/.test(path)) return json(meta, 200, "sheets");
    if (method === "GET" && /\/values:batchGet$/.test(path)) {
      return json({ spreadsheetId: SHEET_ID, valueRanges: [{ range: "Pipeline!A1:Y1", majorDimension: "ROWS", values: [PIPELINE_HEADERS] }] }, 200, "sheets");
    }
    if (method === "GET" && /\/values\//.test(path)) {
      return json({ range: "Pipeline!A1:Y1", majorDimension: "ROWS", values: [PIPELINE_HEADERS] }, 200, "sheets");
    }
    if (method === "GET") return json(meta, 200, "sheets");
    if (method === "PUT") return json({ spreadsheetId: SHEET_ID, updatedRows: 1 }, 200, "sheets");
    return json({ spreadsheetId: SHEET_ID, replies: [], updates: {} }, 200, "sheets");
  }

  function keyVerdict(key) {
    if (key === "fixture-ok") return "ok";
    if (key === "fixture-slow") return "slow";
    if (key === "fixture-fail") return "fail";
    return "invalid";
  }

  function providerMock(method, url, init, request) {
    var host = url.hostname;
    if (host === "generativelanguage.googleapis.com") {
      var gKey = url.searchParams.get("key") || headerOf(init, request, "x-goog-api-key");
      var gVerdict = keyVerdict(gKey);
      if (gVerdict === "invalid") {
        return json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key. (JOBQA fixture mock)" } }, 400, "provider");
      }
      if (gVerdict === "fail") {
        return json({ error: { code: 500, status: "INTERNAL", message: "The model is overloaded. (JOBQA fixture mock)" } }, 500, "provider");
      }
      var gAnswer = /:generateContent$/.test(url.pathname)
        ? { candidates: [{ content: { role: "model", parts: [{ text: "OK" }] }, finishReason: "STOP" }], modelVersion: "gemini-flash-latest" }
        : { models: [{ name: "models/gemini-flash-latest", displayName: "Gemini Flash (JOBQA fixture mock)", supportedGenerationMethods: ["generateContent"] }] };
      return gVerdict === "slow" ? delay(4000).then(function () { return json(gAnswer, 200, "provider"); }) : json(gAnswer, 200, "provider");
    }
    if (host === "api.anthropic.com") {
      var aVerdict = keyVerdict(headerOf(init, request, "x-api-key"));
      if (aVerdict === "invalid") return json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key (JOBQA fixture mock)" } }, 401, "provider");
      if (aVerdict === "fail") return json({ type: "error", error: { type: "overloaded_error", message: "Overloaded (JOBQA fixture mock)" } }, 529, "provider");
      var aAnswer = { type: "message", role: "assistant", model: "claude-fixture", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" };
      return aVerdict === "slow" ? delay(4000).then(function () { return json(aAnswer, 200, "provider"); }) : json(aAnswer, 200, "provider");
    }
    if (host === "openrouter.ai" || host === "api.openai.com" || host === "api.x.ai") {
      var bearer = headerOf(init, request, "authorization").replace(/^Bearer\s+/i, "");
      var oVerdict = keyVerdict(bearer);
      if (oVerdict === "invalid") {
        return json({ error: { message: "Incorrect API key provided. (JOBQA fixture mock)", type: "invalid_request_error", code: "invalid_api_key" } }, 401, "provider");
      }
      if (oVerdict === "fail") return json({ error: { message: "Provider error. (JOBQA fixture mock)", type: "server_error" } }, 500, "provider");
      var oAnswer = /\/models\/?$/.test(url.pathname)
        ? { data: [{ id: "fixture/model", name: "Fixture model (JOBQA mock)" }] }
        : /\/auth\/key$/.test(url.pathname)
          ? { data: { label: "fixture", limit: null } }
          : { id: "fixture", model: "fixture/model", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] };
      return oVerdict === "slow" ? delay(4000).then(function () { return json(oAnswer, 200, "provider"); }) : json(oAnswer, 200, "provider");
    }
    return null;
  }

  function mockFor(method, url, init, request) {
    if (url.hostname === "www.googleapis.com" && url.pathname === "/oauth2/v3/userinfo") {
      var who = ACCOUNTS[accountKey];
      return json({ sub: "jobqa-fixture-" + accountKey, email: who.email, email_verified: true, name: who.name, given_name: who.given_name }, 200, "google");
    }
    if (url.hostname === "sheets.googleapis.com") return sheetsMock(method, url);
    if (url.hostname === "www.googleapis.com" && url.pathname.indexOf("/drive/") === 0) return json({ files: [] }, 200, "google");
    if (url.hostname === "autocomplete.clearbit.com") return json([], 200, "logos");
    return providerMock(method, url, init, request);
  }

  window.fetch = function (input, init) {
    var request = input instanceof Request ? input : null;
    var raw = request ? request.url : String(input);
    var url;
    try {
      url = new URL(raw, window.location.href);
    } catch (_) {
      return realFetch(input, init);
    }
    var method = String((init && init.method) || (request && request.method) || "GET").toUpperCase();
    if (ownOrigins.indexOf(url.origin) !== -1) return realFetch(input, init);
    var mocked = mockFor(method, url, init, request);
    if (mocked) {
      report("mocked", method, url.href);
      return Promise.resolve(mocked);
    }
    report("refused", method, url.href);
    return Promise.reject(new TypeError("Blocked by the JOBQA fixture: " + url.origin + url.pathname));
  };

  var realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, target) {
    var url = new URL(String(target), window.location.href);
    if (ownOrigins.indexOf(url.origin) === -1) {
      report("refused", String(method || "GET").toUpperCase(), url.href);
      throw new TypeError("Blocked by the JOBQA fixture: " + url.origin + url.pathname);
    }
    return realOpen.apply(this, arguments);
  };

  if (navigator.sendBeacon) {
    var realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (target, data) {
      var url = new URL(String(target), window.location.href);
      if (ownOrigins.indexOf(url.origin) === -1) {
        report("refused", "BEACON", url.href);
        return false;
      }
      return realBeacon(target, data);
    };
  }

  function banner() {
    if (!document.body || document.getElementById("jobqaFixtureBanner")) return;
    var who = ACCOUNTS[accountKey];
    var el = document.createElement("div");
    el.id = "jobqaFixtureBanner";
    el.setAttribute("aria-hidden", "true");
    el.textContent =
      "JOBQA FIXTURE · synthetic data · seed " + (FIXTURE.seed || "?") +
      " · account " + accountKey + " (" + who.email + ") · Google, Sheets and AI are MOCKED";
    el.style.cssText =
      "position:fixed;top:6px;left:6px;max-width:180px;z-index:2147483647;pointer-events:none;" +
      "font:600 10px/1.35 ui-monospace,Menlo,monospace;color:#7a1d00;background:#fff4c2;" +
      "border:1px solid #e0a800;border-radius:6px;padding:4px 6px;opacity:.92";
    document.body.appendChild(el);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner);
  else banner();
})();
