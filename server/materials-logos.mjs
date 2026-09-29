/**
 * Materials logo collection and resolution. The claim ledger supplies the
 * organizations; user uploads and the existing Python resolver supply
 * durable marks; an inline SVG monogram is the always-available last tier.
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open as openFile, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import {
  looksLikeImage,
  logoShape,
  runResolver,
  writeLogoManifestFromOrganizations,
} from "./brand-logos.mjs";
import { companyDisplayName, companyDomainHint, companyKey, monogramLogo, targetCompanyOf } from "./materials-monogram.mjs";

const MISS_RETRY_MS = 24 * 60 * 60 * 1000;
const SUCCESS_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const RESOLVER_TIMEOUT_MS = 25_000;
const RESOLVER_TOTAL_BUDGET_MS = 60_000;
const RESOLVER_CONCURRENCY = 3;
const MAX_LOCAL_LOGO_BYTES = 2 * 1024 * 1024;
const BACKGROUND_RESOLUTIONS = new Map();
const NAMED_ORG_FIELDS = [
  "client", "clients", "clientName", "clientNames", "advertiser", "advertisers",
  "advertiserName", "advertiserNames", "namedOrganizations", "organizations",
];
const AGGREGATOR_HOSTS = [
  "linkedin.com", "lnkd.in", "greenhouse.io", "greenhouse.com", "indeed.com",
  "lever.co", "workday.com", "myworkdayjobs.com", "workdayjobs.com", "ashbyhq.com",
  "smartrecruiters.com", "jobvite.com", "icims.com", "ziprecruiter.com", "talent.com",
];
const PLACEHOLDER_HOSTS = new Set(["example.com", "example.org", "example.net"]);

/** @typedef {{ slug: string, name: string, domain?: string, target?: boolean, upload?: unknown }} MaterialLogoOrg */
/** @typedef {import("./materials-render-model-adapter.mjs").ResolvedMark} ResolvedMark */
/** @typedef {Record<string, { path: string, tier: "upload" | "favicon" | "monogram" }>} LogoPathMap */

/** @param {unknown} value */
function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, any>} */ (value)
    : {};
}

/** @param {string} path @param {number} [maxBytes] */
async function readBoundedFile(path, maxBytes = MAX_LOCAL_LOGO_BYTES) {
  let file;
  try {
    file = await openFile(path, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, maxBytes + 1, 0);
    return bytesRead > maxBytes ? null : buffer.subarray(0, bytesRead);
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
}

/** @param {string} root @param {string} relative @param {number} [maxBytes] */
async function readContainedFile(root, relative, maxBytes = MAX_LOCAL_LOGO_BYTES) {
  try {
    const rootReal = await realpath(root);
    const targetReal = await realpath(join(root, relative));
    if (targetReal === rootReal || !targetReal.startsWith(`${rootReal}/`)) return null;
    return await readBoundedFile(targetReal, maxBytes);
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** @param {unknown} raw */
function normalizeDomain(raw) {
  let value = text(raw).toLowerCase();
  if (!value) return "";
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).hostname;
  } catch {
    return "";
  }
  value = value.replace(/^www\./, "").split(/[/?#:\s]/)[0];
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}$/i.test(value)) return "";
  return isAggregator(value) ? "" : value;
}

/** @param {string} name @param {string} domain @param {boolean} target */
function materialIdentitySlug(name, domain, target) {
  const base = companyKey(name) || "company";
  const digest = createHash("sha256").update(`${companyKey(name)}\0${domain}`).digest("hex").slice(0, 16);
  const prefix = target ? "target-" : "";
  return `${prefix}${base.slice(0, 127 - prefix.length - digest.length)}-${digest}`;
}

/** @param {string} domain @param {string} company */
function domainMatchesCompany(domain, company) {
  const key = companyKey(company).replace(/[^a-z0-9]/g, "");
  if (!key) return false;
  const registrableLabel = siteDomain(domain).split(".")[0];
  return registrableLabel.replace(/[^a-z0-9]/g, "") === key;
}

/** @param {string} domain */
function siteDomain(domain) {
  const labels = domain.toLowerCase().split(".");
  const suffix = labels.slice(-2).join(".");
  const multiLabelSuffixes = new Set([
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "edu.au",
    "co.nz", "org.nz", "co.jp", "com.br", "com.mx", "com.sg", "com.my", "com.ph",
    "com.tw", "co.in", "firm.in", "net.in", "org.in", "co.za", "com.tr", "com.cn",
    "com.hk", "com.ar", "com.pl", "com.ua", "com.co", "com.pe",
  ]);
  return multiLabelSuffixes.has(suffix) && labels.length > 2
    ? labels.slice(-3).join(".")
    : suffix;
}

/** @param {string} host */
function isAggregator(host) {
  return AGGREGATOR_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

/** @param {unknown} raw */
function domainFromUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || isAggregator(host) || PLACEHOLDER_HOSTS.has(host)) return "";
    return normalizeDomain(host);
  } catch {
    return "";
  }
}

