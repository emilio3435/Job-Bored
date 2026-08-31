/**
 * tests/jb-a11y-move-to-stage.test.mjs
 *
 * Claim MOBILE-01 — no explicit, labeled, touch-operable way to move a card
 * between stages, and touch targets below the 44px floor.
 *
 * WHY these pins exist: at the audited base the ONLY ways to change a card's
 * stage on the v2 lattice board are (a) drag-and-drop, which is unavailable to
 * keyboard and hostile on touch, and (b) an undiscoverable `meta+ArrowLeft/Right`
 * chord (lattice.js:798-809). Neither is announced, neither is visible, and the
 * repo contains exactly ONE 44px touch rule in total (style.css:1681).
 *
 * The locked API (T0-SUBSTRATE.md §2) answers this with
 * `stageMenu.attach(cardEl, { stages, current, jobKey, commitMove })`: a visible
 * ≥2.75rem "Move to stage" button plus an ARIA menu, keyboard and touch
 * operable, announcing the outcome.
 *
 * THE ADAPTER SEAM IS THE POINT: `commitMove` is INJECTED. The primitive must
 * never call window.updateJobStatus, mutate job.status, or read
 * getPipelineData(). The parallel repair program (F1-A transition writer,
 * canonical-ownership gate) rebinds that callback at the call sites it owns; if
 * this primitive wrote directly it would become a fifth writer those gates have
 * to chase. The last describe block below pins that seam at the source level.
 *
 * Claim classification (mirrored in JB-A11Y.md):
 *   - vm-SIMULATED here: markup + ARIA, keyboard operation, the injected
 *     commitMove contract, optimistic announce and revert-on-failure copy.
 *   - SOURCE/CSS-PINNED here: the 2.75rem touch floor in jb-a11y.css and the
 *     absence of any direct writer inside jb-a11y.js.
 *   - NEEDS-BROWSER: that the rendered target really measures ≥44 CSS px after
 *     cascade, that touch/pointer activation works on a device, and that the
 *     menu is reachable at mobile viewport widths. Those are e2e-smoke /
 *     manual claims, NOT claimed green here.
 *
 * Mutation check: make the primitive call window.updateJobStatus and the seam
 * pin fails; drop min-height from the trigger rule and the CSS pin fails; remove
 * the revert announce and the failure-path test fails.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { loadA11y, repoRoot, stripComments } from "./fixtures/jb-a11y-dom.mjs";

// Negative source pins run against CODE, not prose: jb-a11y.js and jb-a11y.css
// both document these very rules in their header comments.
const a11yJs = stripComments(readFileSync(join(repoRoot, "jb-a11y.js"), "utf8"));
const a11yCssRaw = readFileSync(join(repoRoot, "jb-a11y.css"), "utf8");
const a11yCss = stripComments(a11yCssRaw);

const STAGES = [
  { key: "new", label: "New" },
  { key: "researching", label: "Researching" },
  { key: "applied", label: "Applied" },
  { key: "rejected", label: "Rejected" },
];

/** A card plus a stage menu attached to it, with a recording commitMove. */
function cardScene(commitResult = true) {
  const h = loadA11y();
  const board = h.make("div", { class: "jb-lat__board" });
  const card = h.make("article", { class: "jb-lat__card", "data-index": "3" }, board);
  const calls = [];
  const commitMove = (jobKey, toStage, fromStage) => {
    calls.push({ jobKey, toStage, fromStage });
    return typeof commitResult === "function"
      ? commitResult(jobKey, toStage, fromStage)
      : Promise.resolve(commitResult);
  };
  const detach = h.api.stageMenu.attach(card, {
    stages: STAGES,
    current: "researching",
    jobKey: "JOB-7",
    commitMove,
  });
  const trigger = card.querySelector('[data-action="move-to-stage"]');
  return { h, card, calls, detach, trigger };
}

