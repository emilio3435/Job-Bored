# Automation roadmap (free / BYO / no maintainer hosting)

This document is a **maintainer-facing** plan to implement **user-run** discovery automation: templates and docs only — **no** central paid service from project authors.

**Principles**

- Dashboard stays **static OSS**; users bring **Sheet + OAuth + webhook URL**.
- **$0 for maintainers** — we ship **copy-paste** recipes; users deploy into **their** Google account, GitHub org, or free tier.
- **Piece by piece**: each phase is shippable on its own (docs-only is valid).

---

## Phase A — Documentation (done / ongoing)

**Goal:** README and SETUP explain BYO clearly so expectations match reality.

**Deliverables**

- [x] README: **Free automation without maintainer hosting** table + link here.
- [x] [AGENT_CONTRACT.md](AGENT_CONTRACT.md) — webhook JSON and Pipeline contract.
- [ ] SETUP.md: short subsection that mirrors the README table (optional dedupe).

**Acceptance:** A new user understands they paste a URL; nobody expects a hosted “discovery API” from the repo owners.

---

## Phase B — Google Apps Script template

**Goal:** Lowest-friction path for users who don’t want a VPS: **one script**, **Deploy as web app**, paste HTTPS URL.

**Deliverables**

- [ ] `integrations/apps-script/` (or `templates/google-apps-script/`):
  - `Code.gs` (or single-file) that:
    - Exposes `doPost(e)` accepting JSON matching [AGENT_CONTRACT.md](AGENT_CONTRACT.md) (`event`, `schemaVersion`, `sheetId`, `variationKey`, `discoveryProfile`, …).
    - Validates `event === "command-center.discovery"` (optional).
    - Either **queues** work (time-driven trigger) or returns 200 and documents “stub — implement search here”.
  - `README.md`: step-by-step (copy project, authorize Sheets, deploy web app, CORS note if any, paste URL in Settings).

**Acceptance:** A maintainer can follow only the template README and get a **200** response on **Run discovery** (even if Pipeline rows are TODO).

**Notes:** Real job search logic is user-specific (APIs, TOS); v1 can be **echo + optional append test row** behind a flag.

---

## Phase C — GitHub Actions template

**Goal:** Scheduled discovery **without** an always-on server; uses **user’s** Actions minutes.

**Deliverables**

- [ ] `.github/workflows/command-center-discovery.example.yml` (or under `templates/github-actions/`) with:
  - `workflow_dispatch` and `schedule` (cron).
  - Steps: checkout optional script, `curl` POST to user’s own webhook, or call Sheets API with stored secret — **document** two patterns (webhook relay vs direct sheet write).
  - README: fork, set repo secrets, enable Actions.

**Acceptance:** User enables workflow in **their** repo; no maintainer infra.

---

## Phase D — Optional one-click deploys

**Goal:** Power users deploy a tiny worker into **their** Cloudflare / Render account from a **Deploy** button.

**Deliverables**

- [ ] Minimal Worker or Node handler that forwards POST body to a user-configured downstream or logs + 200.
- [ ] README link from main README (optional; higher maintenance).

**Acceptance:** Clear that **user** owns the account and billing/free tier.

---

## Phase E — Hermes / OpenClaw / n8n polish

**Goal:** Deep integrations stay **optional** and **in-repo**.

**Deliverables**

- [ ] Keep [integrations/openclaw-command-center/](integrations/openclaw-command-center/) in sync with [AGENT_CONTRACT.md](AGENT_CONTRACT.md) when webhook schema changes.
- [ ] Optional: `integrations/n8n/` export JSON for “Run discovery” webhook.

**Acceptance:** Skill / workflow docs reference `schemaVersion` and `discoveryProfile`.

---

## Suggested order

1. **Phase A** — tighten SETUP if needed (quick).
2. **Phase B** — Apps Script stub + README (**highest impact per hour**).
3. **Phase C** — GitHub Actions example for daily cron.
4. **Phase E** — integration folder sync when contract evolves.
5. **Phase D** — only if demand is high (more moving parts).

---

## Out of scope (explicit)

- A **hosted** multi-tenant discovery API paid by maintainers.
- Storing user webhook URLs or secrets on behalf of users without their own deployment.