/** @param {string} domain */
function isReservedExampleDomain(domain) {
  return PLACEHOLDER_HOSTS.has(domain) || domain.endsWith(".example");
}

/** @param {string} content */
function domainsFromPosting(content) {
  const out = [];
  const seen = new Set();
  for (const match of String(content || "").matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const domain = domainFromUrl(match[0].replace(/[.,;!?]+$/, ""));
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      out.push(domain);
    }
  }
  return out;
}

/** @param {unknown} raw @returns {{ name: string, domain: string } | null} */
function namedOrganization(raw) {
  if (typeof raw === "string") {
    const name = raw.trim();
    return name ? { name, domain: companyDomainHint(name) } : null;
  }
  const item = record(raw);
  const name = text(item.name || item.company || item.organization || item.org || item.label || item.client || item.advertiser);
  if (!name) return null;
  const domain = normalizeDomain(item.domain || item.website || item.url) || companyDomainHint(name);
  return { name, domain };
}

/** @param {unknown} claim @param {(name: string, domain: string) => void} add */
function addClaimOrganizations(claim, add) {
  const item = record(claim);
  for (const field of NAMED_ORG_FIELDS) {
    const values = Array.isArray(item[field]) ? item[field] : [item[field]];
    for (const value of values) {
      const parsed = namedOrganization(value);
      if (parsed) add(parsed.name, parsed.domain);
    }
  }
}

/**
 * Collect the ledger's employers and named clients/advertisers, then add the
 * current posting target. `clientNames` and `advertiserNames` are the
 * supported claim fields; source refs can carry the same fields as claims.
 *
 * @param {{ ledger?: unknown, sourceRefs?: unknown, draft?: unknown, model?: unknown, company?: unknown, companyDomain?: unknown, jobUrl?: unknown, postingText?: unknown }} input
 * @returns {MaterialLogoOrg[]}
 */
