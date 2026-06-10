import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fitProfileWizardJs = readFileSync(
  join(repoRoot, "fit-profile-wizard.js"),
  "utf8",
);

// ============================================================
// Behavioral coverage for fit-profile-wizard.js (classic-global IIFE).
//
// The module exposes window.FitProfileForm (the bucket renderers + payload
// builder shared with the Settings editor) and window.openFitProfileWizard,
// and registers a window hashchange listener for the
// #/onboarding/fit-profile deep link. It reads window.location at load
// time (file:// branch), so every context carries a location stub.
//
// The module builds real DOM, so we load it against a recording fake
// document (same approach as enhancements-wizard.test.mjs's makeFakeDom,
// extended with firstChild/insertBefore/querySelector which this module
// uses). All network goes through a recording fetch stub — no real I/O.
// ============================================================

function makeFakeDom() {
  function makeEl(tagName) {
    const listeners = new Map();
    const node = {
      tagName: String(tagName || "div").toLowerCase(),
      nodeType: 1,
      children: [],
      parentNode: null,
      attrs: new Map(),
      dataset: {},
      style: {},
      id: "",
      className: "",
      value: "",
      disabled: false,
      selected: false,
      checked: false,
      textContent: "",
      innerHTML: "",
      get firstChild() {
        return node.children.length ? node.children[0] : null;
      },
      get nextSibling() {
        if (!node.parentNode) return null;
        const sibs = node.parentNode.children;
        const i = sibs.indexOf(node);
        return i >= 0 && i + 1 < sibs.length ? sibs[i + 1] : null;
      },
      appendChild(child) {
        node.children.push(child);
        if (child && typeof child === "object") child.parentNode = node;
        return child;
      },
      removeChild(child) {
        const i = node.children.indexOf(child);
        if (i >= 0) node.children.splice(i, 1);
        if (child && typeof child === "object") child.parentNode = null;
        return child;
      },
      insertBefore(child, ref) {
        const i = ref ? node.children.indexOf(ref) : -1;
        if (i >= 0) node.children.splice(i, 0, child);
        else node.children.push(child);
        if (child && typeof child === "object") child.parentNode = node;
        return child;
      },
      setAttribute(name, val) {
        node.attrs.set(name, String(val));
        if (name === "value") node.value = String(val);
        if (name === "id") node.id = String(val);
        if (name === "disabled") node.disabled = true;
        if (name === "checked") node.checked = true;
        if (name.startsWith("data-")) {
          const key = name
            .slice(5)
            .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          node.dataset[key] = String(val);
        }
      },
      getAttribute(name) {
        return node.attrs.has(name) ? node.attrs.get(name) : null;
      },
      removeAttribute(name) {
        node.attrs.delete(name);
        if (name === "disabled") node.disabled = false;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() {},
      focus() {},
      _fire(type, props) {
        const evt = Object.assign({ target: node, preventDefault() {} }, props);
        (listeners.get(type) || []).slice().forEach((fn) => fn(evt));
      },
      querySelector(sel) {
        return queryAll(node, sel)[0] || null;
      },
      querySelectorAll(sel) {
        return queryAll(node, sel);
      },
    };
    return node;
  }
  function matches(node, sel) {
    if (!node || node.nodeType !== 1) return false;
    if (sel.startsWith(".")) {
      return String(node.className).split(/\s+/).includes(sel.slice(1));
    }
    return node.tagName === sel.toLowerCase();
  }
  function queryAll(root, sel) {
    const out = [];
    for (const child of root.children) {
      if (!child || child.nodeType !== 1) continue;
      if (matches(child, sel)) out.push(child);
      out.push(...queryAll(child, sel));
    }
    return out;
  }
  const docListeners = new Map();
  const document = {
    readyState: "complete",
    body: makeEl("body"),
    createElement(tag) {
      return makeEl(tag);
    },
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    getElementById(id) {
      return findAll(document.body, (n) => n.id === id)[0] || null;
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    _fire(type) {
      (docListeners.get(type) || []).slice().forEach((fn) => fn({}));
    },
  };
  return { document, makeEl };
}

function findAll(root, pred) {
  const out = [];
  if (!root || root.nodeType !== 1) return out;
  if (pred(root)) out.push(root);
  for (const child of root.children || []) out.push(...findAll(child, pred));
  return out;
}

function hasClass(node, cls) {
  return (
    node &&
    node.nodeType === 1 &&
    String(node.className).split(/\s+/).includes(cls)
  );
}

function loadWizard({
  config,
  protocol = "http:",
  hash = "",
  readyState = "complete",
  fetchImpl,
} = {}) {
  const { document } = makeFakeDom();
  document.readyState = readyState;
  const fetchCalls = [];
  const fetchFn = async (url, opts = {}) => {
    fetchCalls.push({
      url: String(url),
      method: (opts && opts.method) || "GET",
      headers: (opts && opts.headers) || {},
      body: (opts && opts.body) || null,
    });
    if (fetchImpl) return fetchImpl(url, opts);
    return { ok: false, status: 500, json: async () => null };
  };
  const windowListeners = new Map();
  const window = {
    COMMAND_CENTER_CONFIG: config || {},
    location: { protocol, hash, pathname: "/dash", search: "?x=1" },
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
  };
  const storage = {};
  const historyCalls = [];
  const dispatchedEvents = [];
  document.dispatchEvent = (evt) => {
    dispatchedEvents.push(evt);
  };
  const ctx = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    URL,
    fetch: fetchFn,
    localStorage: {
      setItem(k, v) {
        storage[k] = String(v);
      },
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(storage, k)
          ? storage[k]
          : null;
      },
    },
    history: {
      replaceState(...args) {
        historyCalls.push(args);
      },
    },
    CustomEvent: function CustomEvent(type, opts) {
      this.type = type;
      this.detail = opts && opts.detail;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fitProfileWizardJs, ctx, {
    filename: "fit-profile-wizard.js",
  });
  return {
    window,
    document,
    form: window.FitProfileForm,
    fetchCalls,
    storage,
    historyCalls,
    dispatchedEvents,
    fireHashChange(newHash) {
      window.location.hash = newHash;
      (windowListeners.get("hashchange") || []).forEach((fn) => fn({}));
    },
    root() {
      return document.getElementById("fitProfileWizard");
    },
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function activeStep(root) {
  const panel = findAll(
    root,
    (n) => n.dataset && n.dataset.step && n.dataset.active === "true",
  )[0];
  return panel ? Number(panel.dataset.step) : null;
}

function shellControls(root) {
  const actions = findAll(root, (n) => hasClass(n, "fp-wizard__actions"))[0];
  const [left, right] = actions.children;
  return {
    cancelBtn: left.children[0],
    backBtn: left.children[1],
    nextBtn: right.children[0],
    saveBtn: right.children[1],
  };
}

function visibleErrorText(root) {
  const hit = findAll(
    root,
    (n) =>
      hasClass(n, "fp-wizard__error") &&
      n.style.display !== "none" &&
      String(n.textContent || "").length > 0,
  )[0];
  return hit ? String(hit.textContent) : "";
}

function walkToReview(root) {
  const { nextBtn } = shellControls(root);
  let guard = 0;
  while (activeStep(root) < 7 && guard++ < 10) nextBtn._fire("click");
}

function reviewPayload(root) {
  const pre = findAll(root, (n) => hasClass(n, "fp-review__pre"))[0];
  assert.ok(pre, "review step must render the payload JSON");
  return JSON.parse(pre.textContent);
}

function findTemplateCard(root, name) {
  return findAll(
    root,
    (n) =>
      hasClass(n, "fp-template-card") &&
      (n.children || []).some((c) => c && c.textContent === name),
  )[0];
}

// A server template that passes validateClientSide once merged — used to
// seed a valid draft without driving every form field.
const ENGINEER_TEMPLATE = {
  identity: {
    targetRoles: ["Staff Engineer"],
    targetSeniority: "ic_staff",
    primaryNarrative:
      "Staff backend engineer; a decade of distributed systems shipped at scale.",
  },
  strengths: [{ name: "Distributed systems", rank: 1 }],
  wants: ["hands-on coding"],
  hardConstraints: { workMode: "remote_only" },
};

function templateAndSaveFetch({ saveResponse, saveThrows } = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = (opts && opts.method) || "GET";
    if (u.includes("/profile/template/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, template: ENGINEER_TEMPLATE }),
      };
    }
    if (u.endsWith("/profile") && method === "POST") {
      if (saveThrows) throw new Error("socket hang up");
      return (
        saveResponse || {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, updatedAt: "2026-06-10T00:00:00Z" }),
        }
      );
    }
    return { ok: false, status: 404, json: async () => null };
  };
}

