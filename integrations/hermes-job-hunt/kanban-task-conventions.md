# Kanban Task Conventions — JHOS Agent Work Queue

> **Role:** Hermes Kanban is the **agent work queue only**. The Google Sheet Pipeline tab is the source of truth for human-facing job tracking. Kanban cards drive agent execution; they do not replace pipeline rows.

---

## Card Type Reference

| Type | Purpose | Assigned To |
|------|---------|-------------|
| `DISCOVER` | Find new jobs matching Emilio's profile, write deduped rows to Pipeline | `default` profile orchestrates; JobBored worker executes discovery/writeback |
| `RESEARCH` | Deep-dive on a specific job/company — score, summarize, assess fit | `default` / Opus 4.7 |
| `DRAFT` | Generate application materials — resume tailor, cover letter, talking points | `default` / GPT-5.5 |
| `APPLY` | Orchestrate the apply pipeline: draft → approval → assisted fill → submit only after guard passes | `default` |
| `FOLLOWUP` | Send follow-up messages: thank-you, check-in, withdrawal, rejection response | `default` |

---

## Required Body Fields

Every card body must include:

```
**Job / Company:** [Job title] at [Company name]
**Pipeline Row:** [Row # if known, or "New — pending Pipeline write"]
**Link:** [Job posting URL]
**Source:** [How it was found — Google Jobs, LinkedIn, GreenHouse, etc.]
**Priority:** [High / Medium / Low]
**Notes:** [Any context the agent needs]
**Profile refs:** [Confirm canonical profile docs read before work begins]
```

### DISCOVER-specific fields

```
**Search queries:** [Keywords + location used]
**Filters applied:** [Remote, salary range, date posted, etc.]
**Targets:** [Companies or roles targeted]
```

### RESEARCH-specific fields

```
**Fit Score:** [1–10 target]
**Key concerns to resolve:** [Specific questions the research should answer]
**Competitive landscape:** [Any known competing candidates or requirements]
```

### DRAFT-specific fields

```
**Pipeline Row:** [Row #]
**Materials needed:** [Resume / Cover Letter / Recruiter Notes / Talking Points — list which]
**JD keywords:** [Top 5–10 keywords from the job description]
**Fit rationale:** [Why Emilio is a strong fit — 1–2 sentences]
```

### APPLY-specific fields

```
**Pipeline Row:** [Row #]
**Pipeline status before:** [e.g. "Researched"]
**Status after apply:** [e.g. "Applied"]
**Submission method:** [Greenhouse / Lever / LinkedIn Easy Apply / etc.]
**Approval status:** [Must be "Approved" in the chosen Pipeline approval marker before submit; current A–T schema needs explicit approval-field decision]
**Idempotency key:** [Normalized job URL — prevents double-apply]
```

### FOLLOWUP-specific fields

```
**Pipeline Row:** [Row #]
**Followup type:** [Thank-You / Check-In / Withdrawal / Rejection Response / Other]
**Timing:** [Send immediately / Send on date / Send N days after interview]
**Template:** [Which template from `skills/followup-templates.md`]
**Channel:** [Email / LinkedIn / In-platform]
```

---

## Status Mapping

Kanban board columns map to card lifecycle:

```
Backlog     → todo     — Received, not yet claimed
Ready       → ready    — Dispatched, worker has it queued
In Progress → running  — Worker actively executing
Done        → done     — Completed successfully
Archived    → archived — Invalid / duplicate / superseded
```

**Status → Pipeline mapping rules:**

| Kanban Action | Pipeline Effect |
|--------------|-----------------|
| DISCOVER complete | Write new row (status: `Discovered`) |
| RESEARCH complete | Update row (status: `Researched`); write Fit Score to Match Score column |
| DRAFT complete | No Pipeline write — materials go to task comment or file |
| APPLY complete | Update row (status: `Applied`); screenshot evidence attached to card |
| FOLLOWUP complete | Update row (status: `Followed Up`) |

**Kanban never advances Pipeline past `Approved` without human confirmation.**

---

## Priority Convention

Set at card creation; used by dispatcher as tiebreaker when multiple cards are `ready`:

| Priority | Use case |
|----------|---------|
| `90` | Time-sensitive: morning brief, interview follow-up |
| `75` | High-fit discovery finds |
| `60` | Normal apply flow |
| `50` | Research / materials drafting |
| `30` | General discovery |
| `10` | Low-urgency / backfill |

---

## Parent / Child Linking

Use `parents` to express hard dependencies:

- DISCOVER → RESEARCH (a research card waits for the discovery that spawned it)
- RESEARCH + DRAFT → APPLY (apply waits for research + materials)
- APPLY → FOLLOWUP (followup spawned after apply succeeds)

Never assign the same card as a child of itself. Only link cards created in this run.

---

## Idempotency

To prevent duplicate work across runs:

- **DISCOVER:** Dedupe by normalized job URL in Pipeline before writing.
- **RESEARCH:** Use job URL as idempotency key; skip if `Researched` or later in Pipeline.
- **APPLY:** Check Pipeline status + idempotency key before attempting submit. Never re-apply to a row already `Applied` or later.
- **FOLLOWUP:** Skip if Pipeline status is already `Followed Up` for that type.

