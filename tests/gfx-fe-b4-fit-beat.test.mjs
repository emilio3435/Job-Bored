/**
 * GFX FE-B4 — Beat 4 (Confirm your fit): the grouped page, schema-driven
 * validation, and the save — since JOBQA, onboarding's one commit
 * (POST /profile/commit), with the browser's copy written only after it.
 *
 * Ledger: N-B4-1…N-B4-6, B4-1…B4-11 (docs/programs/gfx-20260926/SPEC.md).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOneFlow, readRepoFile } from "./oneflow-l0-harness.mjs";

function draft(overrides = {}) {
  const base = {
    version: 1,
    identity: {
      targetRoles: ["Staff Engineer", "Platform Engineer"],
      targetSeniority: "ic_staff",
      primaryNarrative:
        "I build reliable distributed systems and lead high-leverage platform work.",
    },
    strengths: [
      { name: "Distributed systems", rank: 1, evidence: "Led a platform migration" },
      { name: "Technical leadership", rank: 2 },
      { name: "Incident response", rank: 3 },
    ],
    wants: ["hands-on building", "small team"],
    avoids: ["quota sales"],
    hardConstraints: {
      workMode: "any",
      acceptableLocations: [],
      workAuth: "us_authorized",
      skipTitles: ["intern"],
      salaryFloor: null,
      salaryRequired: false,
    },
  };
  return {
    ...base,
    ...overrides,
    identity: { ...base.identity, ...(overrides.identity || {}) },
    hardConstraints: { ...base.hardConstraints, ...(overrides.hardConstraints || {}) },
  };
}

/** Load a classic-global module against the sandbox's window. */
function loadInto(win, file) {
  new Function("window", readRepoFile(file))(win);
}

const KEY = () => ({ preventDefault() {} });

/**
 * `commit` is what POST /profile/commit answers: omitted, a saved commit;
 * `{ status, body }`, that answer; a function of the request body; or
 * "offline", no answer at all. `syncCalls` keeps each committed profile.
 */
function setup(profileDraft = draft(), { modules = true, commit } = {}) {
  const env = loadOneFlow({ beatFiles: true });
  if (modules) {
    loadInto(env.window, "fit-profile-schema.js");
    loadInto(env.window, "fit-profile-sync.js");
  }
  const syncCalls = [];
  const commitCalls = [];
  env.window.fetch = async (url, init) => {
    if (String(url).endsWith("/profile/commit")) {
      const body = JSON.parse(init.body);
      commitCalls.push(body);
      syncCalls.push(body.profile);
      if (commit === "offline") throw new TypeError("Failed to fetch");
      const answer =
        typeof commit === "function"
          ? commit(body)
          : commit || { status: 200, body: { ok: true, replayed: false, commitId: body.commitId, mode: body.mode, revision: "r1" } };
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
    }
    throw new TypeError(`unexpected request ${url}`);
  };
  const discoveryWrites = [];
  env.window.CommandCenterUserContent.saveDiscoveryProfile = async (payload) => {
    discoveryWrites.push(payload);
    return payload;
  };
  const toasts = [];
  env.window.JobBoredApp = {
    core: { host: { showToast: (message, tone) => toasts.push({ message, tone }) } },
  };
  const beat = env.flow.getBeat("fit");
  const runtime = { profileDraft };
  const messages = [];
  const completions = [];
  const ctx = {
    state: {},
    runtime,
    setMessage(text, tone) {
      messages.push({ text, tone });
    },
    setBusy() {},
    clearBusy() {},
    async completeBeat(detail) {
      completions.push(detail);
    },
  };
  const container = env.document.createElement("div");
  beat.render(container, ctx);
  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => container.querySelectorAll(sel);
  const confirm = () => beat.onAction("confirm-fit", ctx);
  return {
    ...env,
    beat,
    container,
    ctx,
    runtime,
    messages,
    completions,
    discoveryWrites,
    syncCalls,
    commitCalls,
    toasts,
    q,
    qa,
    confirm,
  };
}

