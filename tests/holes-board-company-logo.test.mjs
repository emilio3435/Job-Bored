/**
 * HOLES BOARD — B14: company logos come from the local JobBored API, not
 * Clearbit.
 *
 * Clearbit's logo host is DNS-dead, its autocomplete returns no logo and
 * picks the wrong company for "Stripe, Inc.", and company-logo.js fetched it
 * twice for one company. Now the board asks GET /api/brand-logos/company once
 * per company for the page's life, draws only a raster data: URL, and the
 * Sheet's Logo URL cell gets a portable favicon URL computed offline.
 *
 * company-logo.js is a classic-global IIFE: it is loaded into a vm context
 * with app-utils.js (the real escapeHtml/safeHref behind core.host),
 * company-cap.js (the shared company key), a recording fetch and a fake
 * document holding .co-logo-wrap placeholders.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(repoRoot, file), "utf8");
const appUtilsJs = read("app-utils.js");
const companyCapJs = read("company-cap.js");
const companyLogoJs = read("company-logo.js");

const LOCAL_API = "http://127.0.0.1:3847";
const PNG_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const lookupUrl = (base, name) => `${base}/api/brand-logos/company?name=${encodeURIComponent(name)}`;
const favicon = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const markResponse = (src) => jsonResponse({ ok: true, mark: { src, alt: "logo", shape: "mark" } });
const nameOf = (url) => decodeURIComponent(String(url).split("name=")[1] || "");

/** Let every chained promise in the module settle. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** A .co-logo-wrap placeholder as renderLogoHtml draws it: initials inside. */
function makeWrap(company) {
  const wrap = { company, inserted: [], fallback: null };
  wrap.fallback = {
    className: "co-logo co-logo--fallback co-logo--sm",
    before(node) {
      wrap.inserted.push(node);
    },
    remove() {
      wrap.fallback = null;
    },
  };
  wrap.getAttribute = (name) => (name === "data-company" ? company : null);
  wrap.querySelector = (selector) => (selector === ".co-logo--fallback" ? wrap.fallback : null);
  return wrap;
}

function makeDocument(wraps) {
  return {
    querySelectorAll(selector) {
      const m = /^\.co-logo-wrap\[data-company(?:="((?:[^"\\]|\\.)*)")?\]$/.exec(selector);
      if (!m) return [];
      if (m[1] === undefined) return wraps.slice();
      const want = m[1].replace(/\\(.)/g, "$1");
      return wraps.filter((wrap) => wrap.company === want);
    },
    createElement(tag) {
      return {
        tagName: String(tag).toUpperCase(),
        removed: false,
        remove() {
          this.removed = true;
        },
      };
    },
  };
}