---

## Artifact Handling

Do not store application materials in Kanban card body text. Write materials to:

```
~/.hermes/job-hunt/applications/{company-slug}/
  ├── resume-tailored.pdf
  ├── cover-letter.pdf
  ├── recruiter-notes.md
  └── talking-points.md
```

Link the artifact path in the card comment for downstream agents to retrieve.

---

## Example Cards

### DISCOVER

```
**Job / Company:** —
**Pipeline Row:** New — pending Pipeline write
**Link:** —
**Source:** Google Jobs / SerpApi
**Priority:** 75
**Notes:** Morning discovery pass. Target: Denver + remote digital marketing roles.
**Profile refs:** ~/.hermes/job-hunt/profile/{profile.md,voice.md,resume-bullets.md,job-preferences.md}

**Search queries:** ["senior digital marketing manager Denver remote", "performance marketing director Colorado"]
**Filters applied:** Remote OK, salary provided, posted < 14 days
**Targets:** AI-forward dev shops, CDLE platforms, vibe coding tools
```

### RESEARCH

```
**Job / Company:** Senior SEM Manager at Vercel
**Pipeline Row:** #47
**Link:** https://boards.greenhouse.io/vercel/jobs/1234
**Source:** Greenhouse (discovered via DISCOVER card)
**Priority:** 60
**Notes:** Evaluate fit against Emilio's profile. Focus on B2B SaaS experience + GCP/Vertex AI exposure.
**Profile refs:** ~/.hermes/job-hunt/profile/{profile.md,voice.md,resume-bullets.md,job-preferences.md}

**Fit Score:** [1–10]
**Key concerns to resolve:** Does the role require active deal-closing quota? Is it truly remote?
**Competitive landscape:** Senior role — expect 5+ years SEM experience required.
```

### DRAFT

```
**Job / Company:** Senior SEM Manager at Vercel
**Pipeline Row:** #47
**Link:** https://boards.greenhouse.io/vercel/jobs/1234
**Source:** Research complete (see RESEARCH card)
**Priority:** 60
**Notes:** Use directional-prompting hooks for cover letter framing.
**Profile refs:** ~/.hermes/job-hunt/profile/{profile.md,voice.md,resume-bullets.md,job-preferences.md}

**Materials needed:** [Resume, Cover Letter, Talking Points]
**JD keywords:** ["Google Ads", "B2B SaaS", "performance max", "campaign optimization", "Vertex AI"]
**Fit rationale:** Emilio managed $2M+ SEM budgets at Audacy; strong GCP/Vertex AI exposure from elio-intelligence-suite work.
```

### APPLY

```
**Job / Company:** Senior SEM Manager at Vercel
**Pipeline Row:** #47
**Link:** https://boards.greenhouse.io/vercel/jobs/1234
**Source:** DRAFT complete
**Priority:** 60
**Notes:** Greenhouse fill. Submit lock must hold until Pipeline `Approval Status` = `Approved` + dedicated submit-approval thread confirmation received. Gate 2 delivery target: `telegram:-1003800236296:48` (thread 48, derived from https://t.me/c/3800236296/48/50).
**Profile refs:** ~/.hermes/job-hunt/profile/{profile.md,voice.md,resume-bullets.md,job-preferences.md}

**Pipeline status before:** Drafted
**Status after apply:** Applied
**Submission method:** Greenhouse
**Approval status:** Must be "Approved" in Pipeline
**Idempotency key:** greenhouse-vercel-1234
**Artifacts:** ~/.hermes/job-hunt/applications/vercel-senior-sem/
```

### FOLLOWUP

```
**Job / Company:** Digital Director at CDLE (Colorado)
**Pipeline Row:** #31
**Link:** https://cdle.co/jobs/digital-director
**Source:** Applied via APPLY card
**Priority:** 90
**Notes:** Interview 3 days ago — send thank-you within 24 hours.
**Profile refs:** ~/.hermes/job-hunt/profile/{profile.md,voice.md,resume-bullets.md,job-preferences.md}

**Followup type:** Thank-You
**Timing:** Send within 24 hours of interview
**Template:** skills/followup-templates.md#thank-you
**Channel:** Email
**Pipeline status before:** Applied
**Idempotency key:** cdle-digital-director-followup-thankyou-2026-05-26
```

---

## Approved Operating Decisions (2026-05-26)

- Kanban is the **agent work queue only** — not the main application board and not a custom database schema.
- Google Sheet Pipeline tab is the human-facing source of truth.
- No Kanban action may advance Pipeline past `Approved` without explicit human confirmation.
- Application submission is blocked until the approval guard (`skills/job-approval.md`) exists.
- `computer_use` may assist browser fill, but no submit automation is allowed until the approval guard exists and the approval field is explicitly chosen.
- Workday discovery only through Google Jobs/SerpApi-style links, not direct automation.