/**
 * HOLES lane SHEETS · R13 — the Blacklist is surfaced, keyed by URL plus the
 * board's posting id, and every block can be lifted.
 *
 * Dismissing a role appends it to the Blacklist tab so discovery never adds
 * it back. Nothing in the app ever showed that tab, and a block was keyed
 * by URL alone: when the worker re-canonicalized a Link, the old block no
 * longer matched it and could not be found to lift. Now each row also
 * carries the posting's provider id (column F), a "Dismissed & blocked"
 * manager lists one entry per role, and Restore lifts every block for it
 * and un-dismisses its Pipeline row.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  COL,
  HEADERS,
  createFakeSheets,
  loadReader,
  loadWriteback,
  pipelineRow,
  rowByLink,
  valuesOk,
} from "./holes-sheets-fake.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const GH = "https://boards.greenhouse.io/acme/jobs/101";
const GH_MOVED = "https://job-boards.greenhouse.io/acme/jobs/101?gh_src=abc";
const GH_KEY = "provider:greenhouse:acme:101";
const BL_HEADER = ["URL", "Dismissed At", "Title", "Company", "Reason", "Provider ID"];

describe("R13 · provider ids", () => {
  const fake = createFakeSheets({ Pipeline: [HEADERS.slice()] });
  const { sw } = loadWriteback(fake);

  it("the same posting on another host or with a tracking param keys the same", () => {
    assert.equal(sw.providerKeyForUrl(GH), GH_KEY);
    assert.equal(sw.providerKeyForUrl(GH_MOVED), GH_KEY);
    assert.equal(
      sw.providerKeyForUrl("https://jobs.lever.co/Globex/5ac21346-8e0c/apply"),
      "provider:lever:globex:5ac21346-8e0c",
    );
    assert.equal(
      sw.providerKeyForUrl("https://jobs.ashbyhq.com/initech/c0ffee-11"),
      "provider:ashby:initech:c0ffee-11",
    );
  });

  it("a URL that names no posting id has no provider key", () => {
    assert.equal(sw.providerKeyForUrl("https://example.com/careers/role-9"), "");
    assert.equal(sw.providerKeyForUrl("https://boards.greenhouse.io/acme"), "");
    assert.equal(sw.providerKeyForUrl("not a url"), "");
  });
});

describe("R13 · dismiss records the provider id beside the URL", () => {
  it("a new Blacklist tab gets a Provider ID header, and the row carries the key", async () => {
    const fake = createFakeSheets({
      Pipeline: [HEADERS.slice(), pipelineRow({ title: "Eng", company: "Acme", link: GH })],
    });
    const env = loadWriteback(fake);
    env.load();
    assert.equal(await env.sw.dismissJob(env.indexOf(GH)), true);
    const [header, row] = fake.rows("Blacklist");
    assert.deepEqual([...header], BL_HEADER);
    assert.equal(row[0], GH);
    assert.equal(row[5], GH_KEY);
  });
});

function blockedSheet() {
  return createFakeSheets({
    Pipeline: [
      HEADERS.slice(),
      pipelineRow({ title: "Eng", company: "Acme", link: GH_MOVED, dismissedAt: "2026-09-20T10:00:00.000Z" }),
    ],
    Blacklist: [
      BL_HEADER,
      [GH, "2026-09-01T10:00:00.000Z", "Eng", "Acme", ""],
      ["https://example.com/careers/role-9", "2026-09-10T10:00:00.000Z", "Ops Lead", "Hooli", ""],
      [GH_MOVED, "2026-09-20T10:00:00.000Z", "Eng", "Acme", "", GH_KEY],
    ],
  });
}

describe("R13 · listBlockedRoles and restoreBlockedRole", () => {
  it("lists one entry per role, newest first, grouping a re-keyed URL by provider id", async () => {
    const env = loadWriteback(blockedSheet());
    env.load();
    const entries = JSON.parse(JSON.stringify(await env.sw.listBlockedRoles()));
    assert.deepEqual(
      entries.map((e) => [e.title, e.providerKey, e.count]),
      [
        ["Eng", GH_KEY, 2],
        ["Ops Lead", "", 1],
      ],
    );
  });

  it("a Sheet with no Blacklist tab has nothing blocked", async () => {
    const env = loadWriteback(createFakeSheets({ Pipeline: [HEADERS.slice()] }));
    assert.equal((await env.sw.listBlockedRoles()).length, 0);
  });

  it("Restore clears W even when this tab loaded the role before it was dismissed", async () => {
    const fake = blockedSheet();
    const env = loadWriteback(fake);
    env.load();
    env.state.data.forEach((job) => (job.dismissedAt = null));
    const [eng] = await env.sw.listBlockedRoles();
    assert.equal(await env.sw.restoreBlockedRole(eng), true);
    assert.equal(rowByLink(fake, GH_MOVED)[COL.dismissedAt], "");
  });

  it("Restore clears W on every matching row, not just the first (an active duplicate above)", async () => {
    const fake = createFakeSheets({
      Pipeline: [
        HEADERS.slice(),
        pipelineRow({ title: "Eng", company: "Acme", link: GH }),
        pipelineRow({ title: "Eng", company: "Acme", link: GH, dismissedAt: "2026-09-20T10:00:00.000Z" }),
      ],
      Blacklist: [BL_HEADER, [GH, "2026-09-20T10:00:00.000Z", "Eng", "Acme", "", GH_KEY]],
    });
    const env = loadWriteback(fake);
    env.load();
    const [eng] = await env.sw.listBlockedRoles();
    assert.equal(await env.sw.restoreBlockedRole(eng), true);
    assert.deepEqual(fake.rows("Pipeline").slice(1).map((r) => r[COL.dismissedAt]), ["", ""]);
    assert.equal(fake.rows("Blacklist").length, 1);
  });

  it("Restore refuses when the matching rows are different roles, and writes nothing", async () => {
    const fake = createFakeSheets({
      Pipeline: [
        HEADERS.slice(),
        pipelineRow({ title: "Eng", company: "Acme", link: GH, dismissedAt: "2026-09-20T10:00:00.000Z" }),
        pipelineRow({ title: "Sales Lead", company: "Other Co", link: GH_MOVED }),
      ],
      Blacklist: [BL_HEADER, [GH, "2026-09-20T10:00:00.000Z", "Eng", "Acme", "", GH_KEY]],
    });
    const env = loadWriteback(fake);
    env.load();
    const [eng] = await env.sw.listBlockedRoles();
    assert.equal(await env.sw.restoreBlockedRole(eng), false);
    assert.equal(fake.requests.filter((r) => r.method !== "GET").length, 0);
    assert.equal(fake.rows("Blacklist").length, 2);
  });

  it("a block delete aborts when the Blacklist shifts before deleteDimension", async () => {
    const fake = blockedSheet();
    const env = loadWriteback(fake);
    env.load();
    const [eng] = await env.sw.listBlockedRoles();
    fake.intercept(async (req) => {
      if (/fields=sheets\.properties/.test(req.url)) {
        fake.rows("Blacklist").splice(1, 0, ["https://example.com/careers/new-1", "2026-10-01T10:00:00.000Z", "New", "Hooli", ""]);
      }
      return null;
    });
    assert.equal(await env.sw.restoreBlockedRole(eng), false);
    assert.deepEqual(
      fake.rows("Blacklist").slice(1).map((r) => r[0]),
      ["https://example.com/careers/new-1", GH, "https://example.com/careers/role-9", GH_MOVED],
      "no block was deleted, least of all someone else's",
    );
    assert.equal(rowByLink(fake, GH_MOVED)[COL.dismissedAt], "2026-09-20T10:00:00.000Z", "W put back");
  });

  it("Restore lifts every block for the role and un-dismisses its Pipeline row", async () => {
    const fake = blockedSheet();
    const env = loadWriteback(fake);
    env.load();
    const [eng] = await env.sw.listBlockedRoles();
    assert.equal(await env.sw.restoreBlockedRole(eng), true);
    assert.deepEqual(
      fake.rows("Blacklist").slice(1).map((r) => r[0]),
      ["https://example.com/careers/role-9"],
      "both the old-URL block and the new one are gone",
    );
    assert.equal(rowByLink(fake, GH_MOVED)[COL.dismissedAt], "");
    assert.equal(env.state.data[env.indexOf(GH_MOVED)].dismissedAt, null);
  });

  it("a block whose role left the Pipeline is lifted on its own", async () => {
    const fake = blockedSheet();
    const env = loadWriteback(fake);
    env.load();
    const entries = await env.sw.listBlockedRoles();
    const ops = entries.find((e) => e.title === "Ops Lead");
    const writesBefore = fake.writes().filter((w) => /values:batchUpdate/.test(w.url)).length;
    assert.equal(await env.sw.restoreBlockedRole(ops), true);
    assert.equal(fake.rows("Blacklist").length, 3);
    assert.equal(
      fake.writes().filter((w) => /values:batchUpdate/.test(w.url)).length,
      writesBefore,
      "no Pipeline cell written",
    );
  });

  it("a failed block delete keeps the role dismissed", async () => {
    const fake = blockedSheet();
    const env = loadWriteback(fake);
    env.load();
    fake.failWhen((r) => r.method === "POST" && /:batchUpdate$/.test(r.url) && !/values:/.test(r.url), 500);
    const [eng] = await env.sw.listBlockedRoles();
    assert.equal(await env.sw.restoreBlockedRole(eng), false);
    assert.equal(rowByLink(fake, GH_MOVED)[COL.dismissedAt], "2026-09-20T10:00:00.000Z");
    assert.equal(fake.rows("Blacklist").length, 4);
  });
});

/* ---------------- the manager UI ---------------- */