async function seedEngineerDraft(env) {
  env.fireHashChange("#/onboarding/fit-profile");
  const card = findTemplateCard(env.root(), "Engineer");
  assert.ok(card, "Engineer template card must render on step 1");
  card._fire("click");
  await flush();
}

// ============================================================
// API-base resolution
// ============================================================

describe("fit-profile-wizard — API base resolution (split-port and file:// setups must reach /profile)", () => {
  it("explicit jobBoredApiUrl wins (trailing slashes stripped) so a :8080 dashboard talks to the :3847 API instead of 404ing", () => {
    const { form } = loadWizard({
      config: { jobBoredApiUrl: "http://127.0.0.1:3847///" },
    });
    assert.equal(form.profileUrl("/profile"), "http://127.0.0.1:3847/profile");
  });

  it("falls back to jobPostingScrapeUrl — the scraper server co-hosts /profile, so one configured URL is enough", () => {
    const { form } = loadWizard({
      config: { jobPostingScrapeUrl: "https://api.example.test" },
    });
    assert.equal(form.profileUrl("/profile"), "https://api.example.test/profile");
  });

  it("jobBoredApiUrl beats jobPostingScrapeUrl when both are set (the dedicated API URL is the source of truth)", () => {
    const { form } = loadWizard({
      config: {
        jobBoredApiUrl: "http://api.primary.test",
        jobPostingScrapeUrl: "http://scraper.other.test",
      },
    });
    assert.equal(form.profileUrl("/profile"), "http://api.primary.test/profile");
  });

  it("an http(s) origin with no config resolves RELATIVE so reverse proxies and co-served static just work", () => {
    const { form } = loadWizard({ config: {}, protocol: "https:" });
    assert.equal(form.profileUrl("/profile"), "/profile");
  });

  it("file:// has no origin to be relative to — falls back to the default dev port 3847", () => {
    const { form } = loadWizard({ config: {}, protocol: "file:" });
    assert.equal(form.profileUrl("/profile"), "http://127.0.0.1:3847/profile");
  });
});

