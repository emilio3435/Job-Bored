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
- [x] SETUP.md intro links README + AUTOMATION_PLAN (BYO expectations).

**Acceptance:** A new user understands they paste a URL; nobody expects a hosted “discovery API” from the repo owners.

---

## Phase B — Google Apps Script template

**Goal:** Lowest-friction path for users who don’t want a VPS: **one script**, **Deploy as web app**, paste HTTPS URL.

**Deliverables**

- [x] [`integrations/apps-script/`](integrations/apps-script/):
  - [`Code.gs`](integrations/apps-script/Code.gs) — `doPost` JSON v1, optional `ENABLE_TEST_ROW`, sheetId check.
  - [`README.md`](integrations/apps-script/README.md) — deploy steps, **CORS** limitations, link to GitHub Actions workaround.

**Acceptance:** A maintainer can follow only the template README and get a **200** response on **Run discovery** (even if Pipeline rows are TODO).

**Notes:** Real job search logic is user-specific (APIs, TOS); v1 can be **echo + optional append test row** behind a flag.

---

## Phase C — GitHub Actions template

**Goal:** Scheduled discovery **without** an always-on server; uses **user’s** Actions minutes.

**Deliverables**

- [x] [`templates/github-actions/command-center-discovery.yml`](templates/github-actions/command-center-discovery.yml) — `workflow_dispatch` + `schedule`, `curl` + `jq` POST with secrets.
- [x] [`templates/github-actions/README.md`](templates/github-actions/README.md) — secrets, patterns (webhook relay vs direct Sheets API note).

**Acceptance:** User enables workflow in **their** repo; no maintainer infra.

---

## Phase D — Optional one-click deploys

**Goal:** Power users deploy a tiny worker into **their** Cloudflare / Render account from a **Deploy** button.

**Deliverables**

- [x] Minimal Worker ([`templates/cloudflare-worker/`](templates/cloudflare-worker/)) — forwards `POST` JSON to a user-configured `TARGET_URL` (e.g. Apps Script `/exec`); CORS + optional `/forward` + secret.
- [x] README + SETUP link to Worker template (BYO table + best-default paragraph).

**Acceptance:** Clear that **user** owns the account and billing/free tier.

---

## Phase E — Hermes / OpenClaw / n8n polish

**Goal:** Deep integrations stay **optional** and **in-repo**.

**Deliverables**

- [x] [integrations/openclaw-command-center/SKILL.md](integrations/openclaw-command-center/SKILL.md) references `schemaVersion` and `discoveryProfile` (verify on each contract bump).
- [x] [integrations/n8n/README.md](integrations/n8n/README.md) — manual HTTP workflow (no version-fragile JSON export).

**Acceptance:** Skill / workflow docs reference `schemaVersion` and `discoveryProfile`.

---

## Suggested order

1. **Phase A** — tighten SETUP if needed (quick).
2. **Phase B** — Apps Script stub + README (**highest impact per hour**).
3. **Phase C** — GitHub Actions example for daily cron.
4. **Phase E** — integration folder sync when contract evolves.
5. **Phase D** — [`templates/cloudflare-worker/`](templates/cloudflare-worker/) shipped (optional CORS relay).

---

## Out of scope (explicit)

- A **hosted** multi-tenant discovery API paid by maintainers.
- Storing user webhook URLs or secrets on behalf of users without their own deployment.
