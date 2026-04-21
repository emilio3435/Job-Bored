import type { AtsSourceId } from "../contracts.ts";
import { isPrivateOrLoopbackHost } from "../discovery/career-surface-resolver.ts";
import {
  AGGREGATOR_HOST_SIGNATURES,
  ATS_HOST_SIGNATURES,
} from "./host-signatures.ts";

export type ClassifiedIngestUrl =
  | { kind: "invalid"; host: ""; message: string }
  | { kind: "private_network"; host: string }
  | { kind: "blocked_aggregator"; host: string; provider: string }
  | {
      kind: "ats_direct";
      host: string;
      provider: AtsSourceId;
      slug: string;
      jobId: string;
    }
  | { kind: "generic_https"; host: string };

export function classifyIngestUrl(url: string): ClassifiedIngestUrl {
  const raw = String(url || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { kind: "invalid", host: "", message: "URL must be valid." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      kind: "invalid",
      host: "",
      message: "Only http(s) URLs are allowed.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      kind: "invalid",
      host: "",
      message: "URL must not contain username/password credentials.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { kind: "invalid", host: "", message: "URL must include a host." };
  }

  if (isPrivateOrLoopbackHost(host)) {
    return { kind: "private_network", host };
  }

  for (const signature of AGGREGATOR_HOST_SIGNATURES) {
    if (signature.match.test(host)) {
      return {
        kind: "blocked_aggregator",
        host,
        provider: signature.provider,
      };
    }
  }

  for (const signature of ATS_HOST_SIGNATURES) {
    if (!signature.match.test(host)) continue;
    const parsedIdentity = extractAtsIdentity(signature.provider, parsed);
    if (parsedIdentity) {
      return {
        kind: "ats_direct",
        host,
        provider: signature.provider,
        slug: parsedIdentity.slug,
        jobId: parsedIdentity.jobId,
      };
    }
    return { kind: "generic_https", host };
  }

  return { kind: "generic_https", host };
}

function extractAtsIdentity(
  provider: AtsSourceId,
  parsed: URL,
): { slug: string; jobId: string } | null {
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname
    .split("/")
    .map((entry) => safeDecode(entry).trim())
    .filter(Boolean);

  if (provider === "greenhouse") {
    // boards.greenhouse.io/<slug>/jobs/<jobId>
    if (host !== "boards.greenhouse.io") return null;
    if (segments.length < 3 || segments[1] !== "jobs") return null;
    const slug = segments[0] || "";
    const jobId = segments[2] || "";
    return slug && jobId ? { slug, jobId } : null;
  }

  if (provider === "lever") {
    // jobs.lever.co/<slug>/<jobId>
    if (host !== "jobs.lever.co") return null;
    if (segments.length < 2) return null;
    const slug = segments[0] || "";
    const jobId = segments[1] || "";
    return slug && jobId ? { slug, jobId } : null;
  }

  if (provider === "ashby") {
    // jobs.ashbyhq.com/<slug>/<jobId>
    if (host !== "jobs.ashbyhq.com") return null;
    if (segments.length < 2) return null;
    const slug = segments[0] || "";
    const jobId = segments[1] || "";
    return slug && jobId ? { slug, jobId } : null;
  }

  if (provider === "workable") {
    // apply.workable.com/<slug>/j/<jobId>
    if (host !== "apply.workable.com") return null;
    if (segments.length < 3 || segments[1] !== "j") return null;
    const slug = segments[0] || "";
    const jobId = segments[2] || "";
    return slug && jobId ? { slug, jobId } : null;
  }

  return null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