export function collectMaterialLogoOrgs(input = {}) {
  const ledger = record(input.ledger);
  /** @type {MaterialLogoOrg[]} */
  const orgs = [];
  const byKey = new Map();
  /** @param {unknown} rawName @param {unknown} rawDomain @param {boolean} [target] */
  const add = (rawName, rawDomain = "", target = false) => {
    const name = text(rawName);
    if (!name) return;
    const normalizedName = companyKey(name);
    if (!normalizedName) return;
    const domain = normalizeDomain(rawDomain) || normalizeDomain(companyDomainHint(name));
    const compound = `${target ? "target" : "org"}:${normalizedName}\0${domain}`;
    if (byKey.has(compound)) return;
    const slug = materialIdentitySlug(name, domain, target);
    const org = { slug, name, ...(domain ? { domain } : {}), ...(target ? { target: true } : {}) };
    byKey.set(compound, org);
    orgs.push(org);
  };

  const claims = Array.isArray(ledger.claims) ? ledger.claims : [];
  const employers = Array.isArray(ledger.employers) ? ledger.employers : [];
  for (const raw of employers) {
    const employer = record(raw);
    add(employer.name || employer.company || employer.label, employer.domain || employer.website);
  }
  for (const claim of claims) addClaimOrganizations(claim, add);

  const refs = [input.sourceRefs, record(input.draft).sourceRefs];
  for (const rawRefs of refs) {
    const list = Array.isArray(rawRefs) ? rawRefs : Object.values(record(rawRefs)).flatMap((v) => Array.isArray(v) ? v : []);
    for (const ref of list) {
      const row = record(ref);
      const ids = [text(row.claimId), text(row.claim_id), ...(Array.isArray(row.claimIds) ? row.claimIds.map(text) : [])].filter(Boolean);
      for (const id of ids) {
        const claim = claims.find((item) => text(record(item).id) === id || text(record(item).claimId) === id);
        if (claim) addClaimOrganizations(claim, add);
      }
      addClaimOrganizations(ref, add);
    }
  }

  const model = /** @type {import("./materials-render.mjs").RenderModel} */ (/** @type {unknown} */ (input.model));
  const modelRecord = record(model);
  const resume = record(record(modelRecord.documents).resume);
  for (const section of Array.isArray(resume.sections) ? resume.sections : []) {
    for (const entry of Array.isArray(record(section).entries) ? record(section).entries : []) {
      const org = record(entry);
      add(org.org || org.company, org.domain || companyDomainHint(text(org.org || org.company)));
    }
  }

  const company = text(input.company) || targetCompanyOf(model);
  if (company) {
    const postingDomains = domainsFromPosting(text(input.postingText));
    const hintedDomain = normalizeDomain(companyDomainHint(company));
    const jobDomain = domainFromUrl(input.jobUrl);
    const matchingPostingDomain = postingDomains.find((domain) =>
      domainMatchesCompany(domain, company) || (jobDomain && siteDomain(domain) === siteDomain(jobDomain)));
    const targetDomain = normalizeDomain(input.companyDomain) || hintedDomain ||
      (jobDomain && domainMatchesCompany(jobDomain, company) ? jobDomain : "") || matchingPostingDomain || "";
    add(company, targetDomain, true);
  }
  return orgs;
}

/** @param {unknown} raw */
function safeUploadRelativePath(raw) {
  const value = text(raw);
  if (!value || isAbsolute(value)) return "";
  const normalized = value.replace(/\\/g, "/");
  if (!normalized.startsWith("uploads/") || normalized.split("/").includes("..")) return "";
  return `uploads/${basename(normalized)}`;
}

/** @param {string} path @param {unknown} value */
async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp.${process.pid}.${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  const { rename } = await import("node:fs/promises");
  await rename(temporary, path);
}

/** @param {string} path */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** @param {string} path @param {number} nowMs @param {string} domain */
async function recentMiss(path, nowMs, domain) {
  const parsed = record(await readJson(path));
  if (text(parsed.domain) !== domain || !existsSync(path)) return false;
  const recordedAt = Date.parse(text(parsed.at));
  if (Number.isFinite(recordedAt)) return nowMs - recordedAt < MISS_RETRY_MS;
  try {
    return nowMs - (await stat(path)).mtimeMs < MISS_RETRY_MS;
  } catch {
    return false;
  }
}

/** @param {string} path @param {string} domain @param {number} nowMs */
async function recordMiss(path, domain, nowMs) {
  await writeFile(path, `${JSON.stringify({ at: new Date(nowMs).toISOString(), domain })}\n`, "utf8");
}

