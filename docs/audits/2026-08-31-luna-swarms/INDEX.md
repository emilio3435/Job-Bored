# JobBored Luna MAX swarm audit

Date: 2026-08-31
Branch: `fix/enrichment-offline-hard-gate`
Audited HEAD: `707a59995e89afcc4ca0842a602c3bfae3aaca2e`
Mode: report-only; no product-source fixes

## Outcome

Two 14-lane swarms audited JobBored in parallel:

- Critical swarm: runtime, authentication, Sheets, setup, Pipeline, Dossier, intake, discovery, local operations, server security, worker lifecycle, source lanes, contracts, and cross-cutting browser/accessibility behavior.
- Job-hunter swarm: the same product from first setup through discovery, intake, triage, application materials, submission tracking, recruiter follow-up, closure, reporting, mobile use, privacy, and accessibility.

All 28 lanes ran through the native Codex CLI with `gpt-5.6-luna`, MAX reasoning, a 600,000-token context window, and a read-only sandbox. Model/process routing was checked for every lane. Twenty-seven reports ended `COMPLETE`; C03 ended `BLOCKED` only because its live browser proof was unavailable after its local/static probes completed.

The swarms produced 281 raw defect claims and 111 raw product proposals. Those numbers deliberately include overlapping independent discoveries. The consolidated reports merge duplicate root causes instead of inflating the backlog.

## Top conclusion

JobBored has a broad, capable implementation and a large green deterministic test floor, but it is not currently safe to expose the development dashboard beyond loopback. The highest-risk defect is an independently reproduced arbitrary-file read: encoded traversal requests escape the repository root, the server serves ignored runtime secrets, and the current listener is bound to `*:8080`.

The next largest product risk is state fragmentation. The default experience contains competing Pipeline implementations, multiple profile sources, divergent stage writers, legacy and current setup flows, and several controls whose visible state is more optimistic than the underlying connection or persistence state.

## Deliverables

- [IMPLEMENTATION-ROADMAP.html](IMPLEMENTATION-ROADMAP.html) — tabbed, dependency-aware repair and feature execution plan.
- [CRITICAL-AUDIT.md](CRITICAL-AUDIT.md) — severity-ranked defect register and remediation sequence.
- [JOB-HUNTER-UX-AUDIT.md](JOB-HUNTER-UX-AUDIT.md) — journey-by-journey evaluation and UX recommendations.
- [FEATURE-WISHLIST.md](FEATURE-WISHLIST.md) — prioritized product wishlist with acceptance signals.

Raw lane evidence currently lives under `/private/tmp/jobbored-luna-max-20260831/`, with one report and event stream per lane. That evidence is intentionally outside Git because the lanes were report-only and some captures reflect local runtime state.

## Verification boundary

Verified in this audit:

- All 944 tracked files were included in the repository inventory.
- Approximately 904 button/action/listener hooks were partitioned across the lane matrix.
- The dashboard, scraper/API, and discovery worker were reachable on ports 8080, 3847, and 8644 during the run.
- The full same-HEAD baseline was green before the swarm: 1,843 root tests and 658 discovery-worker tests, with zero skips; repo typecheck and contract gates passed.
- Every lane ran a named floor plus focused probes. Many defects were reproduced through isolated VMs, mock writers, disposable browser fixtures, or live read-only HTTP/browser observations.
- The P0 traversal was independently reproduced by the integration owner against a known non-secret audit file. `lsof` confirmed `*:8080`.

Not fully verified:

- A clean authenticated end-to-end Google OAuth and real-Sheet journey was not run because it would access or mutate user-owned data.
- No paid AI/provider call, real discovery run, real application submission, Telegram confirmation, deployment, or publication was performed.
- Shared-browser contention blocked or weakened some authenticated/mobile proofs. Those gaps are marked `BLOCKED` or `UNAVAILABLE`, not green.
- “Every button” means every current control was inventoried and assigned; it does not mean every destructive, paid, authenticated, or externally mutating button was clicked.

## Audit-side effect

One discovery-setup click unexpectedly took the autodetect-ready branch and issued:

```text
POST http://localhost:8080/__proxy/install-keep-alive -> 200
```

It also recorded a browser installed-state timestamp. The lane stopped interactive clicks immediately. A later read-only status check showed the keep-alive job already installed with a last-run timestamp of 2026-08-04, so this audit cannot prove whether the POST changed the OS artifact or merely re-applied an existing installation. Nothing was uninstalled or rewritten.

## Suggested execution order

1. Contain the dev-server and local control-plane security defects.
2. Unify write paths and run lifecycle invariants before trusting automation.
3. Choose one Pipeline, one stage registry, one profile/intent source, and one setup path.
4. Repair Google/CSP/auth capability truth and discovery readiness truth.
5. Restore the job hunter's daily attention loop, evidence provenance, and explicit application confirmation.
6. Harden mobile/accessibility and make the browser suites release-blocking.

## Repository state

The swarm did not modify product code. The pre-existing user changes were preserved:

```text
 M integrations/hermes-job-hunt/resume-template/logos.json
?? docs/cleanup/
```

This audit directory is the only new repo content created by the integration owner.
