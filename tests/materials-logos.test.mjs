import assert from "node:assert/strict";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectMaterialLogoOrgs, refreshLogosFromLedger, resolveLogos, resolveMaterialLogos } from "../server/materials-logos.mjs";
import { buildLedger } from "../server/materials-ledger-build.mjs";
import { writeLedgerAtomic } from "../server/materials-ledger.mjs";
import { buildStarterTemplate, listStarterTemplateIds } from "../server/user-profile.mjs";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000060000000600806000000e2987738000000017352474200aece1ce90000000049454e44ae426082",
  "hex",
);

describe("materials logo resolution", () => {
  it("resolves 3 employers, 1 client, and 1 target across upload, domain and monogram tiers", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-"));
    try {
      const logoRoot = join(home, "logos");
      await mkdir(join(logoRoot, "uploads"), { recursive: true });
      await writeFile(join(logoRoot, "uploads", "logo-northwind.png"), PNG);
      await writeFile(join(logoRoot, "logos.json"), JSON.stringify({
        logos: [{ slug: "retired-company", label: "Retired Company" }],
      }));
      let resolverCalls = 0;
      const resolveAssets = async ({ templateRoot, entries }) => {
        const rows = [];
        for (const entry of entries) {
          resolverCalls += 1;
          const assets = join(templateRoot, "assets");
          await mkdir(assets, { recursive: true });
          if (entry.upload) {
            await copyFile(join(templateRoot, entry.upload), join(assets, `logo-${entry.slug}.png`));
            rows.push({ slug: entry.slug, source: "upload" });
          } else if (entry.label === "Maple Cloud") {
            await writeFile(join(assets, `logo-${entry.slug}.png`), PNG);
            rows.push({ slug: entry.slug, source: "site" });
          } else if (entry.label === "Stonebridge" || entry.label === "Harbor Fleet") {
            await writeFile(join(assets, `logo-${entry.slug}.png`), PNG);
            rows.push({ slug: entry.slug, source: "favicon" });
          } else {
            rows.push({ slug: entry.slug, source: "missing" });
          }
        }
        return rows;
      };

      const orgs = collectMaterialLogoOrgs({
        ledger: {
          employers: [
            { name: "Northwind" },
            { name: "Maple Cloud", domain: "maple.example" },
            { name: "Stonebridge", domain: "stonebridge.example" },
          ],
          claims: [{ id: "claim-client", clientNames: ["Plover Bikes"] }],
        },
        sourceRefs: [{ claimId: "claim-client" }],
        company: "Harbor Fleet",
        companyDomain: "harborfleet.example",
      });
      const logos = await resolveLogos({ orgs, home, resolveAssets });

      const slug = (name) => orgs.find((org) => org.name === name)?.slug;
      assert.deepEqual(Object.keys(logos).sort(), orgs.map((org) => org.slug).sort());
      assert.equal(logos[slug("Northwind")].tier, "upload");
      assert.equal(logos[slug("Maple Cloud")].tier, "favicon");
      assert.equal(logos[slug("Stonebridge")].tier, "favicon");
      assert.equal(logos[slug("Plover Bikes")].tier, "monogram");
      assert.equal(logos[slug("Harbor Fleet")].tier, "favicon");
      assert.equal(logos[slug("Northwind")].path, join(logoRoot, "assets", `logo-${slug("Northwind")}.png`));
      assert.equal(logos[slug("Harbor Fleet")].path, join(logoRoot, "targets", "assets", `logo-${slug("Harbor Fleet")}.png`));
      assert.equal(logos[slug("Plover Bikes")].path, join(logoRoot, "assets", `logo-${slug("Plover Bikes")}.svg`));
      for (const logo of Object.values(logos)) await readFile(logo.path);

      const employers = JSON.parse(await readFile(join(logoRoot, "logos.json"), "utf8"));
      const targets = JSON.parse(await readFile(join(logoRoot, "targets", "logos.json"), "utf8"));
      assert.deepEqual(employers.logos.map((entry) => entry.slug).sort(), orgs.filter((org) => !org.target).map((org) => org.slug).sort());
      assert.deepEqual(targets.logos.map((entry) => entry.slug), [slug("Harbor Fleet")]);
      assert.ok(!JSON.stringify(employers).includes("retired-company"), "stale profile registry entries are replaced");
      assert.equal(resolverCalls, 3, "only the three domain-backed, non-upload organizations use the resolver");

      resolverCalls = 0;
      await resolveLogos({ orgs, home, resolveAssets });
      assert.equal(resolverCalls, 0, "successful assets are reused from the durable cache");

      resolverCalls = 0;
      const staleFallback = await resolveLogos({
        orgs: [orgs.find((org) => org.name === "Maple Cloud")],
        home,
        force: true,
        resolveAssets: async ({ templateRoot, entries }) => {
          await rm(join(templateRoot, "assets", `logo-${entries[0].slug}.png`), { force: true });
          throw new Error("site is offline during forced refresh");
        },
      });
      assert.equal(staleFallback[slug("Maple Cloud")].tier, "favicon", "a failed refresh keeps a valid prior image");
      assert.deepEqual(await readFile(staleFallback[slug("Maple Cloud")].path), PNG, "the previous validated image survives resolver cleanup");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("uses explicit employer and posting domains, while ATS aggregators do not become target domains", () => {
    const orgs = collectMaterialLogoOrgs({
      ledger: {
        employers: [
          { id: "cedar-role", name: "Cedar Works — cedar.example" },
          { id: "maple-role", name: "Maple Corp" },
        ],
        claims: [
          { id: "claim-1", clientNames: ["Plover Bikes"] },
          { id: "claim-2", advertiser: { name: "Orbit Games", domain: "orbit.example" } },
        ],
      },
      sourceRefs: [{ claimId: "claim-1" }],
      company: "Harbor Fleet",
      jobUrl: "https://boards.greenhouse.io/harbor/jobs/1",
      postingText: "Company site: https://harborfleet.example/careers. Social: https://linkedin.com/company/harbor-fleet.",
    });

    const byName = new Map(orgs.map((org) => [org.name, org]));
    assert.equal(byName.get("Cedar Works — cedar.example").domain, "cedar.example");
    assert.equal(byName.get("Plover Bikes").domain, undefined);
    assert.equal(byName.get("Orbit Games").domain, "orbit.example");
    assert.equal(byName.get("Harbor Fleet").domain, "harborfleet.example");
    assert.equal(byName.get("Harbor Fleet").target, true);
    assert.ok(!orgs.some((org) => /linkedin|greenhouse/i.test(org.domain)));
  });

  it("rejects aggregator domains from employer fields, claims, and companyDomain", () => {
    const orgs = collectMaterialLogoOrgs({
      ledger: {
        employers: [
          { name: "LinkedIn Role", domain: "linkedin.com/company/acme" },
          { name: "Greenhouse Role", website: "https://boards.greenhouse.io/acme" },
          { name: "Lever Role", domain: "jobs.lever.co/acme" },
          { name: "Indeed Role", website: "https://www.indeed.com/cmp/acme" },
          { name: "Workday Role", domain: "acme.myworkdayjobs.com" },
          { name: "Ashby Role", website: "https://jobs.ashbyhq.com/acme" },
        ],
        claims: [{ clientNames: [{ name: "Client Co", url: "https://www.linkedin.com/company/client-co" }] }],
      },
      company: "Target Co",
      companyDomain: "jobs.lever.co/target-co",
    });
    const byName = new Map(orgs.map((org) => [org.name, org]));
    for (const name of ["LinkedIn Role", "Greenhouse Role", "Lever Role", "Indeed Role", "Workday Role", "Ashby Role", "Client Co", "Target Co"]) {
      assert.equal(byName.get(name).domain, undefined, `${name} must not inherit an ATS or aggregator host`);
    }
  });

  it("accepts a posting host only when it matches the company, never the first arbitrary link", () => {
    const orgs = collectMaterialLogoOrgs({
      company: "Harbor Fleet",
      jobUrl: "https://boards.greenhouse.io/harborfleet/jobs/1",
      postingText: "Tracking: https://attacker.example/pixel and https://harborfleet.attacker.example/pixel. Company site: https://harborfleet.example/careers.",
    });
    assert.equal(orgs.find((org) => org.target).domain, "harborfleet.example");
  });

  it("keeps same-name domains and target identities in distinct stable slugs", () => {
    const orgs = collectMaterialLogoOrgs({
      ledger: { employers: [
        { name: "Acme", domain: "client-brand.example" },
        { name: "Acme, Inc.", domain: "acme.example" },
        { name: "Target Acme", domain: "target-acme.example" },
      ] },
      company: "Acme",
      companyDomain: "target.example",
    });
    const acmes = orgs.filter((org) => /^(Acme|Acme, Inc\.)$/.test(org.name));
    assert.equal(acmes.length, 3, "employer names/domains and the target remain separate identities");
    assert.deepEqual(new Set(acmes.map((org) => org.domain)), new Set(["client-brand.example", "acme.example", "target.example"]));
    assert.equal(new Set(acmes.map((org) => org.slug)).size, 3, "identity hashes prevent slug collisions");
    assert.notEqual(orgs.find((org) => org.name === "Target Acme").slug, orgs.find((org) => org.target).slug);
  });

  it("goes straight to durable monograms when there is no domain or upload", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-offline-"));
    let resolverCalls = 0;
    try {
      const orgs = collectMaterialLogoOrgs({
        ledger: {
          employers: [
            { name: "Northwind" },
            { name: "RouteLab" },
            { name: "Maple Cloud" },
          ],
          claims: [{ id: "client", clientNames: ["Plover Bikes"] }],
        },
        company: "Harbor Fleet",
      });
      const logos = await resolveLogos({
        orgs,
        home,
        resolveAssets: async () => { resolverCalls += 1; throw new Error("network resolver must not run"); },
      });
      assert.equal(resolverCalls, 0);
      assert.equal(Object.keys(logos).length, 5);
      assert.ok(Object.values(logos).every((logo) => logo.tier === "monogram"));
      assert.ok(Object.values(logos).every((logo) => logo.path.endsWith(".svg")));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("returns an immediate monogram and dedupes the background logo lookup", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-background-"));
    let enterRemote;
    const remoteEntered = new Promise((resolve) => { enterRemote = resolve; });
    let releaseRemote;
    const remoteGate = new Promise((resolve) => { releaseRemote = resolve; });
    let finishRemote;
    const remoteFinished = new Promise((resolve) => { finishRemote = resolve; });
    let resolverCalls = 0;
    const resolveAssets = async ({ templateRoot, entries }) => {
      resolverCalls += 1;
      enterRemote();
      await remoteGate;
      const assets = join(templateRoot, "assets");
      await mkdir(assets, { recursive: true });
      for (const entry of entries) await writeFile(join(assets, `logo-${entry.slug}.png`), PNG);
      finishRemote();
      return entries.map((entry) => ({ slug: entry.slug, source: "site" }));
    };
    const input = { company: "Harbor Fleet", companyDomain: "harborfleet.example", home, resolveAssets };
    try {
      const first = await resolveMaterialLogos(input);
      assert.equal(first.targetMark.source, "monogram", "draft render uses its immediate local fallback");
      await remoteEntered;
      const second = await resolveMaterialLogos(input);
      assert.equal(second.targetMark.source, "monogram");
      assert.equal(resolverCalls, 1, "an in-flight remote resolution is shared across renders");
      releaseRemote();
      await remoteFinished;
      const next = await resolveMaterialLogos({ ...input, backgroundRemote: false });
      assert.notEqual(next.targetMark.source, "monogram", "a later render reads the completed cache");
    } finally {
      releaseRemote();
      await rm(home, { recursive: true, force: true });
    }
  });

  it("dedupes shared employers while separate target logos resolve in the background", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-shared-background-"));
    let releaseRemote;
    const remoteGate = new Promise((resolve) => { releaseRemote = resolve; });
    const labels = [];
    let resolveThree;
    const threeStarted = new Promise((resolve) => { resolveThree = resolve; });
    const resolveAssets = async ({ templateRoot, entries }) => {
      labels.push(entries[0].label);
      if (labels.length === 3) resolveThree();
      await remoteGate;
      const assets = join(templateRoot, "assets");
      await mkdir(assets, { recursive: true });
      await writeFile(join(assets, `logo-${entries[0].slug}.png`), PNG);
      return [{ slug: entries[0].slug, source: "site" }];
    };
    const common = { home, resolveAssets, ledger: { employers: [
      { name: "Maple Cloud", domain: "maple.example" },
    ] } };
    try {
      const first = await resolveMaterialLogos({ ...common, company: "Harbor Fleet", companyDomain: "harborfleet.example" });
      const second = await resolveMaterialLogos({ ...common, company: "Cedar Works", companyDomain: "cedar.example" });
      assert.equal(first.targetMark.source, "monogram");
      assert.equal(second.targetMark.source, "monogram");
      const reachedAllThree = await Promise.race([
        threeStarted.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 80)),
      ]);
      releaseRemote();
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(reachedAllThree, true, "the employer and both target groups begin without waiting on each other");
      assert.deepEqual(labels.sort(), ["Cedar Works", "Harbor Fleet", "Maple Cloud"]);
    } finally {
      releaseRemote();
      await new Promise((resolve) => setTimeout(resolve, 150));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("returns the profile logo refresh before its remote resolver finishes", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-profile-background-"));
    const priorProfilePath = process.env.JOBBORED_PROFILE_PATH;
    process.env.JOBBORED_PROFILE_PATH = join(home, "profile.json");
    let enterRemote;
    const remoteEntered = new Promise((resolve) => { enterRemote = resolve; });
    let releaseRemote;
    const remoteGate = new Promise((resolve) => { releaseRemote = resolve; });
    let finishRemote;
    const remoteFinished = new Promise((resolve) => { finishRemote = resolve; });
    let didEnterRemote = false;
    const resolveAssets = async () => {
      didEnterRemote = true;
      enterRemote();
      await remoteGate;
      finishRemote();
      return [];
    };
    const profile = buildStarterTemplate(listStarterTemplateIds()[0]);
    profile.experiences = [
      { slug: "northwind", company: "Northwind", title: "Operations Analyst" },
    ];
    // MREV-7: resume text now needs a quote-grounded model structure, so this
    // non-blocking-refresh check builds its ledger from the profile alone.
    const ledger = buildLedger({ profile });
    ledger.employers[0].name = "Northwind (northwind.example)";
    try {
      await writeLedgerAtomic(ledger);
      const refresh = refreshLogosFromLedger({ home, resolveAssets });
      const returnedBeforeRemote = await Promise.race([
        refresh.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 250)),
      ]);
      assert.equal(returnedBeforeRemote, true, "POST /profile's awaited refresh helper performs local work only");
      const backgroundStarted = await Promise.race([
        remoteEntered.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      assert.equal(backgroundStarted, true, "the remote resolver is scheduled after local refresh");
      releaseRemote();
      await remoteFinished;
      await refresh;
    } finally {
      releaseRemote();
      if (didEnterRemote) await Promise.race([remoteFinished, new Promise((resolve) => setTimeout(resolve, 1000))]);
      if (priorProfilePath === undefined) delete process.env.JOBBORED_PROFILE_PATH;
      else process.env.JOBBORED_PROFILE_PATH = priorProfilePath;
      await rm(home, { recursive: true, force: true });
    }
  });

  it("ignores an oversized cached asset using a bounded local read", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-oversize-"));
    try {
      const orgs = collectMaterialLogoOrgs({ ledger: { employers: [
        { name: "Northwind", domain: "northwind.example" },
      ] } });
      const assets = join(home, "logos", "assets");
      await mkdir(assets, { recursive: true });
      await writeFile(join(assets, `logo-${orgs[0].slug}.png`), Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]));
      const resolved = await resolveMaterialLogos({ ledger: { employers: [
        { name: "Northwind", domain: "northwind.example" },
      ] }, home, backgroundRemote: false });
      assert.equal(resolved.marks[0].source, "monogram");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not cache resolver timeouts or disabled Python as definitive misses", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-transient-"));
    try {
      const org = collectMaterialLogoOrgs({ ledger: { employers: [
        { name: "Northwind", domain: "northwind.example" },
      ] } })[0];
      const missPath = join(home, "logos", `.miss-${org.slug}`);
      await resolveLogos({ orgs: [org], home, force: true, resolveAssets: async () => { throw new Error("resolver timeout"); } });
      await assert.rejects(() => access(missPath), { code: "ENOENT" });
      await resolveLogos({ orgs: [org], home, force: true, resolveAssets: async () => [{ slug: org.slug, source: "monogram" }] });
      await assert.rejects(() => access(missPath), { code: "ENOENT" });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("records only definitive not-found results and refreshes successful caches after their TTL", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-cache-ttl-"));
    try {
      const org = collectMaterialLogoOrgs({ ledger: { employers: [
        { name: "Northwind", domain: "northwind.example" },
      ] } })[0];
      const missPath = join(home, "logos", `.miss-${org.slug}`);
      const absent = await resolveLogos({
        orgs: [org], home, nowMs: Date.UTC(2026, 0, 1),
        resolveAssets: async () => [{ slug: org.slug, source: "missing" }],
      });
      assert.equal(absent[org.slug].tier, "monogram");
      await access(missPath);
      let notFoundCalls = 1;
      await resolveLogos({
        orgs: [org], home, nowMs: Date.UTC(2026, 0, 1) + 12 * 60 * 60 * 1000,
        resolveAssets: async () => { notFoundCalls += 1; return [{ slug: org.slug, source: "missing" }]; },
      });
      assert.equal(notFoundCalls, 1, "a definitive miss uses the existing 1-day domain retry");
      await resolveLogos({
        orgs: [org], home, nowMs: Date.UTC(2026, 0, 1) + 25 * 60 * 60 * 1000,
        resolveAssets: async () => { notFoundCalls += 1; return [{ slug: org.slug, source: "missing" }]; },
      });
      assert.equal(notFoundCalls, 2);

      let resolverCalls = 0;
      const resolve = async ({ templateRoot, entries }) => {
        resolverCalls += 1;
        await writeFile(join(templateRoot, "assets", `logo-${entries[0].slug}.png`), PNG);
        return [{ slug: entries[0].slug, source: "site" }];
      };
      const start = Date.UTC(2026, 2, 1);
      await resolveLogos({ orgs: [org], home, force: true, nowMs: start, resolveAssets: resolve });
      const sidecar = JSON.parse(await readFile(join(home, "logos", `.domain-${org.slug}.json`), "utf8"));
      assert.equal(sidecar.checkedAt, new Date(start).toISOString());
      await resolveLogos({ orgs: [org], home, nowMs: start + 29 * 24 * 60 * 60 * 1000, resolveAssets: resolve });
      assert.equal(resolverCalls, 1, "a successful cache remains fresh until its refresh TTL");
      await resolveLogos({ orgs: [org], home, nowMs: start + 31 * 24 * 60 * 60 * 1000, resolveAssets: resolve });
      assert.equal(resolverCalls, 2, "the successful image is refreshed after the configured cache lifetime");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("stops starting remote work after the shared resolver deadline", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-deadline-"));
    try {
      const orgs = collectMaterialLogoOrgs({ ledger: { employers: [
        { name: "Northwind", domain: "northwind.example" },
        { name: "Maple Cloud", domain: "maple.example" },
      ] } });
      let resolverCalls = 0;
      const logos = await resolveLogos({
        orgs, home, deadlineAt: Date.now() - 1,
        resolveAssets: async () => { resolverCalls += 1; return []; },
      });
      assert.equal(resolverCalls, 0);
      assert.ok(Object.values(logos).every((logo) => logo.tier === "monogram"));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("replaces a stale registry with an empty ledger result", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-empty-"));
    const logoRoot = join(home, "logos");
    try {
      await mkdir(logoRoot, { recursive: true });
      await writeFile(join(logoRoot, "logos.json"), JSON.stringify({ logos: [{ slug: "retired" }] }));
      await resolveLogos({ orgs: [], home });
      assert.deepEqual(JSON.parse(await readFile(join(logoRoot, "logos.json"), "utf8")).logos, []);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reuses a target asset after another target rebuilds the target manifest", async () => {
    const home = await mkdtemp(join(tmpdir(), "materials-logos-target-cache-"));
    let resolverCalls = 0;
    const resolveAssets = async ({ templateRoot, entries }) => {
      resolverCalls += 1;
      const entry = entries[0];
      const assets = join(templateRoot, "assets");
      await mkdir(assets, { recursive: true });
      await writeFile(join(assets, `logo-${entry.slug}.png`), PNG);
      return [{ slug: entry.slug, source: "site" }];
    };
    try {
      const target = (name, domain) => ({ name, domain, target: true });
      const north = await resolveLogos({ orgs: [target("Northwind", "north.example")], home, resolveAssets });
      await resolveLogos({ orgs: [target("Southwind", "south.example")], home, resolveAssets });
      resolverCalls = 0;
      const reused = await resolveLogos({ orgs: [target("Northwind", "north.example")], home, resolveAssets });
      assert.equal(resolverCalls, 0);
      assert.equal(reused[Object.keys(north)[0]].tier, "favicon");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
