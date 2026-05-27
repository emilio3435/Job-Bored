# JHOS Handoff — Phase 7+ : Universal Form Filler & System Hardening

**Context:** Read `~/.hermes/job-hunt/HANDOFF-2026-05-27-session4.md` first for full system state through Phase 6.

**Model recommendation:** claude-opus-4-7 or equivalent for orchestration. Sonnet-class for subagent implementation work.

---

## Why the Phase 7 plan changed

The original Phase 7 plan called for 25+ separate Playwright scripts — one per ATS platform. An LLM council (Opus, Gemini Pro, GPT-5.4 Pro, DeepSeek) identified this as fundamentally brittle:

1. **Forms vary between employers on the same ATS.** Greenhouse Company A has 5 fields; Greenhouse Company B has 15 + custom questions + EEO survey. You'd need thousands of scripts, not 25.
2. **CSS selectors break unpredictably.** ATS platforms update their DOM a few times per year. You won't know a script broke until applications silently fail.
3. **Custom questions are infinite.** No hardcoded keyword matcher covers them. Only an LLM can reason about "Describe a time you led a cross-functional initiative" vs "Are you authorized to work in the US?"
4. **File uploads and dropdowns need Playwright.** Pure vision/computer_use can't reliably handle native `<input type="file">` or `<select>` elements — OS file dialogs are outside the browser DOM.
5. **Maintenance burden.** 25 scripts = 25 things to test weekly. 1 universal agent = 1 thing to test.

**The correct architecture: LLM brain + Playwright hands + DOM eyes + vision fallback.**

---

## Phase 7 — Universal Form Filler Agent

### Architecture

```
┌──────────────────────────────────────────────────┐
│                   AGENT LOOP                      │
│                                                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐ │
│  │ DOM State │──▶│ LLM      │──▶│ Playwright   │ │
│  │ Extractor │   │ Reasoner │   │ Executor     │ │
│  │           │◀──│          │◀──│              │ │
│  └──────────┘   └──────────┘   └──────────────┘ │
│       │              │               │            │
│   a11y tree     Action plan     fill(), click()   │
│   + labels      as JSON         upload(), select()│
│   (cheap)       (~$0.05/app)    (reliable)        │
│                      │                            │
│                      ▼                            │
│              ┌──────────────┐                     │
│              │ Vision       │ ← only when DOM     │
│              │ Fallback     │   extraction or      │
│              │ (screenshot) │   selectors fail     │
│              └──────────────┘                     │
└──────────────────────────────────────────────────┘
```

**ONE agent handles ALL ATS platforms.** No per-ATS scripts. No hardcoded selectors.

### Component 1: Page State Extractor

Runs JavaScript in the page to discover all form elements dynamically:
- Finds all `<input>`, `<textarea>`, `<select>`, `<button>`, `[role="combobox"]`, `[role="listbox"]`, `[contenteditable]`
- For each: extracts tag, type, name, id, label text (from `aria-label`, `placeholder`, `<label for="">`, parent label, or nearest `.field` container label), current value, required flag, options (for selects), visibility
- Generates a stable selector for each element: prefer `#id`, then `[name="..."]`, then structural path
- Also extracts first ~3000 chars of page text for context
- Returns a structured JSON array — no screenshots needed for most forms

**Why this works universally:** Every ATS renders to HTML. Every form has inputs with labels. The extractor doesn't care if it's Greenhouse, Lever, Workday, or a bespoke Django form. It just reads the DOM.

### Component 2: LLM Reasoning Engine

Takes the extracted page state + candidate profile + action history, returns a structured action plan:

```json
[
  {"action": "fill", "selector": "#first_name", "value": "Emilio", "reason": "First name field"},
  {"action": "fill", "selector": "[name='email']", "value": "emilio3435@gmail.com", "reason": "Email field"},
  {"action": "upload", "selector": "input[type='file']", "file": "resume.pdf", "reason": "Resume upload"},
  {"action": "select", "selector": "#how_did_you_hear", "value": "Job Board", "reason": "Referral source"},
  {"action": "fill", "selector": "#custom_question_1", "value": "Yes", "reason": "Work authorization question"},
  {"action": "click", "selector": "button[type='submit']", "reason": "Submit application"}
]
```

The LLM handles:
- Mapping profile fields to form fields by semantic understanding, not selector patterns
- Answering custom questions using reasoning (not keyword matching)
- Deciding what to skip (salary fields → skip per profile constraints)
- Detecting multi-page flows ("click Next" vs "click Submit")
- Recognizing confirmation pages ("done, application submitted")

**Cost:** ~$0.02–0.10 per application (text tokens, not vision). At 10 apps/day = ~$1/day.

