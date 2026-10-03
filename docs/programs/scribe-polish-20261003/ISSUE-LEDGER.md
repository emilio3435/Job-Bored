# SCRP issue ledger: issue → fix → red-first test → candidate evidence → status

**Goal:** map every repair, capability and UX change to its commits, red-first tests and evidence.
**Success means:** every row names commits and tests, real evidence and a status, and every deferred item is listed with its reason.
**Stop when:** the final candidate is frozen.

Evidence sources:
- *Host floor:* commands I ran myself, logged in `PROGRAM-LOG.md`.
- *QA-P2/P3:* Astra browser acceptance (`reports/qa-phase2/`, `reports/qa-phase3/`).
- *R1–R8:* independent review verdicts in `reports/`, alternating Fable and Astra.

All browser evidence uses fictional data, installed Chrome or Chromium, and isolated storage.

## Repairs

| ID | Before (base 3641d33f) | Fix: main commits | Red-first tests | Candidate evidence | Status |
|---|---|---|---|---|---|
| **RISK-01**: Stop vs measuring race | A winning Stop was overwritten to `ready`, and `done` reported `[partial, ready]` | `ea6eca25` terminal claim and ordered queue. `00388821` replay order. `7a8406af`, `a8d704f9` failed write still ends every stream. `13ccf37f` queue release | SCRP-B1/B2/B3, B17, B23, B30 | Host gate E: strict Stop test 20/20 in each of 11 host rounds (220 runs). QA: Stop during checking PASS | ✅ Fixed. Exhaustive race freedom is not claimed |
| **ASTRA-01**: orphaned ready proposal | 6/6 FAIL (generic 409, no controls) | `53a92eba` GET /edits/open. `6daca654` shared eligibility. `cdca3c8c`, `ad5b9752` recovery client. Hardened in R1 #9/#14/#15/#18, R2 #5–#7, R3 #8/#9 | SCRP-B4–B7, F6–F11, F21, F23, F74–F76, F87/F88 | QA-P2/P3: PASS 3/3 per document at 1440 and 375 | ✅ Fixed |
| **ASTRA-02**: Stop before the ID arrives | 2/2 FAIL | `ad5b9752` request identity and late-ID stop. `978ed403`, `61a985c2` settle from server state | SCRP-F22, F77 | QA: PASS. Phone Stop on Chat/Versions fixed (`5f466097`, pre-existing defect) | ✅ Fixed |
| **ASTRA-03**: saved text reported as "Not saved" when the PDF failed | 2/2 FAIL | `d70dd9ac` server metadata, `retryable:false`, sibling PDF kept. `cdca3c8c`, `fc0fe18e` client. D9 copy | SCRP-B8–B10, B15/B16, B28, F3, F12, F24/F25 | Real-PDF gate 4/4. QA: real download and reopen on both documents | ✅ Fixed |
| **ASTRA-04**: stale retry kept the old base | 2/2 FAIL | `fc0fe18e` exact-base install. `9f4e3978` load fence | SCRP-F14, F26 | QA: PASS | ✅ Fixed |
| **ASTRA-05**: safe explanations discarded | FAIL on both documents | `d21a6710`, `f4aa53d2`, `e386d972` server codes. `e0c3d745`, `061bab37`, `a5cbbe97`, `15eeee34` client copy | SCRP-B11–B13, B18/B19, F13, F27/F28, F78 | QA: PASS. 7 writer codes × 2 documents in the real-service browser | ✅ Fixed |

## Capabilities

| ID | Fix | Red-first tests | Evidence | Status |
|---|---|---|---|---|
| **GAP-02 / F1**: selection scope | `d30db904`, `d643fcbd`, plus R2 #11, R3 #3/#11. Keyboard access `765062a5`/`90abfc35` (D25) | Selection and manual units: 0/20 pass on base. F43, F46, F47, F813, F814 | QA-P3: strict keyboard-only journey PASS 4/4 cells; selection payloads PASS | ✅ |
| **GAP-01 / F2**: direct manual edit | `d30db904`, `d643fcbd`, plus D21 batch confirm, D22 spans, D23 role-close drafts, R3/R4/R5/R6 fixes. **D29 (Emilio): blocks holding a locked figure are not directly editable** (`41d90548`/`d012076f`…). Lossless saves `f6537f48`, `e5dbcb36`, plus FIX8 ⏳ | F44, F45, F71–F73, F79–F89, F9x–F13x, B14, B40–B9x | QA-P2/P3: one version, sibling unchanged, plain paste, new-fact confirm, stale draft kept, keyboard edit | ✅ (FIX8 ⏳) |

## UX and copy
`UX-DELTA.md` has 10 before/after rows (all 10 image pairs verified distinct by md5). `COPY-BRIEF.md` holds every string decision.
- **Visual spec:** 29/29.
- **Phone layout:** 44px targets and no sideways scroll, measured by QA.
- **Score modal:** Fix this, Apply and Repair work 24/24.

## Proof lanes

| Lane | Result |
|---|---|
| Live provider (host-run) | Gemini `gemini-flash-latest`, 4/4 fictional requests: ready, accept 200, `edit` provenance, saved model and server preview contain the edit, reopen persists, sibling byte-equal. Checked through the service and the server-rendered preview, not a browser screenshot |
| Real installed-browser PDF | Gate F 4/4, plus QA UI download and reopen check: 1 page, fonts embedded, sibling bytes equal |
| Full `npm test` | Latest 906f2def: 7961/7972 pass, 4 fail, 0 skipped, 7 todo. The failing set is identical to base 3641d33f (logo resolver under RESOLVER=off, submission-record ownership gate, E5 Docker boot) |
| gitleaks | `3641d33f..HEAD`: no leaks |

## Deferred follow-ups (with reason)

| Item | Why deferred |
|---|---|
| AI-path exotic value changes: `38 squared`, `38 trillion`, `38﹒5`, `38 minus 2` (R8 #1) | Present on base, where the AI path only checked that the token was present. SCRP already blocks far more, including all R7 rows and U+2011. Fully closing it needs a semantic numeric comparison rather than more character rules. |
| AI markup cleanup can drop literal `_`, `*` or `<…>` text that was already in the base model (R8 #3, AI side) | Present on base. The manual path is fixed in FIX8. |
| R7 #7–#14 (P3): retry budget for non-pending failures; two phone-hidden manual states; client/server cleanup parity; `numericRun` text parity; duplicated unlocked copy of a locked figure; failure message during recovery reads; missing `Intl.Segmenter` fallback; minor false blocks | Program stop rule after round 7 |
| Safari/WebKit | **Unavailable.** The WebKit 2359 download timed out twice |
| Physical touch, iOS keyboard, screen-reader speech | Unverified. Phone coverage is desktop Chrome emulation at 375px |
| `~/.jobbored/logos`: 7 fictional monogram SVGs plus 2 manifests touched by early test runs | Emilio's call. Isolation fixed at 07:59Z |
| `feat/scribe-widgets-be` | Touches 5 of the same files. Needs a rebase after this lands |