// ============================================================
// buildPayload
// ============================================================

describe("fit-profile-wizard — buildPayload canonicalizes the draft into schema-shaped JSON", () => {
  it("strips blank/whitespace target roles and trims the rest — the wizard's seeded empty row must never reach the server", () => {
    const { form } = loadWizard();
    const state = form.emptyProfile();
    state.identity.targetRoles = ["  Senior PM  ", "", "   "];
    const p = form.buildPayload(state);
    assert.deepEqual(p.identity.targetRoles, ["Senior PM"]);
  });

  it("strength rank = list order (1-based), NOT any incoming rank field — reordering the list is how users re-weight scoring", () => {
    const { form } = loadWizard();
    const state = form.emptyProfile();
    state.strengths = [
      { name: "B", evidence: "", keywords: [] },
      { name: "A", evidence: "", keywords: [] },
    ];
    const p = form.buildPayload(state);
    assert.deepEqual(
      p.strengths.map((s) => [s.name, s.rank]),
      [["B", 1], ["A", 2]],
    );
  });

  it("nameless strengths are dropped, and empty evidence/keywords are omitted (the schema rejects empty noise)", () => {
    const { form } = loadWizard();
    const state = form.emptyProfile();
    state.strengths = [
      { name: "   ", evidence: "ghost", keywords: [] },
      { name: "X", evidence: "  ", keywords: ["", " k "] },
    ];
    const p = form.buildPayload(state);
    assert.equal(p.strengths.length, 1);
    assert.equal(p.strengths[0].name, "X");
    assert.ok(!("evidence" in p.strengths[0]), "blank evidence must be omitted");
    assert.deepEqual(p.strengths[0].keywords, ["k"]);
  });

  it("empty wants/avoids are omitted entirely instead of sent as empty arrays", () => {
    const { form } = loadWizard();
    const p = form.buildPayload(form.emptyProfile());
    assert.ok(!("wants" in p));
    assert.ok(!("avoids" in p));
  });

  it("starterTemplate: 'blank' is recorded as 'custom', a named template passes through, and an unset one is omitted", () => {
    const { form } = loadWizard();
    const blank = form.emptyProfile();
    blank.starterTemplate = "blank";
    assert.equal(form.buildPayload(blank).starterTemplate, "custom");
    const named = form.emptyProfile();
    named.starterTemplate = "engineer";
    assert.equal(form.buildPayload(named).starterTemplate, "engineer");
    assert.ok(!("starterTemplate" in form.buildPayload(form.emptyProfile())));
  });

  it("yearsRelevantExperience is floored to an integer and negatives/blanks are omitted (schema wants a whole number)", () => {
    const { form } = loadWizard();
    const state = form.emptyProfile();
    state.identity.yearsRelevantExperience = 7.9;
    assert.equal(form.buildPayload(state).identity.yearsRelevantExperience, 7);
    state.identity.yearsRelevantExperience = -1;
    assert.ok(
      !("yearsRelevantExperience" in form.buildPayload(state).identity),
    );
    state.identity.yearsRelevantExperience = undefined;
    assert.ok(
      !("yearsRelevantExperience" in form.buildPayload(state).identity),
    );
  });

  it("salary: floor is floored, an explicit null 'no floor' survives, and salaryRequired only appears when true", () => {
    const { form } = loadWizard();
    const state = form.emptyProfile();
    state.hardConstraints.salaryFloor = 180000.9;
    state.hardConstraints.salaryRequired = true;
    let hc = form.buildPayload(state).hardConstraints;
    assert.equal(hc.salaryFloor, 180000);
    assert.equal(hc.salaryRequired, true);
    state.hardConstraints.salaryFloor = null;
    state.hardConstraints.salaryRequired = false;
    hc = form.buildPayload(state).hardConstraints;
    assert.equal(hc.salaryFloor, null, "explicit null means 'no floor' and must survive");
    assert.ok(!("salaryRequired" in hc), "false is the default — omitted");
  });
});