function loadCompanyLogo({
  respond = () => jsonResponse({ ok: true, mark: null }),
  hostname = "localhost",
  config,
  scrapeUrl,
  hostedAuth = false,
  wraps = [],
  withCompanyCap = true,
} = {}) {
  const calls = [];
  const record = (via) => (url, init) => {
    calls.push({ via, url: String(url), init });
    return Promise.resolve().then(() => respond(String(url)));
  };
  const win = {
    console,
    location: { hostname, origin: `http://${hostname}:8080`, href: `http://${hostname}:8080/` },
    document: makeDocument(wraps),
    fetch: record("fetch"),
    CSS: { escape: (value) => String(value).replace(/["\\]/g, "\\$&") },
  };
  win.window = win;
  if (config) win.COMMAND_CENTER_CONFIG = config;
  if (scrapeUrl) win.getJobPostingScrapeUrl = () => scrapeUrl;
  if (hostedAuth) win.JobBoredHostedApiAuth = { apiFetch: record("apiFetch") };
  const context = vm.createContext(win);
  vm.runInContext(appUtilsJs, context, { filename: "app-utils.js" });
  if (withCompanyCap) vm.runInContext(companyCapJs, context, { filename: "company-cap.js" });
  const utils = win.JobBoredApp.utils;
  win.JobBoredApp.core = { host: { escapeHtml: utils.escapeHtml, safeHref: utils.safeHref } };
  vm.runInContext(companyLogoJs, context, { filename: "company-logo.js" });
  return { logo: win.JobBoredApp.companyLogo, calls };
}

describe("B14 · company logos come through the server brand-logos route", () => {
  it("should not reference Clearbit anywhere", () => {
    assert.doesNotMatch(companyLogoJs, /clearbit/i);
  });

  it("should look a company up once, however often it renders or resolves", async () => {
    const { logo, calls } = loadCompanyLogo();
    logo.renderLogoHtml({ company: "Stripe, Inc." }, "kanban");
    logo.renderLogoHtml({ company: "Stripe, Inc." }, "drawer");
    logo.renderLogoHtml({ company: "  Stripe " }, "kanban");
    await logo.resolveCompanyLogoUrl("Stripe, Inc.");
    await settle();
    logo.renderLogoHtml({ company: "Stripe, Inc." }, "kanban");
    await settle();
    assert.deepEqual(
      calls.map((c) => [c.via, c.url]),
      [["fetch", lookupUrl(LOCAL_API, "Stripe, Inc.")]],
      "one request, to the local API, for one company",
    );
  });

  it("should draw a resolved PNG mark on the next render and upgrade the placeholders", async () => {
    const wraps = [makeWrap("Stripe, Inc."), makeWrap("Stripe"), makeWrap("Acme")];
    const { logo, calls } = loadCompanyLogo({ wraps, respond: () => markResponse(PNG_SRC) });

    const first = logo.renderLogoHtml({ company: "Stripe, Inc." }, "kanban");
    assert.match(first, /co-logo--fallback/);
    assert.doesNotMatch(first, /<img/);
    await settle();

    const next = logo.renderLogoHtml({ company: "Stripe, Inc." }, "kanban");
    assert.ok(
      next.includes(`<img class="co-logo co-logo--sm" src="${PNG_SRC}"`),
      `expected the mark as an <img>, got ${next}`,
    );
    for (const wrap of wraps.slice(0, 2)) {
      assert.equal(wrap.inserted.length, 1, `placeholder for "${wrap.company}" upgraded`);
      const img = wrap.inserted[0];
      assert.equal(img.tagName, "IMG");
      assert.equal(img.src, PNG_SRC);
      assert.deepEqual(img.className.split(/\s+/), ["co-logo", "co-logo--sm"]);
      assert.equal(img.alt, "");
      assert.equal(wrap.fallback, null, "initials removed");
      img.onerror();
      assert.equal(img.removed, true, "a broken image removes itself");
    }
    assert.equal(wraps[2].inserted.length, 0, "another company's placeholder is untouched");
    assert.equal(calls.length, 1);
  });

  it("should never draw a non-raster or script src from the server", async () => {
    const bad = {
      Acme: "javascript:alert(1)",
      Globex: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      Initech: "data:text/html;base64,PHNjcmlwdD4=",
      Hooli: "https://logo.example.com/hooli.png",
    };
    const wraps = Object.keys(bad).map(makeWrap);
    const { logo, calls } = loadCompanyLogo({ wraps, respond: (url) => markResponse(bad[nameOf(url)]) });
    for (const name of Object.keys(bad)) logo.renderLogoHtml({ company: name }, "kanban");
    await settle();
    for (const name of Object.keys(bad)) {
      const html = logo.renderLogoHtml({ company: name }, "kanban");
      assert.doesNotMatch(html, /<img/, `${name} keeps its initials`);
      assert.ok(!html.includes(bad[name]), `${name}'s src never reaches the HTML`);
    }
    for (const wrap of wraps) assert.equal(wrap.inserted.length, 0, `${wrap.company} placeholder untouched`);
    assert.deepEqual(
      calls.map((c) => c.url),
      Object.keys(bad).map((name) => lookupUrl(LOCAL_API, name)),
    );
  });

  it("should escape a mark src, so markup in it never becomes an attribute", async () => {
    const hostile = 'data:image/png;base64,AAAA" onerror="alert(1)';
    const { logo } = loadCompanyLogo({ respond: () => markResponse(hostile) });
    logo.renderLogoHtml({ company: "Acme" }, "kanban");
    await settle();
    const html = logo.renderLogoHtml({ company: "Acme" }, "kanban");
    assert.ok(html.includes('src="data:image/png;base64,AAAA&quot; onerror=&quot;alert(1)"'), html);
    assert.doesNotMatch(html, /" onerror="/);
  });

  it("should keep initials after a miss, an error or a failed request, and not ask again", async () => {
    const replies = {
      Globex: () => jsonResponse({ ok: true, mark: null }),
      Hooli: () => jsonResponse({ ok: false, error: "logo_lookup_failed" }, 500),
      Initech: () => Promise.reject(new TypeError("Failed to fetch")),
    };
    const wraps = Object.keys(replies).map(makeWrap);
    const { logo, calls } = loadCompanyLogo({ wraps, respond: (url) => replies[nameOf(url)]() });
    for (const name of Object.keys(replies)) logo.renderLogoHtml({ company: name }, "kanban");
    await settle();
    for (const name of Object.keys(replies)) {
      const html = logo.renderLogoHtml({ company: name }, "kanban");
      assert.match(html, /co-logo--fallback/);
      assert.doesNotMatch(html, /<img/);
    }
    await settle();
    assert.deepEqual(
      calls.map((c) => c.url),
      Object.keys(replies).map((name) => lookupUrl(LOCAL_API, name)),
      "each company asked once for the page's life",
    );
    for (const wrap of wraps) assert.equal(wrap.inserted.length, 0);
  });

  it("should use the configured API base and the hosted API transport", async () => {
    const hosted = loadCompanyLogo({
      hostname: "jobbored.example.com",
      scrapeUrl: "https://api.example.com/",
      hostedAuth: true,
    });
    hosted.logo.renderLogoHtml({ company: "Acme & Sons" }, "drawer");
    await settle();
    assert.deepEqual(
      hosted.calls.map((c) => [c.via, c.url]),
      [["apiFetch", lookupUrl("https://api.example.com", "Acme & Sons")]],
    );

    const configured = loadCompanyLogo({
      hostname: "jobbored.example.com",
      config: { jobPostingScrapeUrl: " https://api.example.org// " },
    });
    configured.logo.renderLogoHtml({ company: "Acme" }, "kanban");
    await settle();
    assert.deepEqual(
      configured.calls.map((c) => [c.via, c.url]),
      [["fetch", lookupUrl("https://api.example.org", "Acme")]],
    );
  });

  it("should make no request and keep initials when no API is configured", async () => {
    const { logo, calls } = loadCompanyLogo({ hostname: "someone.github.io" });
    const html = logo.renderLogoHtml({ company: "Acme" }, "kanban");
    await settle();
    assert.match(html, /co-logo--fallback/);
    assert.deepEqual(calls, []);
  });

  it("should still prefer the job's own http(s) logo URL, with no lookup", async () => {
    const { logo, calls } = loadCompanyLogo();
    const html = logo.renderLogoHtml({ company: "Acme", logoUrl: "https://cdn.example.com/acme.png" }, "drawer");
    assert.match(html, /<img class="co-logo co-logo--lg" src="https:\/\/cdn\.example\.com\/acme\.png"/);
    await settle();
    assert.deepEqual(calls, []);
  });

  it("should give the Sheet a portable favicon URL for the company's domain, with no request", async () => {
    const { logo, calls } = loadCompanyLogo();
    const pending = logo.resolveCompanyLogoUrl("Stripe, Inc.");
    assert.equal(typeof pending.then, "function", "callers await it");
    assert.equal(await pending, favicon("stripe.com"));
    assert.equal(await logo.resolveCompanyLogoUrl("Umbrella Co., Ltd."), favicon("umbrella.com"));
    assert.equal(await logo.resolveCompanyLogoUrl("Jane  Street"), favicon("janestreet.com"));
    assert.equal(await logo.resolveCompanyLogoUrl(""), "");
    assert.equal(await logo.resolveCompanyLogoUrl("   "), "");
    assert.equal(await logo.resolveCompanyLogoUrl(null), "");
    await settle();
    assert.deepEqual(calls, []);
  });

  it("should key the favicon the same way when company-cap.js is absent", async () => {
    const withCap = loadCompanyLogo();
    const without = loadCompanyLogo({ withCompanyCap: false });
    for (const name of ["Stripe, Inc.", "STRIPE INC", "Umbrella Co., Ltd.", "Hooli Limited", "Acme Corp."]) {
      assert.equal(
        await without.logo.resolveCompanyLogoUrl(name),
        await withCap.logo.resolveCompanyLogoUrl(name),
        `fallback key for "${name}"`,
      );
    }
  });

  it("should not write a favicon URL the placeholder check would replace", async () => {
    const { logo } = loadCompanyLogo();
    assert.equal(logo.isPlaceholderLogoUrl(await logo.resolveCompanyLogoUrl("Stripe, Inc.")), false);
    assert.equal(logo.isPlaceholderLogoUrl(favicon("linkedin.com")), true);
    assert.equal(logo.isPlaceholderLogoUrl(""), true);
  });
});