function field(env, key) {
  return env.q(`[data-field="${key}"]`);
}

function tagInputs(env, key) {
  return field(env, key).querySelectorAll(".oneflow-fit-tag__input");
}

describe("GFX FE-B4 · N-B4-1 + R7 (JOBQA): 'Looks like me' is onboarding's one commit", () => {
  it("N-B4-1: on an empty-config greenfield the commit is POSTed same-origin, once", async () => {
    const env = setup();
    env.window.COMMAND_CENTER_CONFIG = {};
    const requests = [];
    env.window.fetch = async (url, init) => {
      requests.push({ url, init });
      const body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ ok: true, commitId: body.commitId, revision: "r1" }) };
    };
    await env.confirm();
    assert.equal(requests.length, 1, "no configured URL is not a reason to skip");
    assert.equal(requests[0].url, "/profile/commit");
    assert.equal(requests[0].init.method, "POST");
    const body = JSON.parse(requests[0].init.body);
    assert.deepEqual(body.profile.identity.targetRoles, ["Staff Engineer", "Platform Engineer"]);
    assert.equal(body.mode, "create", "a browser holding no saved resume can only create");
    assert.equal(body.noResume, true, "no staged resume: an explicit profile-only save");
    assert.equal(env.discoveryWrites.length, 1);
    assert.equal(env.completions.length, 1);
    assert.equal(env.completions[0].serverSynced, true);
  });

  it("JOBQA: with no JobBored server answering, the save can't be confirmed — the beat stays and nothing is written here", async () => {
    const env = setup(draft(), { commit: "offline" });
    await env.confirm();
    assert.equal(env.commitCalls.length, 1);
    assert.equal(env.completions.length, 0, "an unconfirmed save never completes the beat");
    assert.equal(env.discoveryWrites.length, 0, "the browser's copy waits for the server's yes");
    assert.ok(env.messages.some((m) => m.tone === "error" && /couldn't confirm the save/.test(m.text)));
    assert.ok(env.messages.some((m) => /won't save twice/.test(m.text)), "says a retry is safe");
  });

  it("N-B4-2: a rejected profile keeps the user on the beat, with the server's words at the field", async () => {
    const env = setup(draft(), {
      commit: {
        status: 400,
        body: {
          ok: false,
          reason: "invalid_profile",
          message: "The profile doesn't match JobBored's profile format.",
          errors: [
            {
              instancePath: "/identity/targetRoles/1",
              message: "must NOT have more than 80 characters",
            },
          ],
        },
      },
    });
    await env.confirm();
    assert.equal(env.completions.length, 0, "a 4xx is never swallowed as a save");
    const error = env.q(".oneflow-fit-error--roles");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /must NOT have more than 80 characters/);
    const second = tagInputs(env, "roles")[1];
    assert.equal(second.getAttribute("aria-invalid"), "true");
    assert.equal(env.document.activeElement, second, "focus lands on the rejected item");
    assert.ok(env.messages.some((m) => m.tone === "error"));
  });

  it("N-B4-2: a rejection the beat can't place still surfaces the server's message", async () => {
    const env = setup(draft(), {
      commit: {
        status: 400,
        body: { ok: false, reason: "invalid_profile", message: "profile body is malformed", errors: [] },
      },
    });
    await env.confirm();
    assert.equal(env.completions.length, 0);
    assert.ok(env.messages.some((m) => m.tone === "error" && /malformed/.test(m.text)));
  });

  it("JOBQA: a save the server rolled back says nothing was changed, and nothing is written here", async () => {
    const env = setup(draft(), {
      commit: { status: 500, body: { ok: false, reason: "commit_failed_rolled_back", message: "Saving failed." } },
    });
    await env.confirm();
    assert.equal(env.completions.length, 0);
    assert.equal(env.discoveryWrites.length, 0);
    assert.ok(env.messages.some((m) => m.tone === "error" && /nothing was changed/.test(m.text)));
  });

  it("JOBQA: a fresh browser on a computer with a saved setup is refused — nothing saved, answers kept", async () => {
    const env = setup(draft(), {
      commit: { status: 409, body: { ok: false, reason: "canonical_profile_exists", message: "exists" } },
    });
    await env.confirm();
    assert.equal(env.completions.length, 0);
    assert.equal(env.discoveryWrites.length, 0);
    assert.ok(env.messages.some((m) => m.tone === "error" && /already has a saved JobBored profile/.test(m.text)));
  });

  it("JOBQA: when the browser's copy fails after the server saved, the beat stays and a retry replays the same commit", async () => {
    const env = setup(draft());
    let failNext = true;
    env.window.CommandCenterUserContent.saveDiscoveryProfile = async (payload) => {
      if (failNext) {
        failNext = false;
        throw new Error("quota exceeded");
      }
      env.discoveryWrites.push(payload);
      return payload;
    };
    await env.confirm();
    assert.equal(env.completions.length, 0, "the beat stays retryable");
    assert.ok(env.messages.some((m) => m.tone === "error" && /saved on this computer/i.test(m.text)));
    await env.confirm();
    assert.equal(env.commitCalls.length, 2);
    assert.equal(env.commitCalls[1].commitId, env.commitCalls[0].commitId, "the same commit id: the server replays, no second save");
    assert.equal(env.discoveryWrites.length, 1);
    assert.equal(env.completions.length, 1);
  });
});

describe("GFX FE-B4 · N-B4-2 / N-B4-3: inline validation from the schema module", () => {
  it("N-B4-2: schema caps fail inline — a 61-character strength never reaches the sync", async () => {
    const long = "x".repeat(61);
    const env = setup(
      draft({ strengths: [{ name: long, rank: 1 }] }),
      { sync: { ok: true, synced: true, reason: "synced" } },
    );
    await env.confirm();
    assert.equal(env.syncCalls.length, 0);
    assert.equal(env.completions.length, 0);
    assert.match(env.q(".oneflow-fit-error--strengths").textContent, /60 characters or fewer/);
  });

  it("N-B4-2: the Add control disables at 8 roles and says why", () => {
    const roles = Array.from({ length: 8 }, (_v, i) => `Role ${i + 1}`);
    const env = setup(draft({ identity: { targetRoles: roles } }));
    const add = field(env, "roles").querySelector(".oneflow-fit-tags__new");
    const button = field(env, "roles").querySelector(".oneflow-fit-link-button");
    const cap = field(env, "roles").querySelector(".oneflow-fit-cap");
    assert.equal(add.disabled, true);
    assert.equal(button.disabled, true);
    assert.equal(cap.hidden, false);
    assert.match(cap.textContent, /8 roles is the most/);
    assert.match(add.getAttribute("aria-describedby"), new RegExp(cap.id));
  });

  it("N-B4-3: the first invalid field is focused, and the error clears as the user fixes it", async () => {
    const env = setup(
      draft({ identity: { primaryNarrative: "too short" } }),
      { sync: { ok: true, synced: true, reason: "synced" } },
    );
    await env.confirm();
    const narrative = env.q(".oneflow-fit-textarea");
    assert.equal(env.document.activeElement, narrative);
    assert.equal(narrative.getAttribute("aria-invalid"), "true");
    const error = env.q(".oneflow-fit-error--narrative");
    assert.equal(error.hidden, false);
    assert.match(error.textContent, /at least 20 characters/);

    narrative.value = "I build platforms other teams build careers on.";
    narrative.dispatch("input", {});
    assert.equal(error.hidden, true, "the inline error re-checks as the user types");
    assert.equal(narrative.getAttribute("aria-invalid"), null);
  });

  it("B4-8: the option lists come from JobBoredFitProfileSchema.ENUMS", () => {
    const env = setup();
    const ids = (select) => select.children.map((o) => o.value);
    const selects = env.qa(".oneflow-fit-select");
    assert.deepEqual(ids(selects[0]), [...env.window.JobBoredFitProfileSchema.ENUMS.seniority]);
    assert.deepEqual(ids(selects[1]), [...env.window.JobBoredFitProfileSchema.ENUMS.workAuth]);
    assert.deepEqual(
      env.qa("[data-work-mode]").map((input) => input.value),
      [...env.window.JobBoredFitProfileSchema.ENUMS.workMode],
    );
  });
});

describe("GFX FE-B4 · B4-1/5/9, B4-4, B4-6, B4-7: one grouped page", () => {
  it("B4-1/B4-9: sections run Target → Your story → Strengths → Deal-breakers → Preferences", () => {
    const env = setup();
    const titles = env.qa(".oneflow-fit-section__title").map((n) => n.textContent);
    assert.deepEqual(titles, [
      "Target",
      "Your story",
      "Strengths",
      "Deal-breakers",
      "Preferences",
    ]);
    assert.equal(env.q(".oneflow-fit-grid"), null, "no 3-column card grid");
    assert.equal(env.q(".oneflow-fit-card"), null);
  });

  it("B4-9: the hard filters are visible, not behind an 'Edit details' disclosure", () => {
    const env = setup();
    const deal = env.q(".oneflow-fit-section--dealbreakers");
    assert.equal(deal.tagName, "SECTION");
    assert.equal(deal.closest(".oneflow-fit-prefs"), null);
    assert.ok(deal.querySelector("[data-work-mode]"));
    assert.ok(deal.querySelector(".oneflow-fit-salary__input"));
    assert.doesNotMatch(env.container.textContent, /Edit details/);
  });

  it("B4-5 / N-B4-6: Preferences is collapsed with a count, subheads More of / Less of", () => {
    const env = setup();
    const prefs = env.q(".oneflow-fit-prefs");
    assert.equal(prefs.tagName, "DETAILS");
    assert.ok(!prefs.open, "collapsed by default");
    assert.equal(env.q(".oneflow-fit-prefs__count").textContent, "4");
    const text = prefs.textContent;
    assert.match(text, /More of/);
    assert.match(text, /Less of/);
    assert.match(text, /Skip titles/);
    assert.doesNotMatch(env.container.textContent, /Lean toward|Lean away/);
  });

  it("B4-6: no raw profile JSON in the beat", () => {
    const env = setup();
    assert.equal(env.q(".oneflow-fit-json"), null);
    assert.doesNotMatch(env.container.textContent, /Raw profile JSON/);
  });

  it("N-B4-3 / B4-4: the narrative is an always-visible labelled textarea with a live counter", () => {
    const env = setup();
    const narrative = env.q(".oneflow-fit-textarea");
    assert.equal(narrative.hidden, false);
    const label = env.qa(".oneflow-fit-field__label").find((n) => n.htmlFor === narrative.id);
    assert.ok(label, "the textarea has a <label for>");
    assert.equal(label.textContent, "In one or two sentences, what do you do best?");
    assert.equal(narrative.maxLength, 1200);
    const counter = env.q(".oneflow-fit-counter");
    assert.match(counter.textContent, /^\d+ \/ 1200$/);
    narrative.value = "Too short";
    narrative.dispatch("input", {});
    assert.match(counter.textContent, /9 \/ 1200 · 11 more to go/);
    assert.equal(env.q(".oneflow-fit-narrative__text"), null, "no truncated <em>");
    assert.ok(
      env.qa(".oneflow-fit-link-button").every((b) => b.textContent !== "edit"),
      "no 'edit' link",
    );
  });

  it("B4-7: the beat's headline is the new copy", () => {
    const env = setup();
    assert.equal(env.beat.headline, "Here's how we'll match jobs to you.");
  });
});

describe("GFX FE-B4 · D5 / N-B4-4: one salary control", () => {
  it("N-B4-4: minimum salary and the missing-salary checkbox share one control, with help text", () => {
    const env = setup();
    const salary = env.q(".oneflow-fit-salary");
    assert.match(salary.textContent, /Minimum salary/);
    assert.match(salary.textContent, /Also hide jobs that don't list a salary/);
    assert.match(salary.textContent, /The minimum only applies to jobs that list a salary\./);
    const input = env.q(".oneflow-fit-salary__input");
    const help = salary.querySelector(".oneflow-fit-help");
    assert.match(input.getAttribute("aria-describedby"), new RegExp(help.id));
  });

  it("N-B4-4: the summary names a floor only when one is set", async () => {
    const env = setup();
    const summary = env.q(".oneflow-fit-summary");
    assert.equal(summary.textContent, "Anywhere.");
    assert.doesNotMatch(summary.textContent, /\$/);

    const input = env.q(".oneflow-fit-salary__input");
    input.value = "150000";
    input.dispatch("input", {});
    assert.equal(summary.textContent, "Anywhere; listed salaries under $150k are hidden.");

    input.value = "";
    input.dispatch("input", {});
    assert.equal(summary.textContent, "Anywhere.");
  });

  it("N-B4-4: backend semantics are unchanged — salaryRequired rides only when ticked", async () => {
    const env = setup(
      draft({ hardConstraints: { salaryFloor: 180000 } }),
      { sync: { ok: true, synced: true, reason: "synced" } },
    );
    await env.confirm();
    assert.equal(env.syncCalls[0].hardConstraints.salaryFloor, 180000);
    assert.equal("salaryRequired" in env.syncCalls[0].hardConstraints, false);

    const ticked = setup(
      draft({ hardConstraints: { salaryFloor: 180000 } }),
      { sync: { ok: true, synced: true, reason: "synced" } },
    );
    const box = ticked.q(".oneflow-fit-check").children[0];
    box.checked = true;
    box.dispatch("change", {});
    await ticked.confirm();
    assert.equal(ticked.syncCalls[0].hardConstraints.salaryRequired, true);
  });
});

describe("GFX FE-B4 · B4-2, B4-3, B4-11, N-B4-5: tag inputs", () => {
  it("B4-11: drag lives on the handle, not the row, and there are no ↑↓ buttons", () => {
    const env = setup();
    const rows = field(env, "strengths").querySelectorAll(".oneflow-fit-tag");
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.getAttribute("draggable"), null);
      const handle = row.querySelector(".oneflow-fit-tag__handle");
      assert.equal(handle.getAttribute("draggable"), "true");
      assert.match(handle.getAttribute("aria-label"), /^Reorder /);
    }
    assert.equal(env.q(".oneflow-fit-chip__move"), null);
    assert.doesNotMatch(env.container.textContent, /[↑↓]/);
  });

  it("B4-2: the keyboard reorders strengths from the handle, and rank follows", async () => {
    const env = setup(draft(), { sync: { ok: true, synced: true, reason: "synced" } });
    const handle = field(env, "strengths").querySelector(".oneflow-fit-tag__handle");
    handle.dispatch("keydown", { key: "ArrowDown", ...KEY() });
    const names = tagInputs(env, "strengths").map((i) => i.value);
    assert.deepEqual(names, ["Technical leadership", "Distributed systems", "Incident response"]);
    const moved = field(env, "strengths").querySelectorAll(".oneflow-fit-tag__handle")[1];
    assert.equal(env.document.activeElement, moved, "focus follows the moved item");
    await env.confirm();
    assert.deepEqual(
      env.syncCalls[0].strengths.map((s) => [s.name, s.rank, s.evidence]),
      [
        ["Technical leadership", 1, undefined],
        ["Distributed systems", 2, "Led a platform migration"],
        ["Incident response", 3, undefined],
      ],
      "evidence travels with its strength",
    );
  });

  it("B4-2: the drag handle reorders roles too", () => {
    const env = setup();
    const handles = field(env, "roles").querySelectorAll(".oneflow-fit-tag__handle");
    const rows = field(env, "roles").querySelectorAll(".oneflow-fit-tag");
    handles[1].dispatch("dragstart", {});
    rows[0].dispatch("drop", KEY());
    assert.deepEqual(
      tagInputs(env, "roles").map((i) => i.value),
      ["Platform Engineer", "Staff Engineer"],
    );
  });

  it("B4-3: Enter or comma adds; a pasted comma list adds each", () => {
    const env = setup();
    const add = field(env, "wants").querySelector(".oneflow-fit-tags__new");
    add.value = "mentoring";
    add.dispatch("keydown", { key: "Enter", ...KEY() });
    add.value = "open source";
    add.dispatch("keydown", { key: ",", ...KEY() });
    add.value = "async culture, Small team, ";
    add.dispatch("input", {});
    assert.deepEqual(tagInputs(env, "wants").map((i) => i.value), [
      "hands-on building",
      "small team",
      "mentoring",
      "open source",
      "async culture",
    ]);
    assert.equal(add.value, "");
  });

  it("N-B4-5: blur trims, drops empties and de-duplicates", () => {
    const env = setup();
    const inputs = tagInputs(env, "wants");
    inputs[0].value = "  Small Team ";
    inputs[0].dispatch("input", {});
    inputs[0].dispatch("blur", {});
    assert.deepEqual(tagInputs(env, "wants").map((i) => i.value), ["Small Team"]);

    const avoid = tagInputs(env, "avoids")[0];
    avoid.value = "   ";
    avoid.dispatch("input", {});
    avoid.dispatch("blur", {});
    assert.equal(tagInputs(env, "avoids").length, 0);
  });

  it("B4-2: every remove button names what it removes", () => {
    const env = setup();
    const removes = env.qa(".oneflow-fit-tag__remove");
    assert.ok(removes.length >= 7);
    for (const remove of removes) {
      assert.match(remove.getAttribute("aria-label"), /^Remove \S/);
    }
  });
});