// ============================================================
// validateClientSide
// ============================================================

describe("fit-profile-wizard — validateClientSide gates obviously-broken profiles before any POST", () => {
  function validPayload(form) {
    return {
      identity: {
        targetRoles: ["PM"],
        primaryNarrative: "x".repeat(form.constants.NARRATIVE_MIN),
      },
      strengths: [{ name: "Strategy", rank: 1 }],
      hardConstraints: { workMode: "remote_only" },
    };
  }

  it("a complete payload passes with zero warnings (the gate must not block legitimate saves)", () => {
    const { form } = loadWizard();
    assert.equal(form.validateClientSide(validPayload(form)).length, 0);
  });

  it("zero target roles is flagged — a profile with no roles makes every scoring run meaningless", () => {
    const { form } = loadWizard();
    const p = validPayload(form);
    p.identity.targetRoles = [];
    assert.equal(form.validateClientSide(p).length, 1);
  });

  it("the narrative length gate is exact at NARRATIVE_MIN/NARRATIVE_MAX — it feeds the LLM prompt verbatim", () => {
    const { form } = loadWizard();
    const { NARRATIVE_MIN, NARRATIVE_MAX } = form.constants;
    const p = validPayload(form);
    p.identity.primaryNarrative = "x".repeat(NARRATIVE_MIN - 1);
    assert.equal(form.validateClientSide(p).length, 1, "one under min must warn");
    p.identity.primaryNarrative = "x".repeat(NARRATIVE_MIN);
    assert.equal(form.validateClientSide(p).length, 0, "exactly min passes");
    p.identity.primaryNarrative = "x".repeat(NARRATIVE_MAX + 1);
    assert.equal(form.validateClientSide(p).length, 1, "one over max must warn");
    p.identity.primaryNarrative = "x".repeat(NARRATIVE_MAX);
    assert.equal(form.validateClientSide(p).length, 0, "exactly max passes");
  });

  it("zero strengths is flagged — strengths carry the scoring weights", () => {
    const { form } = loadWizard();
    const p = validPayload(form);
    p.strengths = [];
    assert.equal(form.validateClientSide(p).length, 1);
  });

  it("onsite/hybrid with an empty locations list warns (the location pre-filter would be defeated); remote_only does not", () => {
    const { form } = loadWizard();
    const p = validPayload(form);
    p.hardConstraints = { workMode: "hybrid_ok", acceptableLocations: [] };
    assert.equal(form.validateClientSide(p).length, 1);
    p.hardConstraints = { workMode: "remote_only", acceptableLocations: [] };
    assert.equal(form.validateClientSide(p).length, 0);
    p.hardConstraints = {
      workMode: "hybrid_ok",
      acceptableLocations: ["Austin"],
    };
    assert.equal(form.validateClientSide(p).length, 0);
  });
});

// ============================================================
// mergeStateFromProfile
// ============================================================

describe("fit-profile-wizard — mergeStateFromProfile normalizes external profiles into form state", () => {
  it("strengths are sorted by incoming rank (unranked last) so the editor shows priority order and round-trips it", () => {
    const { form } = loadWizard();
    const state = form.mergeStateFromProfile({
      strengths: [
        { name: "Second", rank: 5 },
        { name: "First", rank: 1 },
        { name: "Unranked" },
      ],
    });
    assert.deepEqual(
      state.strengths.map((s) => s.name),
      ["First", "Second", "Unranked"],
    );
    // Round-trip: ranks are re-derived from the (now correct) order.
    const p = form.buildPayload(state);
    assert.deepEqual(
      p.strengths.map((s) => [s.name, s.rank]),
      [["First", 1], ["Second", 2], ["Unranked", 3]],
    );
  });

  it("garbage input falls back to the empty draft instead of throwing mid-onboarding", () => {
    const { form } = loadWizard();
    const state = form.mergeStateFromProfile(null);
    assert.deepEqual([...state.identity.targetRoles], [""]);
    assert.equal(state.hardConstraints.workMode, "any");
    assert.equal(state.strengths.length, 0);
  });

  it("partial profiles get safe defaults (seniority 'any', empty narrative, empty constraint lists)", () => {
    const { form } = loadWizard();
    const state = form.mergeStateFromProfile({
      identity: { targetRoles: ["A"] },
      hardConstraints: { workMode: "hybrid_ok" },
    });
    assert.equal(state.identity.targetSeniority, "any");
    assert.equal(state.identity.primaryNarrative, "");
    assert.equal(state.hardConstraints.workMode, "hybrid_ok");
    assert.equal(state.hardConstraints.acceptableLocations.length, 0);
    assert.equal(state.hardConstraints.skipTitles.length, 0);
  });
});

// ============================================================
// Persistence wrappers
// ============================================================