### Component 3: Playwright Executor

Executes the LLM's action plan using Playwright's reliable APIs:
- `page.locator(selector).fill(value)` — text fields
- `page.select_option(selector, label=value)` — dropdowns
- `page.set_input_files(selector, path)` — file uploads (ONE LINE, no OS dialog)
- `page.click(selector)` — buttons, radio buttons, checkboxes
- Adds realistic delays between actions (random 0.1–0.5s)
- Catches selector failures and escalates to vision fallback

**Why Playwright, not computer_use, for execution:**
- File uploads via `set_input_files()` bypass the OS file dialog entirely. Vision can't do this.
- `<select>` dropdowns work perfectly. Vision struggles with custom React select components.
- Checkboxes, radio buttons, multi-page navigation — all trivially reliable.
- 10x faster than screenshot → reason → click loops.

### Component 4: Vision Fallback

Only invoked when a selector fails (DOM element present but not interactable, or shadow DOM, or iframe):
- Takes a screenshot
- Asks the LLM for pixel coordinates of the target field
- Uses `page.mouse.click(x, y)` + `page.keyboard.type(value)`
- This is the escape hatch for Workday shadow DOM, custom React components, etc.

### Component 5: Thin Workflow Adapters (3-5 max)

NOT per-ATS form fillers. These handle **workflow quirks only** — login walls, account creation, multi-step navigation patterns that the generic agent can't infer:

| Platform | Adapter handles | Why it's special |
|----------|----------------|-----------------|
| LinkedIn Easy Apply | Login flow, multi-step modal, "Easy Apply" button detection | Requires authenticated session, modal-based UI, anti-bot sensitive |
| Workday | Account creation detection, multi-page wizard (5+ pages), resume parse wait | Email verification wall, shadow DOM, extremely long forms |
| Indeed | "Easy Apply" vs "redirect to employer" detection | Two completely different flows depending on employer config |

These are ~50-100 lines each handling navigation, not field-level selectors. The universal agent handles the actual form filling within each page.

### Component 6: Confidence Gate

**Never auto-submit if:**
- Any required field is unfilled
- A legal/screening answer is ambiguous
- The LLM's confidence is below threshold
- A CAPTCHA is detected
- Validation errors are visible on the page