describe("GFX FE-B4 · R6: fit CSS is scoped and meets the target size", () => {
  const css = readRepoFile("css/oneflow.css");
  const start = css.indexOf("/* ONEFLOW:L2 */");
  const end = css.indexOf("/* The re-entry a paused flow leaves behind");
  const block = css.slice(start, end);

  it("R6: every fit selector is scoped under .oneflow-fit (the jb-v2 cascade trap)", () => {
    const selectors = [];
    block
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@media[^{]+\{/g, "")
      .replace(/@supports[^{]+\{/g, "")
      .replace(/@container[^{]+\{/g, "")
      .replace(/\{[^{}]*\}/g, "\n")
      .split("\n")
      .join(" ")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "}")
      .forEach((s) => selectors.push(s.replace(/^}\s*/, "")));
    assert.ok(selectors.length > 20);
    for (const selector of selectors) {
      assert.match(selector, /^\.oneflow-fit[\s.:[]/, `unscoped: ${selector}`);
    }
  });

  it("B4-2: the remove button is at least 24×24", () => {
    const rule = /\.oneflow-fit \.oneflow-fit-tag__remove\s*\{([^}]*)\}/.exec(block);
    assert.ok(rule, "a scoped remove-button rule exists");
    assert.match(rule[1], /min-width:\s*24px/);
    assert.match(rule[1], /min-height:\s*24px/);
  });

  it("B4-3: tag inputs size to their content, with a size fallback", () => {
    assert.match(block, /field-sizing:\s*content/);
    const env = setup();
    assert.ok(tagInputs(env, "roles")[0].size >= 4);
  });
});