describe("fit-profile-wizard — persistence wrappers (saveProfile/fetchProfile contract with the editor)", () => {
  it("saveProfile POSTs the profile as JSON to /profile and returns httpStatus + parsed body even on rejection — the caller branches on data.ok", async () => {
    const env = loadWizard({
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, reason: "invalid_profile" }),
      }),
    });
    const result = await env.form.saveProfile({ version: 1, marker: "abc" });
    assert.equal(result.httpStatus, 400);
    assert.equal(result.data.reason, "invalid_profile");
    const call = env.fetchCalls[0];
    assert.equal(call.url, "/profile");
    assert.equal(call.method, "POST");
    assert.equal(call.headers["Content-Type"], "application/json");
    assert.equal(JSON.parse(call.body).marker, "abc");
  });

  it("fetchProfile GETs /profile and returns the parsed body", async () => {
    const env = loadWizard({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, profile: { version: 1 } }),
      }),
    });
    const data = await env.form.fetchProfile();
    assert.equal(data.profile.version, 1);
    assert.equal(env.fetchCalls[0].method, "GET");
    assert.equal(env.fetchCalls[0].url, "/profile");
  });

  it("fetchProfile fails loud on an unparseable response instead of handing the editor undefined", async () => {
    const env = loadWizard({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("bad json");
        },
      }),
    });
    await assert.rejects(
      () => env.form.fetchProfile(),
      /profile_response_invalid/,
    );
  });
});

// ============================================================
// Hash deep-link
// ============================================================

describe("fit-profile-wizard — hash deep-link opens/closes the wizard", () => {
  it("loading the module is inert: no network, no dialog until the deep link or open helper fires", () => {
    const env = loadWizard();
    assert.equal(env.fetchCalls.length, 0);
    assert.equal(env.root(), null);
  });

  it("#/onboarding/fit-profile present at page load opens the wizard immediately (shared links must land inside onboarding)", () => {
    const env = loadWizard({ hash: "#/onboarding/fit-profile" });
    const root = env.root();
    assert.ok(root, "wizard root must exist");
    assert.equal(root.dataset.active, "true");
    assert.equal(env.document.body.style.overflow, "hidden");
    assert.equal(activeStep(root), 1, "deep link always starts at step 1");
  });

  it("a hashchange to the deep link opens the wizard without a reload; navigating away closes it and restores scroll", () => {
    const env = loadWizard();
    env.fireHashChange("#/onboarding/fit-profile");
    assert.equal(env.root().dataset.active, "true");
    env.fireHashChange("#/jobs");
    assert.equal(env.root().dataset.active, "false");
    assert.equal(env.document.body.style.overflow, "");
  });

  it("a foreign hashchange when the wizard was never opened does nothing (no phantom dialog injected)", () => {
    const env = loadWizard();
    env.fireHashChange("#/jobs");
    assert.equal(env.root(), null);
  });

  it("a deep link hit while the DOM is still loading waits for DOMContentLoaded instead of touching a half-built page", () => {
    const env = loadWizard({
      hash: "#/onboarding/fit-profile",
      readyState: "loading",
    });
    assert.equal(env.root(), null, "must not render before the DOM is ready");
    env.document._fire("DOMContentLoaded");
    assert.equal(env.root().dataset.active, "true");
  });
});

// ============================================================
// Step navigation
// ============================================================

describe("fit-profile-wizard — step navigation (Continue/Back/Save choreography)", () => {
  it("Continue walks 1→7 and the final step swaps Continue for Save — the POST is the only way forward from Review", () => {
    const env = loadWizard({ hash: "#/onboarding/fit-profile" });
    const root = env.root();
    const { nextBtn, saveBtn } = shellControls(root);
    assert.equal(activeStep(root), 1);
    assert.equal(saveBtn.style.display, "none", "Save hidden before Review");
    for (let step = 2; step <= 7; step++) {
      nextBtn._fire("click");
      assert.equal(activeStep(root), step);
    }
    assert.equal(nextBtn.style.display, "none", "Continue hidden on Review");
    assert.equal(saveBtn.style.display, "", "Save visible on Review");
  });

  it("Back is disabled on step 1 so users can't walk before the start, and re-disables on returning", () => {
    const env = loadWizard({ hash: "#/onboarding/fit-profile" });
    const root = env.root();
    const { nextBtn, backBtn } = shellControls(root);
    assert.equal(backBtn.disabled, true);
    nextBtn._fire("click");
    assert.equal(backBtn.disabled, false);
    backBtn._fire("click");
    assert.equal(activeStep(root), 1);
    assert.equal(backBtn.disabled, true);
  });

  it("steps are clamped: triggering Continue on Review programmatically must not step past the last panel", () => {
    const env = loadWizard({ hash: "#/onboarding/fit-profile" });
    const root = env.root();
    const { nextBtn } = shellControls(root);
    walkToReview(root);
    assert.equal(activeStep(root), 7);
    nextBtn._fire("click");
    assert.equal(activeStep(root), 7, "no step 8 exists — must stay on Review");
  });

  it("progress reaches 100% exactly on Review so the bar never lies about completion", () => {
    const env = loadWizard({ hash: "#/onboarding/fit-profile" });
    const root = env.root();
    const fill = findAll(root, (n) => hasClass(n, "fp-wizard__progress-fill"))[0];
    const atStart = fill.style.width;
    walkToReview(root);
    assert.equal(fill.style.width, "100%");
    assert.notEqual(atStart, "100%", "step 1 must not already read complete");
  });
});

