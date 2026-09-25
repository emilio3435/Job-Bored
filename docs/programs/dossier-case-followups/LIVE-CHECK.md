# Live check · Case People writebacks

Sixty seconds, one role, four edits, four cells. This is the only proof that cannot be automated: the Playwright spec intercepts `sheets.googleapis.com` and never touches your Sheet.

Do this once, signed in, on the real Pipeline tab.

## 1. Pick the role

Open JobBored, open **The Case** for any role you are willing to dirty. Note the **Title** and **Company** in the navy rail — that is how you find the row in the Sheet.

The automated spec uses the second seeded card (`openRole.set("1")`). On your board, any open Case is the same four controls.

## 2. Make the four edits, in this order

Stay in the Case **People** block (Your moves → People). Do not use the kanban card.

| # | Control | What to do | Sheet cell |
|---|---|---|---|
| 1 | **Follow-up** date input | Set it to `2026-09-10`. Tab out or click away if the picker does not commit on its own. | **P** of that row |
| 2 | **Replied** | Click **Yes**. (Toggle today; segmented `YES · NO · UNKNOWN` after lane A. Same `data-field="reply"`.) | **S** of that row |
| 3 | **Last contact** | Type `2026-09-01`, then click outside the field. | **R** of that row |
| 4 | **Contact** | Type `Dana Reyes`, then click outside the field. | **L** of that row |

After each edit you should see a quiet success — no error toast. If lane A has landed, a mint `saved` mark flashes on the row.

## 3. Look at the Sheet

In Google Sheets → **Pipeline** tab → the row whose Title/Company match the rail:

| Column | Header | Must now be |
|---|---|---|
| **P** | Follow-up Date | `2026-09-10` |
| **S** | Did they reply? | `Yes` |
| **R** | Last contact | `2026-09-01` |
| **L** | Contact | `Dana Reyes` |

That is the whole proof. Four cells, four values, same order as `tests/e2e-journey/case-people-writeback.spec.mjs`.

## 4. What failure looks like

A red toast from `flowing-writes.js`. The template is `Couldn't save {label}: {error}`:

| Edit that failed | Toast |
|---|---|
| Follow-up | `Couldn't save follow-up date: …` |
| Replied | `Couldn't save reply status: …` |
| Last contact | `Couldn't save last contact: …` |
| Contact | `Couldn't save contact: …` |

Common `{error}` suffixes:

- `Not signed in` — no OAuth token in this tab. Sign in again.
- `No spreadsheet configured` — Sheet ID missing from settings.
- `HTTP 401` / Google’s own message — token expired or missing Sheets scope. Sign in again and grant `spreadsheets`.
- `Could not resolve jobKey to a Pipeline row: …` — that card is not a Sheet row (demo data). Use a role that came from your Pipeline tab.

The UI can look saved (optimistic) while the Sheet is unchanged. The cells in step 3 are the source of truth. If a toast fired, the matching cell will still hold the old value.