function fakeDom() {
  const all = [];
  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(),
      children: [],
      parentNode: null,
      attributes: {},
      className: "",
      textContent: "",
      hidden: false,
      disabled: false,
      listeners: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
      replaceChildren(...kids) { this.children = []; kids.forEach((k) => this.appendChild(k)); },
      addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); },
      click() { return Promise.all((this.listeners.click || []).map((fn) => fn({ preventDefault() {} }))); },
      focus() {},
    };
    all.push(n);
    return n;
  }
  const doc = { createElement: node, body: node("body"), head: node("head"), activeElement: null };
  return { doc, all };
}

function textOf(n) {
  return [n.textContent, ...n.children.map(textOf)].join(" ").replace(/\s+/g, " ").trim();
}

function findAll(n, pred, out = []) {
  if (pred(n)) out.push(n);
  n.children.forEach((c) => findAll(c, pred, out));
  return out;
}

function loadManager(writer) {
  const { doc } = fakeDom();
  const opened = [];
  const win = {
    document: doc,
    JobBoredApp: { sheetsWrite: writer },
    JobBoredA11y: {
      dialog: {
        open(el, opts) {
          opened.push({ el, opts });
          return { el, close: () => opts.onClose && opts.onClose("programmatic") };
        },
      },
    },
  };
  const ctx = vm.createContext({ window: win, document: doc, URL, console, Date, Promise });
  vm.runInContext(readFileSync(join(repoRoot, "blacklist-manager.js"), "utf8"), ctx, {
    filename: "blacklist-manager.js",
  });
  return { api: win.JobBoredBlacklistManager, doc, opened };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("R13 · the Dismissed & blocked manager", () => {
  const ENTRIES = [
    { key: GH_KEY, url: GH, providerKey: GH_KEY, title: "Eng", company: "Acme", dismissedAt: "2026-09-20T10:00:00.000Z", count: 2 },
    { key: "u", url: "javascript:alert(1)", providerKey: "", title: "Odd row", company: "", dismissedAt: "", count: 1 },
  ];

  it("lists each blocked role with its own Restore, and never links an unsafe URL", async () => {
    const m = loadManager({ listBlockedRoles: async () => ENTRIES, restoreBlockedRole: async () => true });
    m.api.open();
    await flush();
    const dialog = m.opened[0].el;
    assert.match(textOf(dialog), /Dismissed & blocked/);
    const items = findAll(dialog, (n) => n.tagName === "LI");
    assert.equal(items.length, 2);
    assert.match(textOf(items[0]), /Eng/);
    assert.match(textOf(items[0]), /Acme/);
    const restore = findAll(items[0], (n) => n.tagName === "BUTTON")[0];
    assert.equal(restore.textContent, "Restore");
    assert.match(restore.getAttribute("aria-label"), /Restore Eng at Acme/);
    const links = findAll(dialog, (n) => n.tagName === "A");
    assert.ok(links.every((a) => /^https?:/.test(a.getAttribute("href"))), "no javascript: href");
  });

  it("Restore removes the entry and says so; a failure keeps it and says so", async () => {
    let ok = false;
    const m = loadManager({ listBlockedRoles: async () => ENTRIES.slice(0, 1), restoreBlockedRole: async () => ok });
    m.api.open();
    await flush();
    const dialog = m.opened[0].el;
    const button = () => findAll(dialog, (n) => n.tagName === "BUTTON" && n.textContent === "Restore")[0];
    await button().click();
    await flush();
    assert.equal(findAll(dialog, (n) => n.tagName === "LI").length, 1);
    assert.match(textOf(dialog), /Couldn’t restore Eng at Acme/);
    ok = true;
    await button().click();
    await flush();
    assert.equal(findAll(dialog, (n) => n.tagName === "LI").length, 0);
    assert.match(textOf(dialog), /Restored Eng at Acme/);
  });

  it("an empty Blacklist says nothing is blocked; a read failure offers Retry", async () => {
    const empty = loadManager({ listBlockedRoles: async () => [], restoreBlockedRole: async () => true });
    empty.api.open();
    await flush();
    assert.match(textOf(empty.opened[0].el), /Nothing is blocked/);

    let fail = true;
    const broken = loadManager({
      listBlockedRoles: async () => {
        if (fail) throw new Error("HTTP 500");
        return ENTRIES.slice(0, 1);
      },
      restoreBlockedRole: async () => true,
    });
    broken.api.open();
    await flush();
    const dialog = broken.opened[0].el;
    assert.match(textOf(dialog), /Couldn’t read/);
    fail = false;
    await findAll(dialog, (n) => n.tagName === "BUTTON" && n.textContent === "Retry")[0].click();
    await flush();
    assert.equal(findAll(dialog, (n) => n.tagName === "LI").length, 1);
  });
});

describe("R13 · the sync bar opens the manager", () => {
  it("has a Blocked button that loads the manager once and opens it", async () => {
    const rows = [HEADERS, pipelineRow({ title: "Eng", company: "Acme", link: GH })];
    const env = loadReader({ fetch: async () => valuesOk(rows) });
    const injected = [];
    const opened = [];
    env.doc.head.appendChild = (el) => {
      injected.push(el);
      if (el.tagName === "SCRIPT") {
        env.win.JobBoredBlacklistManager = { open: (opener) => opened.push(opener) };
        el.onload();
      }
      return el;
    };
    await env.sr.loadAllData();
    const button = env.doc.getElementById("jbSyncBlockedBtn");
    assert.ok(button, "the sync bar carries the entry point");
    assert.equal(button.textContent, "Blocked");
    await env.sr.openBlockedRoles(button);
    await env.sr.openBlockedRoles(button);
    assert.deepEqual(
      injected.map((el) => el.tagName),
      ["LINK", "SCRIPT"],
      "stylesheet and script load once",
    );
    assert.equal(opened.length, 2);
  });
});