// ============================================================
// Template picker
// ============================================================

describe("fit-profile-wizard — template picker seeds the draft from the server", () => {
  it("picking a named template POSTs /profile/template/<id>, merges the seed, and marks the card selected", async () => {
    const env = loadWizard({ fetchImpl: templateAndSaveFetch() });
    await seedEngineerDraft(env);
    const call = env.fetchCalls.find((c) =>
      c.url.includes("/profile/template/"),
    );
    assert.ok(call, "must fetch the template from the server");
    assert.equal(call.url, "/profile/template/engineer");
    assert.equal(call.method, "POST");
    const card = findTemplateCard(env.root(), "Engineer");
    assert.equal(card.dataset.selected, "true", "repaint must mark the pick");
  });

  it("the template seed round-trips into the Review JSON: roles, rank-from-order, and starterTemplate are recorded", async () => {
    const env = loadWizard({ fetchImpl: templateAndSaveFetch() });
    await seedEngineerDraft(env);
    walkToReview(env.root());
    const payload = reviewPayload(env.root());
    assert.deepEqual(payload.identity.targetRoles, ["Staff Engineer"]);
    assert.deepEqual(payload.strengths.map((s) => [s.name, s.rank]), [
      ["Distributed systems", 1],
    ]);
    assert.equal(payload.starterTemplate, "engineer");
  });

  it("'Start blank' resets the draft locally — no template fetch — and the payload records starterTemplate 'custom'", async () => {
    const env = loadWizard({ fetchImpl: templateAndSaveFetch() });
    env.fireHashChange("#/onboarding/fit-profile");
    findTemplateCard(env.root(), "Start blank")._fire("click");
    await flush();
    assert.ok(
      !env.fetchCalls.some((c) => c.url.includes("/profile/template/")),
      "blank is a local reset, not a server round trip",
    );
    walkToReview(env.root());
    assert.equal(reviewPayload(env.root()).starterTemplate, "custom");
  });

  it("a failed template fetch surfaces in the error strip with the server reason instead of silently keeping a stale draft", async () => {
    const env = loadWizard({
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ ok: false, reason: "template_store_broken" }),
      }),
    });
    env.fireHashChange("#/onboarding/fit-profile");
    findTemplateCard(env.root(), "Engineer")._fire("click");
    await flush();
    assert.match(visibleErrorText(env.root()), /template_store_broken/);
    assert.equal(activeStep(env.root()), 1, "stays on the picker for a retry");
  });
});

// ============================================================
// Resume prefill
// ============================================================

describe("fit-profile-wizard — resume prefill (Gemini draft) with honest degraded states", () => {
  function resumeFetch(response) {
    return async (url) => {
      if (String(url).includes("/profile/from-resume")) return response;
      return { ok: false, status: 404, json: async () => null };
    };
  }

  function clickResumeCard(env) {
    const card = findAll(env.root(), (n) =>
      hasClass(n, "fp-resume-prefill-card"),
    )[0];
    assert.ok(card, "resume prefill card must render on step 1");
    card._fire("click");
  }

  it("success merges the Gemini draft, records starterTemplate 'custom', and jumps straight to Identity for review", async () => {
    const env = loadWizard({
      fetchImpl: resumeFetch({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          profile: ENGINEER_TEMPLATE,
          source: "gemini",
        }),
      }),
    });
    env.fireHashChange("#/onboarding/fit-profile");
    clickResumeCard(env);
    await flush();
    assert.equal(
      activeStep(env.root()),
      2,
      "the user must land on Identity to review what Gemini wrote",
    );
    walkToReview(env.root());
    const payload = reviewPayload(env.root());
    assert.equal(payload.starterTemplate, "custom");
    assert.deepEqual(payload.identity.targetRoles, ["Staff Engineer"]);
  });

  it("404/no resume flips the card to its 'missing' state (disabled) and keeps the template picker fully usable", async () => {
    const env = loadWizard({
      fetchImpl: resumeFetch({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, reason: "no_resume_stored" }),
      }),
    });
    env.fireHashChange("#/onboarding/fit-profile");
    clickResumeCard(env);
    await flush();
    const card = findAll(env.root(), (n) =>
      hasClass(n, "fp-resume-prefill-card"),
    )[0];
    assert.equal(card.dataset.state, "missing");
    assert.equal(card.disabled, true, "no point clicking again — no resume");
    assert.equal(activeStep(env.root()), 1, "templates remain the path forward");
    assert.ok(
      findTemplateCard(env.root(), "Engineer"),
      "the template grid must still render",
    );
  });

  it("a Gemini failure shows the server message on the card and leaves it clickable for a retry", async () => {
    const env = loadWizard({
      fetchImpl: resumeFetch({
        ok: false,
        status: 500,
        json: async () => ({
          ok: false,
          reason: "gemini_failed",
          message: "Gemini exploded",
        }),
      }),
    });
    env.fireHashChange("#/onboarding/fit-profile");
    clickResumeCard(env);
    await flush();
    const card = findAll(env.root(), (n) =>
      hasClass(n, "fp-resume-prefill-card"),
    )[0];
    assert.equal(card.dataset.state, "error");
    assert.equal(card.disabled, false, "errors are retryable; only 'missing' disables");
    const hint = findAll(env.root(), (n) =>
      hasClass(n, "fp-resume-prefill__hint--error"),
    )[0];
    assert.ok(hint, "the failure must be explained next to the card");
    assert.match(hint.textContent, /Gemini exploded/);
    assert.equal(activeStep(env.root()), 1);
  });
});

