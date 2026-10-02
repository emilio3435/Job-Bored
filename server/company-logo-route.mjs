/**
 * GET /api/brand-logos/company?name=<company> (HOLES B14): the board's
 * company logo, from the brand-logos cache under <logos>/targets, else one
 * bounded, gated resolver run (loadCompanyMark), else null and the board
 * keeps its initials. The browser never asks a third-party logo host.
 *
 * The name comes from the browser (a Sheet cell), so it is cleaned before the
 * lookup: loadCompanyMark takes a parenthetical as the resolver's domain hint
 * (companyDomainHint), and a cell must not choose which site the server
 * fetches. Only a raster image data: URL leaves as a mark. A failed lookup
 * answers a generic error: the loader's messages can carry file paths.
 */
import { loadCompanyMark } from "./brand-logos.mjs";

export const MAX_COMPANY_NAME_LENGTH = 120;

/* The raster types an <img> draws with no script surface; an SVG mark is
   dropped rather than trusted. */
const RASTER_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp);base64,/;

/**
 * @typedef {{ src?: unknown, alt?: unknown, shape?: unknown }} CompanyMark
 * @typedef {(company: string) => Promise<CompanyMark | null | undefined>} LoadMark
 */

/**
 * The company name as the lookup takes it: trimmed, every parenthetical
 * clause removed (the same `(…)` companyDomainHint reads a domain from),
 * whitespace collapsed. "" when the value is not a string, is empty after
 * cleaning, or is longer than MAX_COMPANY_NAME_LENGTH.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanCompanyName(raw) {
  if (typeof raw !== "string") return "";
  const name = raw
    .trim()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name.length <= MAX_COMPANY_NAME_LENGTH ? name : "";
}

/**
 * Mount GET /api/brand-logos/company; the caller's CORS and auth middleware
 * applies. `loadMark` is the lookup (tests pass a stub).
 *
 * @param {Pick<import("express").Application, "get">} app
 * @param {{ loadMark?: LoadMark }} [options]
 */
export function registerCompanyLogoRoute(app, { loadMark = loadCompanyMark } = {}) {
  app.get("/api/brand-logos/company", async (req, res) => {
    const company = cleanCompanyName(req.query.name);
    if (!company) {
      res.status(400).json({ ok: false, error: "invalid_company" });
      return;
    }
    try {
      const mark = await loadMark(company);
      const src = mark && typeof mark.src === "string" && RASTER_DATA_URL.test(mark.src) ? mark.src : "";
      res.json({ ok: true, mark: mark && src ? { src, alt: mark.alt, shape: mark.shape } : null });
    } catch {
      res.status(500).json({ ok: false, error: "logo_lookup_failed" });
    }
  });
}
