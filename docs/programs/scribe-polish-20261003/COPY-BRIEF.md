# SCRP copy brief (host-owned; FE applies, UX styles)

**Goal:** make every Scribe editor string short, literal, consistent with actual behavior, and paired with the one action that helps.

**Success means:** each "before" string below is replaced or kept as stated; new states use these strings verbatim; UX-DELTA.md records each change with a screenshot pair.

**Stop when:** the table is applied and no string in `scribe-v2*.js` exposes a status code, "materials server/browser", `npm start`, or "template's shape".

Refs are `J`=scribe-v2.js, `A`=scribe-v2-api.js, `V`=scribe-v2-versions.js, lines at base 3641d33f (host's Sonnet inventory). Line numbers drift as FE edits; match on the string. Entry points: only role-materials.js `openScribe` (row Edit) and the score modal's Fix this/Apply/Repair `fill()` path; no template/customizer opener exists.

## Vocabulary (use these words, nothing else)

| Concept | Term | Never |
|---|---|---|
| A request the user typed | **request** | prompt, ask, job |
| Scribe's suggested edits awaiting review | **suggested changes** (one: "change") | proposal (in UI copy), ops, edits |
| Accept/reject one change | **Accept / Reject** | Keep/Drop |
| Persisting accepted changes as a new version | **Save as vN** — accepting is not saving | commit |
| A saved version | **vN** in buttons/tags; "version N" in screen-reader text | run, snapshot |
| Restoring an old version as a new one | **Bring back** (action), **Brought back** (source tag) | Restore, Restored (in UI) |
| Throwing away suggested changes | **Discard** | Close without saving, Reject all (that stays only for the per-change bulk action) |
| PDF failed to render after text saved | **PDF unavailable** | PDF catches up, materials browser |

## Replacements

| Where (inventory ref) | Before | After |
|---|---|---|
| A errorFrom fallback (A:409,412) | The materials server answered {status}. | Use C4: body.message → body.error → per-code copy below → "That didn't work. Try again." Never show the status number. |
| A unreachable (A:427-428) | The materials server is not answering. Start it with npm start, then try again. | Scribe can't reach JobBored on this computer. Check that JobBored is running, then **Retry**. |
| 409 materials_pending (ASTRA-01/02) | The materials server answered 409. | The {resume/cover letter} has suggested changes waiting. **Review** · **Discard** |
| 409 stale_base on save | Not saved: A newer version exists. | Not saved — a newer version exists. **Review current** · **Discard** |
| Committed 503 (J:1278-1281) | "Saved as vN … The PDF catches up when the materials browser is back." / or "Not saved: …" | Text saved as vN. PDF unavailable. **Refresh availability** |
| provider_failed | Scribe could not start/finish this request. | The AI provider didn't respond. Your document is unchanged. **Try again** |
| unreadable_reply | Scribe returned a change the template can't hold. | Scribe's reply couldn't be read. Your document is unchanged. **Try again** |
| invalid_model / shape (J:1351-1352) | that change would break the template's shape ({detail}). | Blocked: that change doesn't fit this template's layout. (Keep `detail` only if it is a plain human phrase from the server; drop raw codes.) |
| locked (J:1353) | Blocked: would change “38%”. / would change a locked fact. | Blocked: “38%” is a locked fact. / Blocked: that would change a locked fact. |
| out_of_scope | Blocked: that change was outside what you asked Scribe to edit. | Blocked: that change is outside the selected text. (When scope is whole document, keep the original.) |
| no server copy (J:1268) | This proposal has no server copy to save. | These changes can't be saved. Discard them and send the request again. |
| Generic save fail (J:1289) | Not saved: The changes did not save. | Not saved. Your accepted changes are still here. **Try again** |
| Doc load (J:743) | The document did not load. | The {resume/cover letter} didn't load. **Retry** |
| Star (J:1523) | The star did not save. | Star didn't save. |
| Initial note (J:1624) | Ask for a change to this {doc}. Nothing is saved until you accept it. | Ask for a change. You review every change before it's saved. |
| Discard note (J:786) | Changes discarded. Nothing was saved. | Discarded. |
| Review-bar idle (J:420) | Preview, PDF and download serve v{n}. | Showing v{n}, the current version. |
| Discard button (J:437, J:1093) | Discard changes / Close without saving | **Discard** (both states) |
| Autosave (J:1111) | Every change is decided. Saving as v{n} in a moment. | All changes decided. Saving as v{n}… |
| Stop button (J:391) | Stop | Stop (aria-label "Stop and keep changes so far") |
| Stopping (new) | — | Stopping… (button disabled with aria-busy until settled) |
| Stopped with ops (J:355) | Stopped early | Stopped. {N} change(s) ready to review. |
| Stopped no ops (J:610) | Stopped. No changes were proposed. | Stopped. No changes suggested. |
| Done no ops (J:610) | No changes were proposed. Try a more specific request. | No changes suggested. Try a more specific request. |
| Ready (J:604-607) | 1 change is ready / N changes are ready | {N} suggested change(s) |
| Press J (J:1337) | Press J to pick a change first. | Pick a change first (J/K to move). |
| Versions tag (V:44) | Scribe edit | Scribe |
| Bring-back confirm (V:837-843) | Bring back v{n} as v{next}? v{cur} and every other version stay in the list. The open proposal will be discarded. | Bring back v{n} as v{next}? All versions are kept. (If a suggestion is open: add "Your open suggested changes will be discarded.") |
| Bring-back success (V:797) | Brought back v{n} as v{m}. Nothing was deleted. | Brought back v{n} as v{m}. |
| Bring-back fail (V:807-810) | Bring back didn’t save: {msg} Your versions and open proposal are unchanged. | Bring back didn't save. Nothing changed. **Try again** |
| Apostrophes | mixed ' and ’ | ’ everywhere in UI copy |

## New states (R1, F1, F2)

| State | Copy |
|---|---|
| Recover, same doc | You have {N} suggested change(s) from an earlier request. **Review** · **Discard** |
| Recover, sibling doc | The {cover letter/resume} has suggested changes waiting. **Review** · **Discard** (the composer stays editable; Send explains: "Review or discard those changes first.") |
| Recover, pending (still running) | An earlier request is still running. **Continue** · **Stop** |
| Recovered on a stale base | These changes were suggested for v{n}; v{m} is now current. **Discard** · **Load current** (Save stays CAS-protected) |
| Discard failed | Couldn't discard. The suggested changes are still open. **Try again** |
| Recovered decisions reset | Your earlier accept/reject choices weren't kept. Review again. |
| Second prompt while open | Review or discard the open changes first. Your new request is kept below. |
| Scope pill | Whole document / Selected: {label} / Selected: {N} blocks — with "×" (aria-label "Use whole document") |
| Selection stale | Your selection changed. Select the text again. |
| Selection actions | Rewrite · Shorten · Emphasize · Ask… · Edit text |
| Locked block selected | Locked: {reason}. Scribe won't change it. |
| Manual editing | Editing {label}. Saves when you leave the block. |
| Manual saving / saved | Saving… / Saved as v{n} |
| Manual error | Not saved. Your text is kept. **Try again** |
| Manual conflict | A newer version exists. Your text is kept. **Review current** · **Reapply** |
| Manual new fact | “{fact}” isn't in your profile. **Save anyway** · **Edit** (locked facts stay blocked: "“{fact}” is a locked fact.") |
| Unsaved navigation | You have unsaved text. **Save** · **Discard** · **Stay** |

Keep without change: "Facts locked" pill, "Unverified: please confirm." flag text may become "Not in your profile — confirm before accepting." (FE: apply), stage names, Compare/View/Bring back labels, chips.