/** @param {MaterialLogoOrg[]} orgs @param {string} home @param {Record<string, any>} options */
async function resolveGroup(orgs, home, options) {
  const templateRoot = join(home, "logos", ...(orgs[0]?.target ? ["targets"] : []));
  const assetsDir = join(templateRoot, "assets");
  const uploadsDir = join(templateRoot, "uploads");
  await mkdir(assetsDir, { recursive: true });
  const registeredOrgs = [];
  for (const org of orgs) {
    const uploadSlug = companyKey(org.name);
    const uploadData = await readContainedFile(join(home, "logos", "uploads"), `logo-${uploadSlug}.png`);
    const hasUpload = Boolean(uploadData && looksLikeImage(uploadData));
    const upload = safeUploadRelativePath(org.upload) || (hasUpload ? `uploads/logo-${uploadSlug}.png` : undefined);
    registeredOrgs.push({ ...org, ...(upload ? { upload } : {}) });
  }
  const written = await writeLogoManifestFromOrganizations(
    registeredOrgs.map((org) => ({ slug: org.slug, name: org.name, domain: org.domain, upload: org.upload })),
    { templateRoot },
  );
  const priorBySlug = new Map(written.priorManifest.logos.map((entry) => [entry.slug, entry]));
  const currentBySlug = new Map(written.manifest.logos.map((entry) => [entry.slug, entry]));

  /* Target uploads are stored in the shared uploads folder by the existing
     brand-logo UI; mirror just the selected image into the target resolver
     root so the Python engine keeps its established relative-path contract. */
  if (orgs[0]?.target) {
    await mkdir(uploadsDir, { recursive: true });
    const sharedUploadDir = join(home, "logos", "uploads");
    for (const org of orgs) {
      const entry = currentBySlug.get(org.slug);
      const upload = safeUploadRelativePath(entry?.upload);
      if (!upload) continue;
      const to = join(uploadsDir, basename(upload));
      const data = await readContainedFile(sharedUploadDir, basename(upload));
      if (data && looksLikeImage(data)) await writeFile(to, data);
    }
  }

  /** @type {LogoPathMap} */
  const output = {};
  /** @type {{ org: MaterialLogoOrg, entry: { slug: string, label: string, domain: string }, assetPath: string, monogramPath: string, missPath: string, domainCachePath: string, force: boolean, previousCache: Buffer | null }[]} */
  const work = [];
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  for (const org of orgs) {
    const entry = currentBySlug.get(org.slug);
    const previous = priorBySlug.get(org.slug);
    const upload = safeUploadRelativePath(entry?.upload);
    const uploadBase = org.target ? uploadsDir : join(home, "logos", "uploads");
    const uploadPath = upload ? join(uploadBase, basename(upload)) : "";
    const assetPath = join(assetsDir, `logo-${org.slug}.png`);
    const monogramPath = join(assetsDir, `logo-${org.slug}.svg`);
    const missPath = join(templateRoot, `.miss-${org.slug}`);
    const domainCachePath = join(templateRoot, `.domain-${org.slug}.json`);
    const uploaded = uploadPath && existsSync(uploadPath)
      ? await readContainedFile(uploadBase, basename(upload))
      : null;
    if (uploaded && looksLikeImage(uploaded)) {
      await writeFile(assetPath, uploaded);
      await rm(missPath, { force: true });
      output[org.slug] = { path: assetPath, tier: "upload" };
      continue;
    }

    if (!org.domain || (isReservedExampleDomain(org.domain) && !options.resolveAssets)) {
      const fallback = monogramLogo(org.name);
      await writeFile(monogramPath, Buffer.from(fallback.src.split(",")[1] || "", "base64"));
      output[org.slug] = { path: monogramPath, tier: "monogram" };
      continue;
    }

    const cachedData = existsSync(assetPath) ? await readBoundedFile(assetPath) : null;
    const validCached = Boolean(cachedData && looksLikeImage(cachedData));
    const cachedDomain = record(await readJson(domainCachePath));
    const previousDomain = normalizeDomain(cachedDomain.domain) || normalizeDomain(previous?.domain);
    const domainChanged = previousDomain !== org.domain;
    const checkedAt = Date.parse(text(cachedDomain.checkedAt));
    const cacheFresh = Number.isFinite(checkedAt) && nowMs - checkedAt < SUCCESS_REFRESH_MS;
    const force = Boolean(options.force || (validCached && (domainChanged || (options.remote !== false && !cacheFresh))));
    if (validCached && !domainChanged && (options.remote === false || (!force && cacheFresh))) {
      output[org.slug] = { path: assetPath, tier: "favicon" };
      continue;
    }
    if (options.remote === false) {
      const fallback = monogramLogo(org.name);
      await writeFile(monogramPath, Buffer.from(fallback.src.split(",")[1] || "", "base64"));
      output[org.slug] = { path: monogramPath, tier: "monogram" };
      continue;
    }
    if (!force && await recentMiss(missPath, nowMs, org.domain)) {
      const fallback = monogramLogo(org.name);
      await writeFile(monogramPath, Buffer.from(fallback.src.split(",")[1] || "", "base64"));
      output[org.slug] = { path: monogramPath, tier: "monogram" };
      continue;
    }
    work.push({
      org,
      entry: { slug: org.slug, label: org.name, domain: org.domain },
      assetPath,
      monogramPath,
      missPath,
      domainCachePath,
      force,
      previousCache: validCached ? cachedData : null,
    });
  }

  let cursor = 0;
  async function worker() {
    while (cursor < work.length) {
      const current = work[cursor++];
      const remainingMs = Number.isFinite(options.deadlineAt) ? Number(options.deadlineAt) - Date.now() : Infinity;
      if (remainingMs <= 0) {
        if (current.previousCache) {
          await writeFile(current.assetPath, current.previousCache).catch(() => {});
          output[current.org.slug] = { path: current.assetPath, tier: "favicon" };
        } else {
          const fallback = monogramLogo(current.org.name);
          await writeFile(current.monogramPath, Buffer.from(fallback.src.split(",")[1] || "", "base64")).catch(() => {});
          output[current.org.slug] = { path: current.monogramPath, tier: "monogram" };
        }
        continue;
      }
      const timeoutMs = Math.max(1, Math.min(options.timeoutMs || RESOLVER_TIMEOUT_MS, remainingMs));
      const manifestPath = join(templateRoot, `.materials-logo-${current.org.slug}-${randomUUID()}.json`);
      try {
        await writeJsonAtomic(manifestPath, { logos: [current.entry] });
        const resolveAssets = options.resolveAssets || (/** @param {Record<string, any>} args */ (args) => runResolver({
          templateRoot: args.templateRoot,
          manifestPath: args.manifestPath,
          force: args.force,
          timeoutMs: args.timeoutMs,
          pythonExecutable: options.pythonExecutable || "/usr/bin/python3",
          env: options.env,
          platform: options.platform,
          probeDeveloperTools: options.probeDeveloperTools,
        }));
        const rows = await resolveAssets({
          templateRoot,
          manifestPath,
          entries: [current.entry],
          force: current.force,
          timeoutMs,
        });
        const row = Array.isArray(rows) ? rows.find((item) => item.slug === current.org.slug) : null;
        const data = await readBoundedFile(current.assetPath);
        if (looksLikeImage(data) && row?.source !== "missing" && row?.source !== "monogram") {
          await rm(current.missPath, { force: true });
          await writeJsonAtomic(current.domainCachePath, {
            domain: current.entry.domain,
            checkedAt: new Date(nowMs).toISOString(),
          });
          output[current.org.slug] = { path: current.assetPath, tier: "favicon" };
        } else {
          if (row?.source === "missing") await recordMiss(current.missPath, current.entry.domain, nowMs);
          if (current.previousCache) {
            await writeFile(current.assetPath, current.previousCache);
            output[current.org.slug] = { path: current.assetPath, tier: "favicon" };
          } else {
            const fallback = monogramLogo(current.org.name);
            await writeFile(current.monogramPath, Buffer.from(fallback.src.split(",")[1] || "", "base64"));
            output[current.org.slug] = { path: current.monogramPath, tier: "monogram" };
          }
        }
      } catch {
        const fallbackData = current.previousCache || (existsSync(current.assetPath) ? await readBoundedFile(current.assetPath) : null);
        if (fallbackData && looksLikeImage(fallbackData)) {
          if (current.previousCache) await writeFile(current.assetPath, current.previousCache).catch(() => {});
          output[current.org.slug] = { path: current.assetPath, tier: "favicon" };
        } else {
          const fallback = monogramLogo(current.org.name);
          await writeFile(current.monogramPath, Buffer.from(fallback.src.split(",")[1] || "", "base64")).catch(() => {});
          output[current.org.slug] = { path: current.monogramPath, tier: "monogram" };
        }
      } finally {
        await rm(manifestPath, { force: true }).catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RESOLVER_CONCURRENCY, work.length) }, worker));

  /* A filesystem error in one cache must not turn a document render into a
     logo error. The caller supplies the inline monogram if even its cache
     directory is unavailable. */
  return output;
}

