/**
 * Employer logos resolve when the resume names the domain after a dash
 * (fix/materials-source-and-logos). The Seabright source wrote
 * "Meridian Insights Group — meridian.example.org"; the key kept the domain
 * ("meridian-insights-group-meridian-example-org"), the lookup had no hint, it missed,
 * and the miss was cached for a week. The resolver is stubbed: no test here
 * touches the network.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { clearStaleLogoMisses, loadCompanyMark, loadEmployerMarks } from "../server/brand-logos.mjs";
import { companyDisplayName, companyDomainHint, companyKey } from "../server/materials-monogram.mjs";
import { critiqueMaterials } from "../server/materials-critic.mjs";
import { matchMark } from "../server/materials-render-model-adapter.mjs";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000060000000600806000000e2987738000000017352474200aece1ce90000000c49444154789c63600000000200015e2f5b1d0000000049454e44ae426082",
  "hex",
);

/**
 * A resolver that finds a mark only through the domain it is given.
 * @param {Record<string, string>} known domain → found
 */
function stubResolver(known = { "meridian.example.org": "meridian" }) {
  /** @type {Array<{ slug: string, label: string, domain: string }>} */
  const jobs = [];
  const resolve = async (/** @type {{ dir: string, slug: string, label: string, domain: string }} */ job) => {
    jobs.push({ slug: job.slug, label: job.label, domain: job.domain });
    if (!known[job.domain]) return [{ slug: job.slug, source: "missing", detail: "" }];
    mkdirSync(join(job.dir, "assets"), { recursive: true });
    writeFileSync(join(job.dir, "assets", `logo-${job.slug}.png`), PNG);
    return [{ slug: job.slug, source: "site", detail: "stub" }];
  };
  return { jobs, resolve };
}

describe("company lines that name a domain", () => {
  it("should take the domain as the hint and drop it from the key and display name", () => {
    for (const line of [
      "Meridian Insights Group — meridian.example.org",
      "Meridian Insights Group – meridian.example.org",
      "Meridian Insights Group - meridian.example.org",
      "Meridian Insights Group | meridian.example.org",
      "Meridian Insights Group meridian.example.org",
      "Meridian Insights Group (meridian.example.org)",
      "Meridian Insights Group — https://www.meridian.example.org/",
    ]) {
      assert.equal(companyDomainHint(line), "meridian.example.org", line);
      assert.equal(companyKey(line), "meridian-insights-group", line);
      assert.equal(companyDisplayName(line), "Meridian Insights Group", line);
    }
  });

  it("should leave names without a trailing domain alone", () => {
    assert.equal(companyDomainHint("Contoso — Austin Market"), "");
    assert.equal(companyKey("Contoso — Austin Market"), "contoso-austin-market");
    assert.equal(companyDisplayName("Booking.com"), "Booking.com");
    assert.equal(companyDomainHint("Booking.com"), "");
    assert.equal(companyKey("AtlasCRM Inc."), "atlascrm");
    assert.equal(companyKey("Contoso (formerly Fabrikam)"), "contoso");
  });

  it("should match the resolved mark to the resume's employer line", () => {
    const marks = [{ slug: "meridian-insights-group", label: "Meridian Insights Group", src: "data:image/png;base64,AA==", alt: "", shape: /** @type {const} */ ("mark") }];
    assert.ok(matchMark(marks, { employerId: "meridian-insights-group-meridian-example-org", org: "Meridian Insights Group — meridian.example.org" }));
  });
});

describe("the critic reads the dash form as the resume's own employer", () => {
  it("should not call 'Name — domain' an invented employer when the resume writes 'Name (domain)'", async () => {
    const card = await critiqueMaterials({
      letterHtml: "<p>hi</p>",
      resumeHtml: '<h2 class="company-name">Meridian Insights Group — meridian.example.org</h2><h2 class="company-name">Globex Corp</h2>',
      jdText: "",
      sourceResumeText: "Founder | Meridian Insights Group (meridian.example.org) — Austin, CO 2024 – Present",
      writerJson: {},
    });
    const invented = card.issues.find((i) => i.code === "invented_employer");
    assert.ok(invented);
    assert.doesNotMatch(invented.message, /Meridian/);
    assert.match(invented.message, /Globex Corp/);
  });
});