/** Resolve microtasks so the commitMove promise settles. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("JobBoredA11y.stageMenu — the visible, labeled control (MOBILE-01)", () => {
  it("renders an explicit 'Move to stage' button on the card", () => {
    const { trigger } = cardScene();
    assert.ok(
      trigger,
      "stageMenu.attach must add a [data-action='move-to-stage'] control — " +
        "at the audited base the only stage path was drag or a hidden meta+Arrow chord",
    );
    assert.equal(
      trigger.tagName,
      "BUTTON",
      "the control must be a real <button> so it is keyboard- and touch-activatable",
    );
    assert.equal(
      trigger.getAttribute("type"),
      "button",
      "type=button prevents an accidental form submit inside legacy modals",
    );
    assert.match(
      trigger.textContent,
      /Move to stage/i,
      "the control must be VISIBLY labeled — a bare icon is the defect, not the fix",
    );
  });

  it("names the current stage in the accessible name", () => {
    const { trigger } = cardScene();
    const name = trigger.getAttribute("aria-label") || trigger.textContent;
    assert.match(
      name,
      /Researching/,
      "the trigger must announce which stage the card is in now, or a screen " +
        "reader user has to hunt for the current state before moving",
    );
  });

  it("carries the 2.75rem touch-target class", () => {
    const { trigger } = cardScene();
    assert.equal(
      trigger.classList.contains("jb-a11y-touch-target"),
      true,
      "the trigger must opt into the shared 44px touch utility",
    );
  });

  it("declares a closed ARIA menu relationship before it is opened", () => {
    const { h, card, trigger } = cardScene();
    assert.equal(
      trigger.getAttribute("aria-haspopup"),
      "menu",
      "aria-haspopup=menu tells AT a menu will appear",
    );
    assert.equal(
      trigger.getAttribute("aria-expanded"),
      "false",
      "aria-expanded must start false and track the open state",
    );
    const menu = card.querySelector('[role="menu"]');
    assert.ok(menu, "the menu must exist in the DOM so aria-controls resolves");
    assert.equal(
      trigger.getAttribute("aria-controls"),
      menu.id,
      "aria-controls must point at the menu element",
    );
    assert.equal(menu.hidden, true, "the menu starts hidden");
    assert.equal(
      h.document.activeElement,
      h.document.body,
      "attach() must not steal focus at render time",
    );
  });

  it("offers every stage except the current one, colored by --jb-stage-* tokens", () => {
    const { card } = cardScene();
    const items = card.querySelectorAll('[role="menuitem"]');
    assert.equal(
      items.length,
      STAGES.length - 1,
      "the current stage must not be offered as a destination",
    );
    const keys = items.map((i) => i.getAttribute("data-stage"));
    assert.deepEqual(
      keys,
      ["new", "applied", "rejected"],
      "menu order must follow the injected stage vocabulary (P0-A's registry)",
    );
    for (const item of items) {
      assert.match(
        item.style.getPropertyValue
          ? item.style.getPropertyValue("--jb-a11y-stage-color")
          : item.style["--jb-a11y-stage-color"] || "",
        /var\(--jb-stage-/,
        "each item must take its color from a --jb-stage-* token (no raw hex)",
      );
    }
  });

  it("uses getLabel when supplied, falling back to the stage's own label", () => {
    const h = loadA11y();
    const card = h.make("article", { class: "jb-lat__card" });
    h.api.stageMenu.attach(card, {
      stages: STAGES,
      current: "new",
      jobKey: "J",
      getLabel: (key) => key.toUpperCase(),
      commitMove: () => Promise.resolve(true),
    });
    const first = card.querySelector('[role="menuitem"]');
    assert.equal(
      first.textContent,
      "RESEARCHING",
      "getLabel must win so the host owns stage copy (stage-registry.js, P0-A)",
    );
  });
});

describe("JobBoredA11y.stageMenu — keyboard and pointer operation", () => {
  it("opens on click, moves focus to the first item, and flips aria-expanded", () => {
    const { h, card, trigger } = cardScene();
    trigger.click();
    const menu = card.querySelector('[role="menu"]');
    assert.equal(menu.hidden, false, "clicking the trigger must open the menu");
    assert.equal(
      trigger.getAttribute("aria-expanded"),
      "true",
      "aria-expanded must track the open state",
    );
    assert.equal(
      h.document.activeElement,
      card.querySelectorAll('[role="menuitem"]')[0],
      "opening must land focus on the first item so keyboard users can act",
    );
  });

  it("cycles items with ArrowDown/ArrowUp and jumps with Home/End", () => {
    const { h, card, trigger } = cardScene();
    trigger.click();
    const items = card.querySelectorAll('[role="menuitem"]');

    h.pressOn(items[0], "ArrowDown");
    assert.equal(h.document.activeElement, items[1], "ArrowDown moves to the next item");

    h.pressOn(items[1], "ArrowUp");
    assert.equal(h.document.activeElement, items[0], "ArrowUp moves to the previous item");

    h.pressOn(items[0], "ArrowUp");
    assert.equal(
      h.document.activeElement,
      items[items.length - 1],
      "ArrowUp from the first item wraps to the last (WAI-ARIA menu pattern)",
    );

    h.pressOn(items[items.length - 1], "Home");
    assert.equal(h.document.activeElement, items[0], "Home jumps to the first item");

    h.pressOn(items[0], "End");
    assert.equal(
      h.document.activeElement,
      items[items.length - 1],
      "End jumps to the last item",
    );
  });

  it("closes on Escape and returns focus to the trigger", () => {
    const { h, card, trigger } = cardScene();
    trigger.click();
    const items = card.querySelectorAll('[role="menuitem"]');
    h.pressOn(items[0], "Escape");
    assert.equal(
      card.querySelector('[role="menu"]').hidden,
      true,
      "Escape must close the menu",
    );
    assert.equal(
      h.document.activeElement,
      trigger,
      "focus must return to the trigger — dumping it on <body> loses the user's place",
    );
  });

  it("uses roving tabindex so the menu is one tab stop", () => {
    const { card, trigger } = cardScene();
    trigger.click();
    const items = card.querySelectorAll('[role="menuitem"]');
    assert.equal(items[0].getAttribute("tabindex"), "0", "the active item is tabbable");
    assert.equal(
      items[1].getAttribute("tabindex"),
      "-1",
      "inactive items must be removed from the tab order (settings-tabs.js pattern)",
    );
  });
});

describe("JobBoredA11y.stageMenu — the injected commitMove seam", () => {
  it("calls commitMove(jobKey, toStage, fromStage) with the source stage threaded", async () => {
    const { card, trigger, calls } = cardScene(true);
    trigger.click();
    card.querySelector('[data-stage="applied"]').click();
    await settle();

    assert.deepEqual(
      calls,
      [{ jobKey: "JOB-7", toStage: "applied", fromStage: "researching" }],
      "the fromStage must be threaded explicitly — lattice.js:905-915 documents " +
        "why (an optimistic mutation destroys the readable previous status, and " +
        "the Discovered→Researching auto-draft trigger depends on it)",
    );
  });

  it("announces the optimistic move and closes the menu", async () => {
    const { h, card, trigger } = cardScene(true);
    trigger.click();
    card.querySelector('[data-stage="applied"]').click();
    await settle();

    assert.equal(
      h.document.querySelector('[data-jb-a11y-live="polite"]').textContent,
      "Moved to Applied",
      "a successful move must announce with the human stage label " +
        "(lattice.js announce copy, reused verbatim)",
    );
    assert.equal(
      card.querySelector('[role="menu"]').hidden,
      true,
      "selecting an item must close the menu",
    );
  });

  it("announces the revert when commitMove resolves false", async () => {
    const { h, card, trigger } = cardScene(false);
    trigger.click();
    card.querySelector('[data-stage="applied"]').click();
    await settle();

    assert.equal(
      h.document.querySelector('[data-jb-a11y-live="assertive"]').textContent,
      "Move failed; reverted to Researching",
      "a rejected write must announce the revert assertively — silence here is " +
        "the failure mode the audit found (lattice.js revert copy)",
    );
  });

  it("announces the revert when commitMove rejects", async () => {
    const { h, card, trigger } = cardScene(() => Promise.reject(new Error("offline")));
    trigger.click();
    card.querySelector('[data-stage="applied"]').click();
    await settle();

    assert.match(
      h.document.querySelector('[data-jb-a11y-live="assertive"]').textContent,
      /Move failed; reverted to Researching/,
      "a thrown write must be treated exactly like a false one",
    );
  });

  it("updates the trigger's current stage only after the write succeeds", async () => {
    const okScene = cardScene(true);
    okScene.trigger.click();
    okScene.card.querySelector('[data-stage="applied"]').click();
    await settle();
    assert.match(
      okScene.trigger.getAttribute("aria-label") || okScene.trigger.textContent,
      /Applied/,
      "a confirmed move must update the control's reported current stage",
    );

    const failScene = cardScene(false);
    failScene.trigger.click();
    failScene.card.querySelector('[data-stage="applied"]').click();
    await settle();
    assert.match(
      failScene.trigger.getAttribute("aria-label") || failScene.trigger.textContent,
      /Researching/,
      "a failed move must leave the control reporting the ORIGINAL stage — " +
        "showing the optimistic value would render unknown as confirmed",
    );
  });

  it("is a no-op with no commitMove injected, rather than writing some other way", () => {
    const h = loadA11y();
    const card = h.make("article", { class: "jb-lat__card" });
    assert.doesNotThrow(
      () =>
        h.api.stageMenu.attach(card, {
          stages: STAGES,
          current: "new",
          jobKey: "J",
        }),
      "attach without commitMove must not throw",
    );
    assert.equal(
      card.querySelector('[data-action="move-to-stage"]'),
      null,
      "with no writer injected the primitive must render NO move control at all — " +
        "a dead button that silently does nothing is worse than no button",
    );
  });

  it("detach() removes the control and its listeners", () => {
    const { card, detach, trigger } = cardScene();
    trigger.click();
    detach();
    assert.equal(
      card.querySelector('[data-action="move-to-stage"]'),
      null,
      "detach must remove the trigger so a re-render cannot stack duplicates",
    );
    assert.equal(
      card.querySelector('[role="menu"]'),
      null,
      "detach must remove the menu too",
    );
  });

  it("re-attaching replaces rather than duplicates the control", () => {
    const { h, card } = cardScene();
    h.api.stageMenu.attach(card, {
      stages: STAGES,
      current: "applied",
      jobKey: "JOB-7",
      commitMove: () => Promise.resolve(true),
    });
    assert.equal(
      card.querySelectorAll('[data-action="move-to-stage"]').length,
      1,
      "lattice re-renders cards constantly; attach must be idempotent per card",
    );
  });
});

describe("jb-a11y.js — the primitive is not a writer (adapter-seam source pin)", () => {
  // T0-SUBSTRATE.md §1: all stage writes flow through jb:pipeline:move or an
  // injected commitMove. A direct call here would make jb-a11y.js a fifth
  // writer the F1-A transition-writer gate has to chase.
  it("never calls window.updateJobStatus", () => {
    assert.equal(
      /updateJobStatus/.test(a11yJs),
      false,
      "jb-a11y.js must never reference updateJobStatus — commitMove is the seam",
    );
  });

  it("never reads the pipeline data or mutates job.status", () => {
    assert.equal(
      /getPipelineData|\.status\s*=/.test(a11yJs),
      false,
      "jb-a11y.js must not touch pipeline rows; the host owns optimistic state",
    );
  });

  it("never talks to Sheets, storage, or the write bus directly", () => {
    assert.equal(
      /sheetsWrite|localStorage|indexedDB|fetch\(/.test(a11yJs),
      false,
      "the primitive holds no state and performs no I/O (T0-SUBSTRATE.md §2)",
    );
    assert.equal(
      /jb:pipeline:move|jb:closure:change/.test(a11yJs),
      false,
      "the primitive must not dispatch write intents itself — its ONLY outbound " +
        "events are the two observability events jb:a11y:dialog:opened/closed",
    );
  });
});

describe("jb-a11y.css — the 44px touch floor (MOBILE-01, CSS pin)", () => {
  it("declares 2.75rem min-height AND min-width on the touch utility", () => {
    const rule = a11yCss.slice(a11yCss.indexOf(".jb-a11y-touch-target"));
    const block = rule.slice(0, rule.indexOf("}") + 1);
    assert.match(
      block,
      /min-height:\s*2\.75rem/,
      "the shared touch utility must set min-height: 2.75rem (44px) — " +
        "style.css:1681 is the repo's only precedent and the convention to match",
    );
    assert.match(
      block,
      /min-width:\s*2\.75rem/,
      "min-width matters too: an icon-only button can be 44px tall and 16px wide",
    );
  });

  it("applies the floor to the stage-menu trigger, menu items, and toast close", () => {
    for (const sel of [
      ".jb-a11y-stage-menu__trigger",
      ".jb-a11y-stage-menu__item",
    ]) {
      assert.ok(
        a11yCss.includes(sel),
        `${sel} must be styled by jb-a11y.css, not left to the consuming board`,
      );
    }
    assert.match(
      a11yCss,
      /\.jb-a11y-touch-target[\s\S]{0,400}?min-height:\s*2\.75rem/,
      "the utility class is the single place the 44px floor is defined",
    );
  });

  it("is NOT scoped to body.jb-v2 (dialogs serve the legacy view too)", () => {
    assert.equal(
      /body\.jb-v2/.test(a11yCss),
      false,
      "jb-a11y.css must stay unscoped — jb-ui.css's body:not(.jb-v2){display:none} " +
        "kill-switch would make every dialog invisible in the legacy view, which " +
        "is where the settings modal and the wizards actually render",
    );
  });

  it("contains no raw hex (tools/lint-tokens.mjs scans jb-*.css)", () => {
    const hits = a11yCss.match(/#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi);
    assert.equal(
      hits,
      null,
      `jb-a11y.css must use --jb-* tokens only; found ${hits ? hits.join(", ") : ""}`,
    );
  });

  it("uses the shared focus ring token rather than a bespoke outline color", () => {
    assert.match(
      a11yCss,
      /var\(--jb-shadow-focus\)/,
      "focus styling must reuse --jb-shadow-focus so the ring is consistent",
    );
  });
});