/**
 * Resolve assets under `home/logos/assets` and `home/logos/targets/assets`.
 * The optional resolver seam is for deterministic, network-free verification.
 *
 * @param {{ orgs?: unknown, home?: string, force?: boolean, remote?: boolean, deadlineAt?: number, resolveAssets?: (input: Record<string, any>) => Promise<any[]>, timeoutMs?: number, pythonExecutable?: string, env?: NodeJS.ProcessEnv, platform?: string, probeDeveloperTools?: () => boolean, nowMs?: number }} input
 * @returns {Promise<Record<string, { path: string, tier: "upload" | "favicon" | "monogram" }>>}
 */
export async function resolveLogos(input = {}) {
  const home = resolvePath(text(input.home) || process.env.JOBBORED_HOME || join(homedir(), ".jobbored"));
  /** @type {MaterialLogoOrg[]} */
  const orgs = [];
  for (const raw of Array.isArray(input.orgs) ? input.orgs : []) {
    const row = record(raw);
    const name = text(row.name || row.label);
    const domain = normalizeDomain(row.domain) || normalizeDomain(companyDomainHint(name));
    const target = row.target === true;
    const slug = materialIdentitySlug(name, domain, target);
    if (!name || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(slug)) continue;
    orgs.push({ slug, name, ...(domain ? { domain } : {}), ...(target ? { target: true } : {}), ...(row.upload !== undefined ? { upload: row.upload } : {}) });
  }
  const unique = new Map();
  for (const org of orgs) unique.set(`${org.target ? "target" : "org"}:${org.slug}`, org);
  const normalized = [...unique.values()];
  const employers = normalized.filter((org) => !org.target);
  const targets = normalized.filter((org) => org.target).map((org) => {
    const uploadSlug = companyKey(org.name);
    const sharedUpload = join(home, "logos", "uploads", `logo-${uploadSlug}.png`);
    return existsSync(sharedUpload) ? { ...org, upload: `uploads/logo-${uploadSlug}.png` } : org;
  });
  const options = { ...input };
  if (options.remote !== false && !Number.isFinite(options.deadlineAt)) {
    options.deadlineAt = Date.now() + RESOLVER_TOTAL_BUDGET_MS;
  }
  /* Even an empty ledger must replace a stale root registry with an empty
     list instead of retaining profile-derived entries. */
  const employersResult = await resolveGroup(employers, home, options);
  const targetsResult = targets.length ? await resolveGroup(targets, home, options) : {};
  return { ...employersResult, ...targetsResult };
}