Route low-confidence applications to a manual review queue (Telegram notification with screenshot + what's stuck).

### Files to create

```
~/.hermes/job-hunt/scripts/
├── universal_filler.py          # The main agent: loop, DOM extract, LLM reason, execute
├── page_state_extractor.js      # JS injected into page to extract form elements
├── ats_adapters/
│   ├── __init__.py
│   ├── linkedin.py              # Login flow + Easy Apply modal navigation
│   ├── workday.py               # Account creation detection + multi-page wizard
│   └── indeed.py                # Easy Apply vs redirect detection
├── filler_profile.py            # Candidate profile + answer strategies
├── greenhouse_filler.py         # DEPRECATED — kept as reference, replaced by universal_filler
└── apply-orchestrator.py        # Updated Step 7: routes to universal_filler
```

### Execution plan

**Batch 1 — Core engine:**
- Agent A: Build `universal_filler.py` with DOM extraction + LLM reasoning + Playwright execution
- Agent B: Build `page_state_extractor.js` and `filler_profile.py` (shared candidate data + answer strategies)
- Agent C: Test universal filler against 3 Greenhouse listings, 1 Lever, 1 Ashby — should work with ZERO ATS-specific code

**Batch 2 — Adapters + fallback:**
- Agent D: LinkedIn Easy Apply adapter (login + modal navigation + universal filler for fields)
- Agent E: Workday adapter (account detection + multi-page + universal filler for fields)
- Agent F: Vision fallback module + anti-detection hardening (stealth JS, realistic timing, headed mode)

**Batch 3 — Integration:**
- Agent G: Wire universal_filler into apply-orchestrator.py, replacing greenhouse_filler
- Agent H: Dry-run integration tests against one real listing per ATS type
- Agent I: Confidence gate + manual review queue (Telegram notification with screenshot)

### Candidate profile for the filler

```python
CANDIDATE = {
    "first_name": "Emilio",
    "last_name": "Nunez-Garcia",
    "email": "emilio3435@gmail.com",
    "phone": "501.366.2080",
    "location": "Denver, CO",
    "linkedin": "https://www.linkedin.com/in/emiliobuilds",
    "website": "https://emiliobuilds.com",
}

ANSWER_STRATEGIES = {
    "work_authorization": "Yes",
    "sponsorship_needed": "No",
    "start_date": "Immediately",
    "referral_source": "Job Board",
    "eeo_gender": "Decline to self-identify",
    "eeo_race": "Decline to self-identify",
    "eeo_veteran": "Decline to self-identify",
    "eeo_disability": "Decline to self-identify",
    "salary": "SKIP",  # Never include compensation per profile constraints
}
```

---

## Phase 8 — Testing & Hardening

### T8.1 — Dry-run test matrix
Run universal_filler with `--dry-run` against one real listing per ATS:
- Greenhouse (boards.greenhouse.io) — 20 in pipeline
- LinkedIn (linkedin.com) — 11 in pipeline
- Ashby (jobs.ashbyhq.com) — 5 in pipeline
- Workday (*.myworkdayjobs.com) — 6 in pipeline
- Lever (jobs.lever.co) — 1 in pipeline
- SmartRecruiters (jobs.smartrecruiters.com) — 2 in pipeline
- Indeed (indeed.com) — 4 in pipeline
- DigitalHire (jobs.digitalhire.com) — 7 in pipeline

Collect: fields filled, fields skipped, screenshots, errors. Target: ≥85% field coverage on first pass.

### T8.2 — First live submission (Greenhouse)
Pick a real Greenhouse role. Run the full orchestrator live (not dry-run). Gate 2 → Emilio confirms → submit → evidence → Pipeline update. Post-mortem.

### T8.3 — Error recovery
- Browser crash mid-fill → retry from last known state
- Gate 2 timeout with partially filled form → screenshot + cancel
- Network drop during file upload → retry upload only
- Add "resume from step N" capability to orchestrator

### T8.4 — Submission guards
- Parallel submission lock (SQLite WAL mode for concurrent safety)
- Rate limiting: max 5 applications/hour, max 20/day
- Duplicate detection: check if already applied via Pipeline Status column
- Cool-down between applications to same company

### T8.5 — Observability
- Structured JSON logs for every agent step (DOM state, LLM decision, action result)
- Screenshot before submit, screenshot after submit
- Per-ATS success/failure metrics
- Weekly report of fill rates by platform

---

## Phase 9 — Auto-Draft Trigger & Pipeline Automation

### T9.1 — Auto-draft on Gate 1 pass
Cron that polls for Researching rows without application folders, then:
1. Fetch JD (try direct URL, fall back to SerpApi cache)
2. Create application folder with job-analysis.md
3. Tailor resume + cover letter from templates
4. Strip scaffolding, render PDFs
5. Run quality gate
6. Notify: "📄 Materials ready for [Title] @ [Company]"

### T9.2 — Batch approvals
- `YES ALL HIGH` → approve all New rows with Fit ≥ 8
- `YES SCORE>=8` → same, explicit threshold
- `PASS ALL OLD` → expire all New rows older than 14 days

### T9.3 — Auto-pilot mode (with Gate 2 as the wall)
Scoring threshold (e.g., Fit ≥ 9 AND Match ≥ 9) → auto-Researching → auto-draft → Gate 2 fires → Emilio confirms → submitted.

### T9.4 — Multi-template resume system
- `~/.hermes/job-hunt/resume-templates/` with named variants
- Template selection by role type: consulting-first, AI-first, performance-first, sales-engineering
- Matching cover letter variants

---

## Phase 10 — Operational Excellence

### T10.1 — Local HTML dashboard
Static HTML file showing: pipeline breakdown, recent submissions, cron health, application inventory, follow-up queue. Regenerated daily by cron.

### T10.2 — Weekly digest
Sunday evening cron: roles applied, response rates, pipeline delta, follow-up actions, recommendations.

### T10.3 — Interview prep automation
When Status → "Phone Screen" or "Interviewing": auto-generate prep doc (likely questions, STAR answers, company research, questions to ask). Notify via Telegram.

### T10.4 — Conversion analytics
Track: New → Researching → Applied → Interview → Offer conversion rates. By ATS platform. By resume positioning. Weekly analytics.

---

## Constraints (unchanged from Phase 6)

- **Gate 2 is the hard wall.** No submission without explicit Telegram confirmation.
- **Never invent facts.** See `~/.hermes/job-hunt/profile/profile.md`.
- **Never include compensation in materials.**
- **Never log or persist the Telegram bot token.**
- **Chrome PDF timeouts are expected.** Check file size, not exit code.
- **Templates must not be modified in place.** Copy first.
- **Strip all scaffolding before PDF rendering.**
- **Central Time for all scheduling.**
- **Thread 48 = submit approvals. Thread 3 = general updates.**

---

## How to start

```
Read ~/.hermes/job-hunt/HANDOFF-2026-05-27-session4.md for system state.
Then read this file for Phase 7+ goals.
Start with Phase 7 Batch 1 — build the universal form filler agent.
```
