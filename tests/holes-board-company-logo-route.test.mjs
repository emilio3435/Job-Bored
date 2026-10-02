/**
 * HOLES BOARD — B14: GET /api/brand-logos/company looks a company's logo up
 * in the server's brand-logos cache (or one bounded resolver run) so the
 * browser never asks a third-party logo host.
 *
 * The browser supplies the name, so the route cleans it first: a
 * parenthetical would become the resolver's domain hint (companyDomainHint),
 * letting a Sheet cell choose which site the server fetches. Only a raster
 * image data: URL leaves as a mark. The loader's errors can carry file paths;
 * the response never does.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cleanCompanyName, registerCompanyLogoRoute } from "../server/company-logo-route.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = "/api/brand-logos/company";
const PNG_SRC =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Register the route on a fake app; every registration is recorded. */
function mountRoute(options) {
  const routes = [];
  const app = {
    get(path, handler) {
      routes.push({ method: "GET", path, handler });
    },
    post(path) {
      routes.push({ method: "POST", path });
    },
    use() {
      routes.push({ method: "USE" });
    },
  };
  registerCompanyLogoRoute(app, options);
  return routes;
}

/** A loadMark stub that records the names it is asked for. */
function stubLoader(result) {
  const calls = [];
  const loadMark = async (company) => {
    calls.push(company);
    return typeof result === "function" ? result(company) : result;
  };
  return { calls, loadMark };
}

async function request(loadMark, query) {
  const [route] = mountRoute({ loadMark });
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await route.handler({ query }, res);
  return res;
}

describe("B14 · GET /api/brand-logos/company", () => {
  it("should register exactly one GET route, with or without a loader", () => {
    assert.deepEqual(
      mountRoute().map((r) => [r.method, r.path]),
      [["GET", ROUTE]],
    );
    assert.deepEqual(
      mountRoute({ loadMark: stubLoader(null).loadMark }).map((r) => [r.method, r.path]),
      [["GET", ROUTE]],
    );
  });

  const INVALID = [
    ["a missing name", {}],
    ["a repeated name", { name: ["Stripe", "Acme"] }],
    ["a non-string name", { name: { toString: "Stripe" } }],
    ["a blank name", { name: "   " }],
    ["a name that is only a parenthetical", { name: " (stripe.com) " }],
    ["a name over 120 characters", { name: "A".repeat(121) }],
  ];
  for (const [label, query] of INVALID) {
    it(`should answer 400 invalid_company for ${label}, without a lookup`, async () => {
      const stub = stubLoader(null);
      const res = await request(stub.loadMark, query);
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { ok: false, error: "invalid_company" });
      assert.deepEqual(stub.calls, []);
    });
  }

  it("should accept a name of exactly 120 characters", async () => {
    const stub = stubLoader(null);
    const res = await request(stub.loadMark, { name: "A".repeat(120) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(stub.calls, ["A".repeat(120)]);
  });

  it("should strip parentheticals and collapse whitespace before the lookup", async () => {
    const stub = stubLoader(null);
    const res = await request(stub.loadMark, {
      name: "  Northwind \t Media (northwind.example.com) Labs (NYC)  ",
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(stub.calls, ["Northwind Media Labs"], "no parenthetical reaches the domain hint");
  });

  /* A trailing domain is a domain hint too (companyDomainHint reads "Acme —
     acme.io", "Acme | acme.io" and "Acme acme.io"), so a scraped company name
     must not reach the lookup with one: it would choose the host the
     server's resolver fetches. */
  const TRAILING = [
    ["Acme metadata.google.internal", "Acme"],
    ["Acme — intranet.example.corp", "Acme"],
    ["Acme | acme.io", "Acme"],
    ["Acme - acme.io", "Acme"],
    ["Acme foo.example.io bar.example.io", "Acme"],
  ];
  for (const [raw, clean] of TRAILING) {
    it(`should look up ${JSON.stringify(raw)} as ${JSON.stringify(clean)}, with no domain hint left`, async () => {
      const stub = stubLoader(null);
      const res = await request(stub.loadMark, { name: raw });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(stub.calls, [clean]);
    });
  }

  it("should keep a name that is itself a domain-like brand", async () => {
    const stub = stubLoader(null);
    await request(stub.loadMark, { name: "Booking.com" });
    assert.deepEqual(stub.calls, ["Booking.com"], "no separator, so no hint and nothing to strip");
  });

  it("should export the same cleaning for direct use", () => {
    assert.equal(cleanCompanyName("Stripe, Inc. (stripe.com)"), "Stripe, Inc.");
    assert.equal(cleanCompanyName("Acme\n  Corp"), "Acme Corp");
    assert.equal(cleanCompanyName("(only.example.com)"), "");
    assert.equal(cleanCompanyName("x".repeat(121)), "");
    assert.equal(cleanCompanyName(42), "");
    assert.equal(cleanCompanyName(undefined), "");
  });

  it("should return only src, alt and shape for a PNG mark", async () => {
    const stub = stubLoader({
      src: PNG_SRC,
      alt: "Northwind Media logo",
      shape: "mark",
      company: "Northwind Media",
      source: "upload",
    });
    const res = await request(stub.loadMark, { name: "Northwind Media" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      ok: true,
      mark: { src: PNG_SRC, alt: "Northwind Media logo", shape: "mark" },
    });
  });

  for (const mime of ["jpeg", "gif", "webp"]) {
    it(`should pass a ${mime} data URL through`, async () => {
      const src = `data:image/${mime};base64,AAAA`;
      const res = await request(stubLoader({ src, alt: "Acme logo", shape: "wordmark" }).loadMark, { name: "Acme" });
      assert.deepEqual(res.body, { ok: true, mark: { src, alt: "Acme logo", shape: "wordmark" } });
    });
  }

  it("should answer mark: null when the lookup finds nothing", async () => {
    const res = await request(stubLoader(null).loadMark, { name: "Acme" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, mark: null });
  });

  const NOT_RASTER = [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/png,not-base64",
    "javascript:alert(1)",
    "https://logo.example.com/acme.png",
    " data:image/png;base64,AAAA",
    "",
    42,
  ];
  for (const src of NOT_RASTER) {
    it(`should answer mark: null for the src ${JSON.stringify(src)}`, async () => {
      const res = await request(stubLoader({ src, alt: "Acme logo", shape: "mark" }).loadMark, { name: "Acme" });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body, { ok: true, mark: null });
    });
  }

  it("should answer a generic 500 when the lookup throws, with no internal detail", async () => {
    const stub = stubLoader(() => {
      throw new Error(
        "EACCES: permission denied, open '/Users/example/.hermes/logos/targets/assets/logo-acme.png'",
      );
    });
    const res = await request(stub.loadMark, { name: "Acme" });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { ok: false, error: "logo_lookup_failed" });
    assert.doesNotMatch(JSON.stringify(res.body), /EACCES|\/Users|hermes/);
  });

  /* server/index.mjs is HOST's file: the integrator wired the import and the
     app call when HOST merged. */
  it("should be mounted by server/index.mjs (integrator wires it)", () => {
    const index = readFileSync(join(repoRoot, "server/index.mjs"), "utf8");
    assert.match(index, /^import \{ registerCompanyLogoRoute \} from "\.\/company-logo-route\.mjs";$/m);
    assert.match(index, /^registerCompanyLogoRoute\(app\);$/m);
  });
});