// ============================================================
// submitWizard
// ============================================================

describe("fit-profile-wizard — submit: client gate, persistence side effects, honest failure paths", () => {
  it("an invalid draft never reaches the server — Save shows the warnings and performs zero POSTs", async () => {
    const env = loadWizard({ fetchImpl: templateAndSaveFetch() });
    env.fireHashChange("#/onboarding/fit-profile");
    const root = env.root();
    walkToReview(root);
    shellControls(root).saveBtn._fire("click");
    await flush();
    assert.equal(
      env.fetchCalls.filter((c) => c.method === "POST" && c.url === "/profile")
        .length,
      0,
      "the empty draft must be blocked client-side",
    );
    assert.ok(visibleErrorText(root).length > 0, "the user must see why");
    assert.equal(root.dataset.active, "true", "wizard stays open for fixes");
  });

  it("a valid save POSTs the canonical payload, sets the onboarding-complete flag, announces the save, and bounces home", async () => {
    const env = loadWizard({ fetchImpl: templateAndSaveFetch() });
    await seedEngineerDraft(env);
    const root = env.root();
    walkToReview(root);
    shellControls(root).saveBtn._fire("click");
    await flush();
    const post = env.fetchCalls.find(
      (c) => c.method === "POST" && c.url === "/profile",
    );
    assert.ok(post, "must POST /profile");
    const body = JSON.parse(post.body);
    assert.equal(body.starterTemplate, "engineer");
    assert.deepEqual(body.identity.targetRoles, ["Staff Engineer"]);
    assert.equal(
      env.storage.fitProfileOnboardingComplete,
      "1",
      "the gate that decides whether onboarding re-prompts must persist",
    );
    const saved = env.dispatchedEvents.find(
      (e) => e.type === "jobbored:fit-profile-saved",
    );
    assert.ok(saved, "the rest of the app listens for the saved event");
    assert.equal(saved.detail.updatedAt, "2026-06-10T00:00:00Z");
    assert.equal(env.historyCalls.length, 1, "must strip the onboarding hash");
    assert.equal(
      env.historyCalls[0][2],
      "/dash?x=1",
      "bounce home keeps path + query, drops only the hash",
    );
    assert.equal(root.dataset.active, "false", "wizard closes on success");
    assert.equal(env.document.body.style.overflow, "");
  });

  it("a server-side ajv rejection surfaces the field errors and keeps the wizard open — no false 'done' state", async () => {
    const env = loadWizard({
      fetchImpl: templateAndSaveFetch({
        saveResponse: {
          ok: false,
          status: 400,
          json: async () => ({
            ok: false,
            reason: "invalid_profile",
            errors: [
              {
                instancePath: "/identity/targetRoles",
                message: "must NOT have fewer than 1 items",
              },
            ],
          }),
        },
      }),
    });
    await seedEngineerDraft(env);
    const root = env.root();
    walkToReview(root);
    const { saveBtn } = shellControls(root);
    saveBtn._fire("click");
    await flush();
    assert.match(
      visibleErrorText(root),
      /\/identity\/targetRoles/,
      "the ajv instancePath must reach the user so they know what to fix",
    );
    assert.equal(root.dataset.active, "true");
    assert.ok(
      !("fitProfileOnboardingComplete" in env.storage),
      "a rejected save must not mark onboarding complete",
    );
    assert.equal(saveBtn.disabled, false, "Save re-enables for the retry");
  });

  it("a network failure reports honestly and re-enables Save — the user must never be stranded on a dead spinner", async () => {
    const env = loadWizard({
      fetchImpl: templateAndSaveFetch({ saveThrows: true }),
    });
    await seedEngineerDraft(env);
    const root = env.root();
    walkToReview(root);
    const { saveBtn } = shellControls(root);
    saveBtn._fire("click");
    await flush();
    assert.match(visibleErrorText(root), /socket hang up/);
    assert.equal(root.dataset.active, "true");
    assert.equal(saveBtn.disabled, false);
    assert.ok(!("fitProfileOnboardingComplete" in env.storage));
  });
});

