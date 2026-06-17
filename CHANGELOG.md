# Changelog

All notable changes to JobBored are recorded in the [GitHub Releases](https://github.com/emilio3435/Job-Bored/releases) auto-generated notes. This file exists as a compatibility pointer for tooling that expects a `CHANGELOG.md` at the project root.

## Unreleased

In-flight improvements since the last tagged release:

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