/** @param {MaterialLogoOrg} org @param {{ path: string, tier: "upload" | "favicon" | "monogram" }} result @returns {Promise<ResolvedMark>} */
async function readRenderableMark(org, result) {
  try {
    const data = await readBoundedFile(result.path);
    if (!data || !looksLikeImage(data)) throw new Error("Logo asset exceeded its limit or was not a safe image");
    const ext = result.path.toLowerCase();
    const mime = ext.endsWith(".svg") ? "image/svg+xml" : "image/png";
    return {
      slug: companyKey(org.name) || org.slug,
      label: companyDisplayName(org.name) || org.name,
      domain: org.domain || "",
      src: `data:${mime};base64,${data.toString("base64")}`,
      alt: `${companyDisplayName(org.name) || org.name} logo`,
      shape: logoShape(data),
      ...(result.tier === "monogram" ? { source: "monogram" } : result.tier === "upload" ? { source: "upload" } : {}),
    };
  } catch {
    return { ...monogramLogo(org.name), slug: companyKey(org.name) || org.slug, label: org.name, domain: org.domain || "" };
  }
}

/**
 * Convert cached paths to the render adapter's data-URL marks.
 * @param {MaterialLogoOrg[]} orgs
 * @param {LogoPathMap} logos
 * @returns {Promise<{ marks: ResolvedMark[], targetMark: (import("./materials-render.mjs").Logo & { company?: string }) | null }>}
 */