// ============================================================
// Shared form builders (the Settings editor contract)
// ============================================================

describe("fit-profile-wizard — form builders mutate shared state in place and notify onChange", () => {
  it("typing the narrative writes state and the counter flags below-minimum text (live feedback before the save gate)", () => {
    const env = loadWizard();
    const state = env.form.emptyProfile();
    let changes = 0;
    const box = env.form.renderIdentityForm(state, () => changes++);
    const textarea = findAll(box, (n) => n.tagName === "textarea")[0];
    const counter = findAll(box, (n) => hasClass(n, "fp-counter"))[0];
    textarea.value = "short";
    textarea._fire("input");
    assert.equal(state.identity.primaryNarrative, "short");
    assert.equal(counter.dataset.warn, "true", "below min must warn live");
    assert.equal(changes, 1, "the host re-render hook must fire");
    textarea.value = "x".repeat(env.form.constants.NARRATIVE_MIN);
    textarea._fire("input");
    assert.equal(counter.dataset.warn, "false");
    assert.equal(changes, 2);
  });

  it("chip input commits on Enter: comma-splits pasted lists, trims, dedupes, and stops at the max", () => {
    const env = loadWizard();
    const state = env.form.emptyProfile();
    let changes = 0;
    const box = env.form.renderWantsAvoids(state, "wants", 3, () => changes++);
    const input = findAll(box, (n) => n.tagName === "input")[0];
    input.value = "remote work,  small team , remote work";
    input._fire("keydown", { key: "Enter" });
    assert.deepEqual(
      [...state.wants],
      ["remote work", "small team"],
      "paste must split on commas, trim, and drop the duplicate",
    );
    assert.equal(changes, 1);
    input.value = "ownership, equity";
    input._fire("keydown", { key: "Enter" });
    assert.deepEqual(
      [...state.wants],
      ["remote work", "small team", "ownership"],
      "entries past the max must be dropped, not silently overflowed",
    );
  });

  it("choosing remote_only hides the locations field (it doesn't apply) and writes the constraint", () => {
    const env = loadWizard();
    const state = env.form.emptyProfile();
    let changes = 0;
    const box = env.form.renderHardConstraints(state, () => changes++);
    const remoteLabel = findAll(
      box,
      (n) => hasClass(n, "fp-radio") && n.dataset.value === "remote_only",
    )[0];
    const radio = findAll(remoteLabel, (n) => n.tagName === "input")[0];
    radio._fire("change");
    assert.equal(state.hardConstraints.workMode, "remote_only");
    assert.equal(changes, 1);
    const locationField = findAll(box, (n) =>
      findAll(n, (c) => c.textContent === "Acceptable locations").length > 0,
    )
      .filter((n) => hasClass(n, "fp-field"))
      .pop();
    assert.ok(locationField, "locations field must exist in the form");
    assert.equal(
      locationField.style.display,
      "none",
      "remote-only must hide a filter that cannot apply",
    );
    // Flipping back to hybrid reveals it again — the field is hidden, not lost.
    const hybridLabel = findAll(
      box,
      (n) => hasClass(n, "fp-radio") && n.dataset.value === "hybrid_ok",
    )[0];
    findAll(hybridLabel, (n) => n.tagName === "input")[0]._fire("change");
    assert.equal(state.hardConstraints.workMode, "hybrid_ok");
    assert.equal(locationField.style.display, "");
  });

  it("the strengths move handle reorders state so payload rank weights follow the new order", () => {
    const env = loadWizard();
    const state = env.form.emptyProfile();
    state.strengths = [
      { name: "Alpha", evidence: "", keywords: [] },
      { name: "Beta", evidence: "", keywords: [] },
    ];
    const box = env.form.renderStrengthsList(state, () => {});
    const firstItem = findAll(box, (n) => hasClass(n, "fp-list__item"))[0];
    const moveDown = findAll(
      firstItem,
      (n) => n.getAttribute && n.getAttribute("title") === "Move down",
    )[0];
    moveDown._fire("click");
    assert.deepEqual(
      state.strengths.map((s) => s.name),
      ["Beta", "Alpha"],
    );
    const p = env.form.buildPayload(state);
    assert.deepEqual(
      p.strengths.map((s) => [s.name, s.rank]),
      [["Beta", 1], ["Alpha", 2]],
      "rank 1 must now belong to the strength the user promoted",
    );
  });
});
