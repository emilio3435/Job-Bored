import type { AtsSourceId, RawListing } from "../contracts.ts";
import { ATS_SOURCE_IDS } from "../contracts.ts";
import type { AtsProviderRegistry } from "../browser/providers/types.ts";
import { toPlainText } from "../browser/selectors/shared.ts";
import { safeFetch } from "../net/safe-fetch.ts";

type FetchImpl = typeof globalThis.fetch;

export const ATS_PUBLIC_EXECUTABLE_SOURCE_IDS = [
  "greenhouse",
  "lever",
  "ashby",
] as const;

export type AtsPublicExecutableSourceId =
  (typeof ATS_PUBLIC_EXECUTABLE_SOURCE_IDS)[number];

export type FetchAtsJobFailureReason =
  | "not_found"
  | "http_error"
  | "parse_error"
  | "unsupported"
  | "unknown";

export type FetchAtsJobResult =
  | { ok: true; rawListing: RawListing }
  | {
      ok: false;
      reason: FetchAtsJobFailureReason;
      message: string;
      httpStatus?: number;
    };

export type AtsPublicExecution =
  | { status: "executable"; sourceId: AtsPublicExecutableSourceId }
  | { status: "unsupported"; sourceId: AtsSourceId; reason: string }
  | { status: "unknown"; sourceId: string; reason: string };

export type RegisteredAtsSelection = {
  selected: AtsSourceId[];
  unknown: string[];
};

export function isRegisteredAtsSourceId(sourceId: string): sourceId is AtsSourceId {
  return (ATS_SOURCE_IDS as readonly string[]).includes(sourceId);
}

export function selectRegisteredAtsSources(
  requested: readonly string[],
  registry?: Pick<AtsProviderRegistry, "getProvider">,
): RegisteredAtsSelection {
  const selected: AtsSourceId[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const raw of requested) {
    const sourceId = String(raw || "").trim();
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const registered = registry
      ? !!registry.getProvider(sourceId as AtsSourceId)
      : isRegisteredAtsSourceId(sourceId);
    if (registered && isRegisteredAtsSourceId(sourceId)) {
      selected.push(sourceId);
      continue;
    }
    unknown.push(sourceId);
  }
  return { selected, unknown };
}

export function hasRegisteredAtsExecutionLane(
  effectiveSources: readonly string[],
  registry?: Pick<AtsProviderRegistry, "getProvider">,
): boolean {
  return selectRegisteredAtsSources(effectiveSources, registry).selected.length > 0;
}

export function resolveAtsPublicExecution(sourceId: string): AtsPublicExecution {
  const id = String(sourceId || "").trim();
  if ((ATS_PUBLIC_EXECUTABLE_SOURCE_IDS as readonly string[]).includes(id)) {
    return {
      status: "executable",
      sourceId: id as AtsPublicExecutableSourceId,
    };
  }
  if (isRegisteredAtsSourceId(id)) {
    return {
      status: "unsupported",
      sourceId: id,
      reason: `No public ATS JSON fetcher is configured for registered provider "${id}". Use the provider registry browser/public-feed lane instead.`,
    };
  }
  return {
    status: "unknown",
    sourceId: id,
    reason: `"${id}" is not a registered ATS provider.`,
  };
}

