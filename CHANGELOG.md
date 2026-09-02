# Changelog

All notable changes to JobBored are recorded in the [GitHub Releases](https://github.com/emilio3435/Job-Bored/releases) auto-generated notes. This file exists as a compatibility pointer for tooling that expects a `CHANGELOG.md` at the project root.

## Unreleased

In-flight improvements since the last tagged release:

- **Dossier redesigned as The Case** — status rail, stage stepper, numbers band, evidence board (requirements matched against your resume, ATS scorecard strengths/gaps), live materials, dated record. Replaces the editorial Brief (`role-brief.js`), whose AI prose is reduced to a single line and whose four fixed lists become blocks that only render when the system actually holds the data.
- **Scrape failure recovery** — direct listing scrapes now retry transient connection, response-body, and 5xx failures once; preserve exact Google Jobs fallback; and explain blocked, missing, timed-out, oversized, and unavailable postings with a cause and next action.
- **Job-posting enrichment** — blocked ATS pages (Indeed 401, Lever 404, thin SPAs) now fall back to Google Jobs via SerpApi instead of 502ing with an empty JD. Empty-description caches no longer block a later scrape, and the unreliable `navigator.onLine` gate is gone.
- **ATS-native scraping** — Greenhouse, Lever, Ashby, SmartRecruiters, Workday, Recruitee, Teamtailor, Personio, Pinpoint, Rippling, BambooHR, JazzHR, Gem, Dover, and Homerun job URLs are read from each board's public JSON/XML API before HTML. Unknown career hosts also try same-origin `jobs.json` / `postings.json` / `api/offers` feeds, so Teamtailor/Recruitee custom domains keep working without a new fetcher. Closed Greenhouse jobs that redirect to a careers listing no longer get stored as the JD. After SerpApi misses, the local scraper uses Gemini URL Context (`ATS_GEMINI_API_KEY` / `GEMINI_API_KEY`) as the last lane. Comeet and Freshteam have no public no-auth JD API from the job URL, so they stay on generic HTML / SerpApi / URL Context.
- **Discovery setup reliability** — Step 7 now treats trailing-slash variants as the same live tunnel, while the Cloudflare relay allows and forwards the side-effect-free authentication probe used by the browser connection test.
- **Discovery hardening** — constant-time webhook secret compare, Gemini client timeouts, length caps on ingested payloads, and an ingest safety timer to keep partial runs from blocking forever.
- **Data integrity** — atomic resume save to IndexedDB with honest `VersionError` propagation, plus fixes for fake-IDB hangs and two regex typos in the data-integrity test cluster.
- **Security** — proxy probes gated behind a feature flag, a real CSP on the dashboard, the XSS sink in the discovery drawer removed, and `baseUrl` validation across the network surface.
- **Accessibility (WCAG AA)** — focus traps and labelled inputs across every wizard and modal, plus CTA contrast and reduced-motion respect.
- **Cold-start performance** — body scripts deferred, unused `letter.css` removed, and the resume readers lazy-loaded so the dashboard paints faster.
- **Mobile + auth** — first usable layout at 375 px, 40 px+ tap targets, self-hosted Google Fonts, and honest dead-session surfacing in the login gate.
- **OSS launch hygiene** — issue and PR templates, a Code of Conduct, contributor + security docs, and a `.c8rc.json` coverage floor (see [Maintenance policy](#maintenance-policy)).

## Pre-release history

Tagged releases and their auto-generated notes live on the
[Releases page](https://github.com/emilio3435/Job-Bored/releases). Before
the first tag, this section is the canonical pointer; once v1.0.0 ships,
the release notes become the source of truth and this file stays as a
tooling-compatibility shim.

## Maintenance policy

The project follows a **coverage floor ratchet**: the thresholds in
[`.c8rc.json`](.c8rc.json) only ever go up. When a change lifts coverage
above the current floor, the new floor becomes the gate; once lowered,
never again. This keeps the test suite honest as the codebase grows and
makes "I'll add tests later" a merge blocker instead of a promise.
