import type { RawListing } from "../contracts.ts";
import { toPlainText } from "../browser/selectors/shared.ts";

type FetchImpl = typeof globalThis.fetch;

export type FetchAtsJobResult =
  | { ok: true; rawListing: RawListing }
  | {
      ok: false;
      reason: "not_found" | "http_error" | "parse_error";
      message: string;
      httpStatus?: number;
    };

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
      sourceLabel: "Greenhouse (URL paste)",
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
      sourceLabel: "Lever (URL paste)",
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
      sourceLabel: "Ashby (URL paste)",
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
    response = await fetchImpl(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
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