export async function fetchAtsJobByRegistry(
  input: { provider: string; slug: string; jobId: string },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<FetchAtsJobResult> {
  const resolved = resolveAtsPublicExecution(input.provider);
  if (resolved.status === "executable") {
    if (resolved.sourceId === "greenhouse") {
      return fetchGreenhouseJob(input, deps);
    }
    if (resolved.sourceId === "lever") {
      return fetchLeverJob(input, deps);
    }
    return fetchAshbyJob(input, deps);
  }
  return {
    ok: false,
    reason: resolved.status,
    message: resolved.reason,
  };
}

export async function fetchGreenhouseJob(
  input: { slug: string; jobId: string },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<FetchAtsJobResult> {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(input.slug)}/jobs/${encodeURIComponent(input.jobId)}`;
  const fetched = await fetchJson(endpoint, fetchImpl);
  if (!fetched.ok) return fetched;

  const body = fetched.body;
  const title = stringField(body, "title");
  if (!title) {
    return {
      ok: false,
      reason: "parse_error",
      message: "Greenhouse response missing title.",
    };
  }

  const applyUrl =
    stringField(body, "absolute_url") ||
    `https://boards.greenhouse.io/${encodeURIComponent(input.slug)}/jobs/${encodeURIComponent(input.jobId)}`;
  const locationObject = objectField(body, "location");
  const location = locationObject ? stringField(locationObject, "name") : "";
  const company =
    stringField(body, "company_name") ||
    stringField(body, "company") ||
    input.slug;
  const descriptionText =
    toPlainText(stringField(body, "content")) ||
    toPlainText(stringField(body, "description"));

  return {
    ok: true,
    rawListing: {
      sourceId: "greenhouse",
      sourceLabel: "Greenhouse",
      providerType: "greenhouse",
      sourceLane: "company_surface",
      title,
      company,
      location: location || undefined,
      url: applyUrl,
      canonicalUrl: applyUrl,
      finalUrl: applyUrl,
      descriptionText: descriptionText || undefined,
      externalJobId: String(input.jobId),
      tags: sanitizeTags([
        ...deriveTitleTags(title),
        ...collectNameFields(arrayObjectsField(body, "departments")),
      ]),
    },
  };
}

export async function fetchLeverJob(
  input: { slug: string; jobId: string },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<FetchAtsJobResult> {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const endpoint = `https://api.lever.co/v0/postings/${encodeURIComponent(input.slug)}/${encodeURIComponent(input.jobId)}?mode=json`;
  const fetched = await fetchJson(endpoint, fetchImpl);
  if (!fetched.ok) return fetched;

  const body = fetched.body;
  const title = stringField(body, "text");
  if (!title) {
    return {
      ok: false,
      reason: "parse_error",
      message: "Lever response missing text/title.",
    };
  }
  const categories = objectField(body, "categories");
  const location = categories ? stringField(categories, "location") : "";
  const applyUrl =
    stringField(body, "hostedUrl") ||
    `https://jobs.lever.co/${encodeURIComponent(input.slug)}/${encodeURIComponent(input.jobId)}`;
  const company =
    stringField(body, "company") ||
    stringField(body, "organization") ||
    input.slug;
  const descriptionText =
    toPlainText(stringField(body, "descriptionPlain")) ||
    toPlainText(stringField(body, "description"));

  return {
    ok: true,
    rawListing: {
      sourceId: "lever",
      sourceLabel: "Lever",
      providerType: "lever",
      sourceLane: "company_surface",
      title,
      company,
      location: location || undefined,
      url: applyUrl,
      canonicalUrl: applyUrl,
      finalUrl: applyUrl,
      descriptionText: descriptionText || undefined,
      externalJobId: String(input.jobId),
      tags: sanitizeTags([
        ...deriveTitleTags(title),
        stringField(categories || {}, "team"),
        stringField(categories || {}, "department"),
        stringField(categories || {}, "commitment"),
      ]),
    },
  };
}

export async function fetchAshbyJob(
  input: { slug: string; jobId: string },
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<FetchAtsJobResult> {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(input.slug)}/${encodeURIComponent(input.jobId)}`;
  const fetched = await fetchJson(endpoint, fetchImpl);
  if (!fetched.ok) return fetched;

  const body = fetched.body;
  const title = stringField(body, "title");
  if (!title) {
    return {
      ok: false,
      reason: "parse_error",
      message: "Ashby response missing title.",
    };
  }
  const applyUrl =
    stringField(body, "jobUrl") ||
    `https://jobs.ashbyhq.com/${encodeURIComponent(input.slug)}/${encodeURIComponent(input.jobId)}`;
  const locationValue = body.location;
  const location =
    typeof locationValue === "string"
      ? locationValue.trim()
      : locationValue &&
          typeof locationValue === "object" &&
          !Array.isArray(locationValue)
        ? stringField(locationValue as Record<string, unknown>, "name")
        : "";
  const company =
    stringField(body, "companyName") ||
    stringField(body, "organizationName") ||
    input.slug;
  const descriptionText =
    toPlainText(stringField(body, "descriptionPlain")) ||
    toPlainText(stringField(body, "description"));

  return {
    ok: true,
    rawListing: {
      sourceId: "ashby",
      sourceLabel: "Ashby",
      providerType: "ashby",
      sourceLane: "company_surface",
      title,
      company,
      location: location || undefined,
      url: applyUrl,
      canonicalUrl: applyUrl,
      finalUrl: applyUrl,
      descriptionText: descriptionText || undefined,
      externalJobId: String(input.jobId),
      tags: sanitizeTags([
        ...deriveTitleTags(title),
        stringField(body, "department"),
        stringField(body, "team"),
        stringField(body, "employmentType"),
      ]),
    },
  };
}

async function fetchJson(
  endpoint: string,
  fetchImpl: FetchImpl,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      reason: "not_found" | "http_error" | "parse_error";
      message: string;
      httpStatus?: number;
    }
> {
  let response: Response;
  try {
    response = await safeFetch(
      endpoint,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      { fetchImpl },
    );
  } catch (error) {
    return {
      ok: false,
      reason: "http_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        ok: false,
        reason: "not_found",
        message: `HTTP ${response.status}`,
        httpStatus: response.status,
      };
    }
    return {
      ok: false,
      reason: "http_error",
      message: `HTTP ${response.status}`,
      httpStatus: response.status,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      reason: "parse_error",
      message: "Response body was not valid JSON.",
      httpStatus: response.status,
    };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      reason: "parse_error",
      message: "Response body must be a JSON object.",
      httpStatus: response.status,
    };
  }
  return { ok: true, body: body as Record<string, unknown> };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function objectField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function arrayObjectsField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
}

function collectNameFields(entries: Record<string, unknown>[]): string[] {
  return entries
    .map((entry) => stringField(entry, "name"))
    .filter(Boolean);
}

function deriveTitleTags(title: string): string[] {
  const clean = title.trim();
  if (!clean) return [];
  const tags: string[] = [];
  const commaParts = clean.split(",").map((part) => part.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    tags.push(commaParts.slice(1).join(", "));
  }
  const seniority = clean.match(
    /\b(Intern|Junior|Associate|Senior|Staff|Principal|Lead|Director|Head|VP|Vice President)\b/i,
  )?.[0];
  if (seniority) tags.push(seniority);
  return tags;
}

function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const value = String(tag || "").replace(/\s+/g, " ").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