describe("the employer logo lookup", () => {
  it("should resolve Meridian Insights Group via meridian.example.org from the dash form", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-domain-"));
    try {
      const { jobs, resolve } = stubResolver();
      const marks = await loadEmployerMarks(["Meridian Insights Group — meridian.example.org"], { templateRoot: root, resolve });
      assert.deepEqual(jobs, [{ slug: "meridian-insights-group", label: "Meridian Insights Group", domain: "meridian.example.org" }]);
      assert.equal(marks.length, 1);
      assert.equal(marks[0].slug, "meridian-insights-group");
      assert.equal(marks[0].domain, "meridian.example.org");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should not let a miss recorded under an old key shape or without the domain block the lookup", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-old-miss-"));
    try {
      const targets = join(root, "targets");
      mkdirSync(targets, { recursive: true });
      /* Both shapes the old code wrote: the domain-in-key miss from the
       * Seabright run, and a plain-timestamp miss under the new key. */
      writeFileSync(join(targets, ".miss-meridian-insights-group-meridian-example-org"), "2026-09-27T21:52:45.354Z\n");
      writeFileSync(join(targets, ".miss-meridian-insights-group"), "2026-09-27T21:52:45.354Z\n");
      const { jobs, resolve } = stubResolver();
      const mark = await loadCompanyMark("Meridian Insights Group — meridian.example.org", { templateRoot: root, resolve });
      assert.ok(mark, "resolved despite the old misses");
      assert.equal(jobs.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should retry a domain-hinted miss after 24 hours and a hint-less miss after a week", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-miss-ttl-"));
    try {
      const nobody = stubResolver({});
      const t0 = Date.parse("2026-09-27T12:00:00.000Z");
      assert.equal(await loadCompanyMark("Acme — acme.example", { templateRoot: root, resolve: nobody.resolve, nowMs: t0 }), null);
      assert.equal(await loadCompanyMark("Pipeworks", { templateRoot: root, resolve: nobody.resolve, nowMs: t0 }), null);
      const missA = join(root, "targets", ".miss-acme");
      const missB = join(root, "targets", ".miss-pipeworks");
      assert.deepEqual(JSON.parse(readFileSync(missA, "utf8")), { at: "2026-09-27T12:00:00.000Z", key: "acme", domain: "acme.example" });
      const recorded = new Date(t0);
      utimesSync(missA, recorded, recorded);
      utimesSync(missB, recorded, recorded);
      nobody.jobs.length = 0;

      await loadCompanyMark("Acme — acme.example", { templateRoot: root, resolve: nobody.resolve, nowMs: t0 + 23 * 3600_000 });
      await loadCompanyMark("Pipeworks", { templateRoot: root, resolve: nobody.resolve, nowMs: t0 + 23 * 3600_000 });
      assert.deepEqual(nobody.jobs, [], "both misses hold inside a day");

      await loadCompanyMark("Acme — acme.example", { templateRoot: root, resolve: nobody.resolve, nowMs: t0 + 25 * 3600_000 });
      await loadCompanyMark("Pipeworks", { templateRoot: root, resolve: nobody.resolve, nowMs: t0 + 25 * 3600_000 });
      assert.deepEqual(nobody.jobs.map((j) => j.slug), ["acme"], "the domain-hinted miss retries after 24 h; the other waits a week");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("clearing stale logo misses", () => {
  it("should remove old-format misses and never touch assets, uploads or logos.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-clear-"));
    try {
      const targets = join(root, "targets");
      mkdirSync(join(targets, "assets"), { recursive: true });
      mkdirSync(join(root, "uploads"), { recursive: true });
      writeFileSync(join(targets, "assets", "logo-contoso.png"), PNG);
      writeFileSync(join(targets, "assets", ".miss-looks-like-a-miss"), "x");
      writeFileSync(join(root, "uploads", "logo-acme.png"), PNG);
      writeFileSync(join(root, "logos.json"), "{}\n");
      writeFileSync(join(targets, ".miss-meridian-insights-group-meridian-example-org"), "2026-09-27T21:52:45.354Z\n");
      writeFileSync(join(targets, ".miss-pipeworks"), `${JSON.stringify({ at: "2026-09-27T22:00:00.000Z", key: "pipeworks", domain: "" })}\n`);

      const dry = await clearStaleLogoMisses({ templateRoot: root, dryRun: true });
      assert.deepEqual(dry.removed, [".miss-meridian-insights-group-meridian-example-org"]);
      assert.ok(existsSync(join(targets, ".miss-meridian-insights-group-meridian-example-org")), "a dry run removes nothing");

      const run = await clearStaleLogoMisses({ templateRoot: root });
      assert.deepEqual(run.removed, [".miss-meridian-insights-group-meridian-example-org"]);
      assert.deepEqual(run.kept, [".miss-pipeworks"], "a miss in the new format stays");
      assert.deepEqual(readdirSync(join(targets, "assets")).sort(), [".miss-looks-like-a-miss", "logo-contoso.png"]);
      assert.ok(existsSync(join(root, "uploads", "logo-acme.png")));
      assert.ok(existsSync(join(root, "logos.json")));

      const all = await clearStaleLogoMisses({ templateRoot: root, before: new Date(Date.now() + 60_000) });
      assert.deepEqual(all.removed, [".miss-pipeworks"], "--before clears newer-format misses written before it");
      assert.ok(existsSync(join(targets, "assets", "logo-contoso.png")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("should do nothing when there is no targets folder", async () => {
    const root = mkdtempSync(join(tmpdir(), "logos-clear-empty-"));
    try {
      assert.deepEqual((await clearStaleLogoMisses({ templateRoot: root })).removed, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
