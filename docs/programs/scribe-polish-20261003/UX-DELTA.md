# Scribe UX delta — final FE-COPY pass

Confirmed: UX consumed `feat/scribe-polish-20261003` through `a9ed80ce`. The final CSS and visual checks cover résumé and cover letter at 1440×1000 and 375×667, within the existing theme.

Historical before images use the lane’s original `.lane-evidence/ux-before` captures from base `3641d33f`. For the newly introduced selection/manual/unsaved controls, before images render the final FE DOM against that base’s unchanged `scribe-v2.css`; they show the styling baseline, not a claim that those capabilities existed at the base. After images use the actual FE-COPY DOM and candidate CSS. All data is fictional. Desktop PNGs are shrunk with `sips -Z 1200`; phone PNGs keep their native 375×667 size; the tracked set contains 20 images, each below 300 KB. Full-size evidence stays in `.lane-evidence/`.

| Change | Before | After | User benefit | Acceptance check |
|---|---|---|---|---|
| Résumé scope, 1440: selected text gets a bordered info pill and a 44px clear control | [Before](ux/scope-resume-1440-before.png) | [After](ux/scope-resume-1440-after.png) | See the request’s scope while writing in Chat; return to the whole document with one clear action | SCRP-U5 résumé 1440: real two-block scope, clear → Whole document, 44px target, focus ring and no overflow |
| Résumé selection, 375: wrapped action toolbar and visible multi-block Edit text hint | [Before](ux/selection-resume-375-before.png) | [After](ux/selection-resume-375-after.png) | Touch users can see why Edit text is unavailable and can still use Rewrite, Shorten, Emphasize or Ask | SCRP-U5 résumé 375: five 44px controls, exact title-derived hint, keyboard discoverability, no horizontal scroll |
| Cover-letter selection, 1440: consistent action heights and the same disabled hint | [Before](ux/selection-letter-1440-before.png) | [After](ux/selection-letter-1440-after.png) | The same editing rules read consistently across both documents | SCRP-U5 cover letter 1440: single block enables Edit text; multiple blocks retain an explanatory, focusable disabled control |
| Cover-letter scope, 375: pill wraps beside the clear button | [Before](ux/scope-letter-375-before.png) | [After](ux/scope-letter-375-after.png) | The chosen scope stays legible in phone Chat | SCRP-U5 cover letter 375: selected scope and clear control remain inside 375px; SCRP-U2 also stresses a long label |
| Manual cover-letter editing, 375: stable 64px outcome panel with info, saved, warning and error tokens | [Before](ux/manual-letter-375-before.png) | [After](ux/manual-letter-375-after.png) | Editing is visibly distinct from a saved version; errors and conflicts retain their recovery actions | SCRP-U5: actual plaintext editing; SCRP-U2, both documents/sizes: editing, saving, saved, error, conflict and confirmation; text contrast ≥4.5:1 and every action’s focus ring |
| Unsaved résumé text, 375: separate message row and Save / Discard / Stay actions | [Before](ux/unsaved-resume-375-before.png) | [After](ux/unsaved-resume-375-after.png) | A navigation decision is readable and its primary action is clear | SCRP-U5: actual dirty draft and Close; message precedes buttons, 44px targets, every action’s focus ring and no overflow. The iframe bullet reflow visible behind the prompt is handed to FE below |
| Idle résumé, 1440: literal review-before-save note and current-version footer | [Before](ux/idle-resume-1440-before.png) | [After](ux/idle-resume-1440-after.png) | The user can distinguish a suggested change from a saved document | Existing sheet/phone pixel cases; exact moved copy was accepted by FE-1, and the final visual floor retains those baselines |
| Résumé review, 1440: suggested-change wording, saved-fact warning and clear primary action | [Before](ux/review-resume-1440-before.png) | [After](ux/review-resume-1440-after.png) | Review remains deliberate, including explicit confirmation for new facts | Landed-proposal case: three marks, exact lock/unverified copy, Accept all verified primary and ≥4.5:1 button contrast |
| Cover-letter provider error, 375: safe explanation stays with the retained request | [Before](ux/error-letter-375-before.png) | [After](ux/error-letter-375-after.png) | A failed request leaves a clear next step without hiding the draft | Full capture matrix: error rendered for both documents/sizes with zero horizontal overflow and empty page-error/external/host-request arrays; journey tests prove retry paths |
| Saved text with unavailable PDF, 375: bounded warning panel and no Refresh promise | [Before](ux/pdf-resume-375-before.png) | [After](ux/pdf-resume-375-after.png) | Saved text is clearly distinguished from PDF availability | SCRP-U1: exact D9 text, no action button, wrap, contrast and no overflow; journey tests cover committed and ordinary 503 separately |

The full after matrix includes idle, busy with Stop, review, accepted, saved, error, versions, historical view and compare for both documents at both sizes (36 captures; all measured page overflow 0; every visible phone control at least 44px high). A further 80 state captures cover live selection/scope/manual/unsaved plus all manual and status outcomes. Live recovery remains covered by SCRP-U4. Only the 20 reviewable images above are tracked.

The four failures after the merge were the four SCRP-U2 cases: FE now hides its mounted toolbar with both `hidden` and inline `display:none`, while the old injection only cleared `hidden`. The injection now explicitly shows that toolbar and uses the live unsaved `span` shape. No functional assertion or pixel tolerance changed. Every visible action now has a keyboard-focus check. The five existing darwin pixel baselines passed unchanged; none was regenerated. Eight new SCRP-U5 baselines pin live selection and unsaved navigation for both documents at both sizes. Their exact names and reasons are in the lane report.

## For FE

Confirmed: the existing selected/editing outlines already match the earlier proposal: selected `outline: 2px solid var(--jb-focus-color); outline-offset: 2px; background: var(--jb-info-tint)`; editing `outline: 2px solid var(--jb-action); outline-offset: 2px; background: var(--jb-paper); white-space: pre-wrap`. UX changed neither injection nor templates.

Confirmed separate iframe defect: a Dossier résumé bullet becomes plain text during manual editing, but its `li` retains a two-column grid. The anonymous text occupies the 51.8281px gutter rather than the 529.9375px row. The isolated 375px probe measured 15 text lines and 149.484375px height. Applying the following CSS only in the scratch preview changed that to one line and 16.609375px height, while preserving the row width. Proposed exact rule for FE’s injected stylesheet:

```css
.sheet[data-family="dossier"] li[data-node^="b:"]:not(:has(> span)) {
  grid-template-columns: minmax(0, 1fr);
}
```

The shape guard is needed after blur as well as during `[data-scribe-editing]`: retained plain-text drafts outlive that attribute. FE should verify both blur/error retention and restored renderer spans before adopting the rule. The probe and its before/proposed images remain scratch evidence; this rule is not applied to the product or its snapshots by UX.

Confirmed validation: lint:repo passed; the unfiltered visual floor passed 21/21. Journey and staged-secret results are recorded in the final lane report. Unknown: physical phone keyboard, real-provider/OAuth/Sheet behavior, PDF print quality and independent integration acceptance. Those are outside this CSS lane.