export async function renderMarksFromLogos(orgs, logos) {
  const marks = [];
  let targetMark = null;
  for (const org of orgs) {
    const result = logos[org.slug];
    if (!result) continue;
    const mark = await readRenderableMark(org, result);
    if (org.target) targetMark = { ...mark, company: org.name };
    else marks.push(mark);
  }
  return { marks, targetMark };
}

/**
 * Prepare all logos for a materials render, including source refs and the
 * posting's target. Any cache or resolver failure becomes an inline monogram.
 *
 * @param {Record<string, any>} input
 * @returns {Promise<{ orgs: MaterialLogoOrg[], logos: LogoPathMap, marks: ResolvedMark[], targetMark: (import("./materials-render.mjs").Logo & { company?: string }) | null }>}
 */
export async function resolveMaterialLogos(input = {}) {
  const orgs = collectMaterialLogoOrgs(input);
  let logos = {};
  try {
    logos = await resolveLogos({ ...input, orgs, remote: false });
  } catch {
    /* Fall through to data-URI monograms so rendering does not depend on the
       writable home directory. */
  }
  const mapped = await renderMarksFromLogos(orgs, logos);
  const result = mapped.targetMark || !orgs.some((org) => org.target)
    ? { orgs, logos, ...mapped }
    : (() => {
      const target = orgs.find((org) => org.target);
      return {
        orgs,
        logos,
        marks: mapped.marks,
        targetMark: target ? { ...monogramLogo(target.name), company: target.name } : null,
      };
    })();
  if (input.backgroundRemote !== false) scheduleBackgroundResolution({ ...input, orgs });
  return result;
}

/** @param {Record<string, any> & { orgs: MaterialLogoOrg[] }} input */
function scheduleBackgroundResolution(input) {
  const home = resolvePath(text(input.home) || process.env.JOBBORED_HOME || join(homedir(), ".jobbored"));
  const deadlineAt = Date.now() + RESOLVER_TOTAL_BUDGET_MS;
  const groups = [
    { namespace: "employers", orgs: input.orgs.filter((org) => !org.target) },
    { namespace: "targets", orgs: input.orgs.filter((org) => org.target) },
  ];
  for (const group of groups) {
    if (!group.orgs.length) continue;
    const identity = group.orgs.map((org) =>
      `${companyKey(org.name)}\0${org.domain || ""}`,
    ).sort().join("\n");
    const key = `${home}\0${group.namespace}\0${createHash("sha256").update(identity).digest("hex")}`;
    if (BACKGROUND_RESOLUTIONS.has(key)) continue;
    const pending = Promise.resolve()
      .then(() => resolveGroup(group.orgs, home, { ...input, orgs: group.orgs, remote: true, deadlineAt }))
      .catch(() => {})
      .finally(() => {
        if (BACKGROUND_RESOLUTIONS.get(key) === pending) BACKGROUND_RESOLUTIONS.delete(key);
      });
    BACKGROUND_RESOLUTIONS.set(key, pending);
  }
}

/**
 * Rebuild and resolve the employer/client registry from the persisted ledger.
 * @param {Record<string, any>} [options]
 */
export async function refreshLogosFromLedger(options = {}) {
  const { readLedger } = await import("./materials-ledger.mjs");
  const loaded = await readLedger();
  if (!loaded.ok) throw new Error(`Cannot refresh logos without a valid materials ledger (${loaded.reason || "unavailable"}).`);
  const orgs = collectMaterialLogoOrgs({ ledger: loaded.ledger }).filter((org) => !org.target);
  let logos;
  try {
    logos = await resolveLogos({ ...options, orgs, remote: false });
  } catch {
    logos = {};
  }
  if (options.backgroundRemote !== false) scheduleBackgroundResolution({ ...options, orgs });
  return logos;
}
