import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineJs = readFileSync(join(repoRoot, "pipeline.js"), "utf8");
const pipelineCss = readFileSync(join(repoRoot, "pipeline.css"), "utf8");
const roleCss = readFileSync(join(repoRoot, "role.css"), "utf8");
const briefJs = readFileSync(join(repoRoot, "role-brief.js"), "utf8");

describe("kanban card edit affordance (pencil -> dossier)", () => {
  it("renders a pencil button on each sticker card that carries the card key", () => {
    // WHY: without a visible affordance on the board, users have no way to
    // discover that cards are editable — the whole point of this feature.
    assert.match(
      pipelineJs,
      /class="pipe-sticker__edit"\s+data-card-action="edit-open"/,
      "each card must render an edit (pencil) button with data-card-action=edit-open",
    );
    assert.match(
      pipelineJs,
      /data-card-action="edit-open"[\s\S]{0,120}data-key="' \+ escapeHtml\(cardKey\)/,
      "the pencil must carry the card's stable key so the handler knows which role to open",
    );
    assert.match(
      pipelineJs,
      /data-card-action="edit-open"[\s\S]{0,200}aria-label="Edit role details"/,
      "the pencil needs an accessible label",
    );
  });

  it("is a real <button> so the drag/click guard treats it as interactive", () => {
    // WHY: isInteractiveTarget matches button/a/input/select/textarea/[data-card-action];
    // a <button data-card-action> guarantees pointerdown-drag and card-open both skip it.
    assert.match(
      pipelineJs,
      /button, a, input, select, textarea, \[data-card-action\]/,
      "isInteractiveTarget must still include [data-card-action] (and buttons)",
    );
  });

  it("opens the dossier AND drops the cursor into the title on click", () => {
    // WHY: opening alone isn't enough — the user clicked 'edit', so the title
    // must be focused and selected, ready to rename without a second click.
    assert.match(
      pipelineJs,
      /closest\('\[data-card-action="edit-open"\]'\)/,
      "the delegated click handler must route the edit-open button",
    );
    assert.match(
      pipelineJs,
      /openRoleAndScroll\(editBtn\.getAttribute\("data-key"\), editStage\);\s*\n\s*focusDossierField\("title"\);/,
      "the handler must open the role then focus the title field",
    );
  });

  it("focusDossierField targets the exact masthead selector and selects the text", () => {
    assert.match(
      pipelineJs,
      /\[data-action="edit-field"\]\[data-field="' \+ field \+ '"\]/,
      "focusDossierField must query the masthead edit-field by data-field",
    );
    assert.match(
      pipelineJs,
      /input\.focus\(\);[\s\S]{0,80}input\.select\(\)/,
      "the focused field should also select its text for instant overwrite",
    );
  });

  it("the selector pipeline.js queries matches the attributes role-brief.js emits (cross-module contract)", () => {
    // WHY: the focus handoff silently breaks if the two modules disagree on the
    // attribute names. Lock both ends together.
    assert.match(
      briefJs,
      /data-action="edit-field"/,
      "role-brief masthead inputs must use data-action=edit-field",
    );
    assert.match(
      briefJs,
      /data-field="title"/,
      "role-brief must emit a data-field=title input for the pencil to focus",
    );
  });

  it("the pencil is hidden at rest and revealed on hover/focus", () => {
    // WHY: a clean card at rest, discoverable on reach — not permanent clutter.
    assert.match(pipelineCss, /\.pipe-sticker__edit\s*\{[^}]*opacity:\s*0/);
    assert.match(
      pipelineCss,
      /\.pipe-sticker:hover\s+\.pipe-sticker__edit[\s\S]{0,160}opacity:\s*1/,
      "hovering the card must reveal the pencil",
    );
    assert.match(
      pipelineCss,
      /\.pipe-sticker:focus-within\s+\.pipe-sticker__edit/,
      "keyboard focus on the card must also reveal the pencil (a11y)",
    );
  });

  it("the header grid reserves a track for the new pencil column", () => {
    assert.match(
      pipelineCss,
      /\.pipe-sticker__head\s*\{[^}]*grid-template-columns:\s*1fr auto auto auto/,
      "the head grid must widen to id | pencil | favorite | fit",
    );
  });

  it("dossier identity fields read as editable (dashed underline, crimson focus)", () => {
    // WHY: once in the dossier, the fields must look editable — matching the
    // existing notes-textarea idiom — not like inert text or raw input boxes.
    assert.match(roleCss, /\.brief__fact-input\s*\{/, "location/salary need an editable fact style");
    assert.match(
      roleCss,
      /\.brief__masthead \[data-action="edit-field"\]:focus\s*\{\s*border-bottom-color:\s*var\(--crimson\)/,
      "focus must show the crimson underline used by the notes field",
    );
    assert.match(
      roleCss,
      /\.brief__masthead \[data-action="edit-field"\]:hover\s*\{\s*border-bottom-color:\s*var\(--border-strong\)/,
      "hover must hint editability with the dashed underline",
    );
  });
});

describe("v2 board must not self-trigger a render loop (pencil-flicker root cause)", () => {
  const dawnJs = readFileSync(join(repoRoot, "dawn.js"), "utf8");

  it("observeLegacy targets the legacy #jobCards board, never document.body", () => {
    // WHY: renderCards rewrites the region's innerHTML on every render. A
    // document.body-subtree MutationObserver would see those very writes and
    // reschedule forever — rebuilding every card each idle frame, which
    // restarts the pencil's opacity fade and makes it flicker/uncatchable.
    // #kanbanPipeline does not exist; the real legacy container is #jobCards.
    assert.match(
      pipelineJs,
      /getElementById\("kanbanPipeline"\) \|\| document\.getElementById\("jobCards"\)/,
      "pipeline.js observeLegacy must target #jobCards",
    );
    assert.doesNotMatch(
      pipelineJs,
      /var pipelineRoot = document\.getElementById\("kanbanPipeline"\) \|\| document\.body/,
      "pipeline.js must not observe document.body (self-retriggering render loop)",
    );
    assert.doesNotMatch(
      dawnJs,
      /var pipelineRoot = document\.getElementById\("kanbanPipeline"\) \|\| document\.body/,
      "dawn.js must not observe document.body either (same latent loop)",
    );
  });
});
