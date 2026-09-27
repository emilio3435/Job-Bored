/* ============================================
   LEADTABS — Leads core logic (no DOM)

   Classic-global IIFE under window.JobBoredApp.leadsCore — NOT an ES module.
   Rows are parsePipelineCSV objects. Two layers decide what Filters shows:

     1. Profile layer: runPreFilter's rejections (profile-aware-scorer.ts)
        plus discoveryProfile.companyBlocklist. Every hidden row carries its
        reason; "Show them" re-includes them.
     2. View layer: search, lens, facets and sort. Never touches the profile.

   Saved views and the change history live in IndexedDB database
   `jobbored-leads`, store `records` (kind "view" | "history", last 50).
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const leadsCore = root.leadsCore || (root.leadsCore = {});

  const WORK_MODES = ["remote", "hybrid", "onsite"];
  const BLOCKLIST_CAP = 50;
  const HISTORY_LIMIT = 50;
  const DAY_MS = 24 * 60 * 60 * 1000;

  /* ------------------------------------------------------------------
     Work mode
     ------------------------------------------------------------------ */

  function isWorkMode(value) {
    return WORK_MODES.indexOf(value) >= 0;
  }

  /** K0's parser, read at call time so load order does not matter. */
  function parseLocation(text) {
    const sheetsRead = root.sheetsRead;
    const parse = sheetsRead && sheetsRead.parseWorkModeFromLocation;
    if (typeof parse !== "function") return "";
    const bucket = parse(String(text || ""));
    return isWorkMode(bucket) ? bucket : "";
  }

  /**
   * The bucket column Z holds, or "". parsePipelineCSV also fills
   * `workMode` from the location when Z is blank, so only a row whose
   * `workModeSource` is "column" carries an explicit bucket.
   */
  function columnWorkMode(row) {
    if (!row || row.workModeSource !== "column") return "";
    const column = String(row.workMode || "").trim().toLowerCase();
    return isWorkMode(column) ? column : "";
  }

  /** Column Z when it holds a known word, otherwise the location text. */
  function workModeFor(row) {
    return columnWorkMode(row) || parseLocation(row && row.location);
  }

  /**
   * inferRemoteBucket's haystack: location, description, "why" line and
   * title. runPreFilter's remote_only check reads this wider text, so the
   * profile layer does too.
   */
  function remoteBucketFor(row) {
    const column = columnWorkMode(row);
    if (column) return column;
    const haystack = [
      row && row.location,
      descriptionOf(row),
      row && row.fitAssessment,
      row && row.title,
    ]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");
    return parseLocation(haystack) || "unknown";
  }

  function descriptionOf(row) {
    if (!row) return "";
    return String(row.descriptionText || row.description || "");
  }

  /* ------------------------------------------------------------------
     Salary (port of profile-aware-scorer.ts parseSalaryMax)
     ------------------------------------------------------------------ */

  function parseSalaryMax(text) {
    const cleaned = String(text || "").replace(/\$/g, "").toLowerCase();
    if (!cleaned.trim()) return null;
    const matches = cleaned.match(/[\d][\d,]*\.?\d*\s*k?/g);
    if (!matches || matches.length === 0) return null;
    const values = [];
    for (const raw of matches) {
      const hasK = /k$/.test(raw.trim());
      const numeric = raw.replace(/k$/, "").replace(/,/g, "").trim();
      if (!numeric) continue;
      const parsed = Number.parseFloat(numeric);
      if (!Number.isFinite(parsed) || parsed <= 0) continue;
      const dollars = hasK ? parsed * 1000 : parsed;
      if (!hasK && dollars < 1000) continue;
      values.push(dollars);
    }
    if (values.length === 0) return null;
    return Math.max(...values);
  }

  /* ------------------------------------------------------------------
     Profile layer
     ------------------------------------------------------------------ */

  const SPONSORSHIP_DENY_PHRASES = [
    "no sponsorship",
    "us citizens only",
    "must be authorized to work in the us without sponsorship",
    "no visa sponsorship",
  ];

  const REASONS = {
    company_blocklist: "Avoided company",
    skip_title_match: "Skip title",
    work_mode_mismatch: "Work mode",
    location_outside_acceptable: "Outside your locations",
    work_auth_mismatch: "Work authorization",
    salary_missing_but_required: "No posted salary",
    salary_below_floor: "Under your salary floor",
  };

  function companyBlocklist(profile) {
    const discovery = (profile && profile.discoveryProfile) || {};
    const list = Array.isArray(discovery.companyBlocklist)
      ? discovery.companyBlocklist
      : [];
    const out = [];
    for (const entry of list) {
      const name = String(entry || "").trim().toLowerCase();
      if (name && out.indexOf(name) < 0) out.push(name);
      if (out.length >= BLOCKLIST_CAP) break;
    }
    return out;
  }

  /**
   * First violation or null. Blocklist first, then runPreFilter's order:
   * skip title, work mode, location, work auth, salary.
   */
  function hideReason(row, profile) {
    const hc = (profile && profile.hardConstraints) || {};

    const company = String((row && row.company) || "").trim().toLowerCase();
    if (company && companyBlocklist(profile).indexOf(company) >= 0) {
      return {
        reason: "company_blocklist",
        detail: `Company "${row.company}" is on your avoid list.`,
      };
    }

    const titleLower = String((row && row.title) || "").toLowerCase();
    for (const phrase of hc.skipTitles || []) {
      const needle = String(phrase || "").trim().toLowerCase();
      if (needle && titleLower.includes(needle)) {
        return {
          reason: "skip_title_match",
          detail: `Title contains skip phrase "${String(phrase).trim()}".`,
          matchedPhrase: String(phrase).trim(),
        };
      }
    }

    if (hc.workMode === "remote_only") {
      const bucket = remoteBucketFor(row);
      if (bucket !== "remote") {
        return {
          reason: "work_mode_mismatch",
          detail: `Profile requires remote_only; listing remoteBucket=${bucket}.`,
          remoteBucket: bucket,
        };
      }
    }

    if (hc.workMode === "hybrid_ok" || hc.workMode === "onsite_ok") {
      const acceptable = (hc.acceptableLocations || [])
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean);
      if (acceptable.length > 0) {
        const locationLower = String((row && row.location) || "").toLowerCase();
        if (!acceptable.some((loc) => locationLower.includes(loc))) {
          return {
            reason: "location_outside_acceptable",
            detail: `Location "${(row && row.location) || ""}" outside acceptableLocations [${acceptable.join(", ")}].`,
          };
        }
      }
    }

    if (hc.workAuth === "needs_sponsorship") {
      const descLower = descriptionOf(row).toLowerCase();
      for (const phrase of SPONSORSHIP_DENY_PHRASES) {
        if (descLower.includes(phrase)) {
          return {
            reason: "work_auth_mismatch",
            detail: `Listing description signals "${phrase}".`,
          };
        }
      }
    }

    const parsedMax = parseSalaryMax(row && row.salary);
    if (parsedMax === null) {
      if (hc.salaryRequired) {
        return {
          reason: "salary_missing_but_required",
          detail: "Profile requires published salary; listing has none.",
        };
      }
    } else if (typeof hc.salaryFloor === "number" && parsedMax < hc.salaryFloor) {
      return {
        reason: "salary_below_floor",
        detail: `Parsed salary ${parsedMax} below floor ${hc.salaryFloor}.`,
      };
    }

    return null;
  }

  /* ------------------------------------------------------------------
     Tokenizer, synonyms, highlights
     ------------------------------------------------------------------ */

  // [short, long]. Text is expanded to the long form before matching, so
  // either spelling in the query finds either spelling in the row.
  const SYNONYMS = [
    ["revops", "revenue operations"],
    ["sales ops", "sales operations"],
  ];

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function expandSynonyms(lowerText) {
    let out = lowerText;
    for (const [short, long] of SYNONYMS) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(short)}\\b`, "g"), long);
    }
    return out;
  }

  /** Lower-cased, synonym-expanded query tokens. */
  function tokenize(query) {
    return expandSynonyms(String(query || "").toLowerCase())
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function searchHaystack(row) {
    const raw = [
      row.title,
      row.company,
      row.location,
      row.source,
      row.status,
      row.fitAssessment,
    ]
      .map((part) => String(part || ""))
      .join(" ")
      .toLowerCase();
    // Keep the original spelling too, so a partial like "ops" still hits
    // "RevOps" after the expansion rewrites it.
    return `${raw} ${expandSynonyms(raw)}`;
  }

  function matchesQuery(row, query) {
    const tokens = tokenize(query);
    if (!tokens.length) return true;
    const hay = searchHaystack(row);
    return tokens.every((token) => hay.includes(token));
  }

  /**
   * Ranges [start, end) in `text` to wrap in <mark>, merged and sorted.
   * A query for one synonym spelling highlights the other spelling too.
   */
  function highlightRanges(text, query) {
    const source = String(text || "");
    const lowerQuery = String(query || "").toLowerCase();
    const needles = new Set();
    for (const token of lowerQuery.split(/\s+/)) {
      if (token) needles.add(token);
    }
    const expanded = tokenize(query);
    for (const token of expanded) needles.add(token);
    for (const [short, long] of SYNONYMS) {
      const longWords = long.split(" ");
      if (longWords.every((word) => expanded.indexOf(word) >= 0)) {
        needles.add(short);
        needles.add(long);
      }
    }
    if (!needles.size || !source) return [];

    const lower = source.toLowerCase();
    const ranges = [];
    for (const needle of needles) {
      let from = 0;
      while (from <= lower.length - needle.length) {
        const at = lower.indexOf(needle, from);
        if (at < 0) break;
        ranges.push([at, at + needle.length]);
        from = at + 1;
      }
    }
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const [start, end] of ranges) {
      const last = merged[merged.length - 1];
      if (last && start <= last.end) {
        last.end = Math.max(last.end, end);
      } else {
        merged.push({ start, end });
      }
    }
    return merged;
  }

  /* ------------------------------------------------------------------
     Role lens
     ------------------------------------------------------------------ */

  const STOP_WORDS = new Set(["of", "the", "and", "&"]);

  function roleWords(text) {
    return expandSynonyms(String(text || "").toLowerCase())
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word && !STOP_WORDS.has(word));
  }

  /** Every word of the target role appears in the title. */
  function roleMatches(title, role) {
    const wanted = roleWords(role);
    if (!wanted.length) return false;
    const have = new Set(roleWords(title));
    return wanted.every((word) => have.has(word));
  }

  function targetRoles(profile) {
    const identity = (profile && profile.identity) || {};
    return Array.isArray(identity.targetRoles)
      ? identity.targetRoles.map((role) => String(role || "").trim()).filter(Boolean)
      : [];
  }

  /** Index of the first target role the title matches, in rank order; -1 if none. */
  function roleIndexFor(row, roles) {
    for (let i = 0; i < roles.length; i++) {
      if (roleMatches(row && row.title, roles[i])) return i;
    }
    return -1;
  }

  function passLens(row, lens, roles) {
    const key = lens || "targets";
    if (key === "all") return true;
    const index = roleIndexFor(row, roles);
    if (key === "targets") return index >= 0;
    if (key === "other") return index < 0;
    const wanted = roles.indexOf(key);
    return wanted >= 0 && index === wanted;
  }

  /* ------------------------------------------------------------------
     View layer
     ------------------------------------------------------------------ */

  const DEFAULT_VIEW = Object.freeze({
    q: "",
    lens: "targets",
    fitMin: 0,
    matchMin: 0,
    salaryMin: 0,
    foundWithinDays: 0,
    sources: [],
    workModes: [],
    stages: [],
    companies: [],
    starred: false,
    sort: "fit",
  });

  function normalizeView(view) {
    const v = Object.assign({}, DEFAULT_VIEW, view || {});
    for (const key of ["sources", "workModes", "stages", "companies"]) {
      v[key] = Array.isArray(v[key]) ? v[key].slice() : [];
    }
    return v;
  }

  function stageOf(row) {
    return String((row && row.status) || "").trim();
  }

  function timeOf(row) {
    const date = row && row.dateFound;
    if (date instanceof Date) return date.getTime();
    if (date == null || date === "") return NaN;
    return new Date(date).getTime();
  }

  function numberOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  /** Trimmed and lower-cased, so filters match the values facetCounts shows. */
  function facetKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  function inList(list, value) {
    if (!list.length) return true;
    const key = facetKey(value);
    return list.some((item) => facetKey(item) === key);
  }

  /**
   * View filters except the lens. `skip` names one facet whose own filter
   * is ignored, so that facet's counts show what ticking it would add.
   */
  function passView(row, view, options) {
    const opts = options || {};
    const skip = opts.skip || "";
    const now = typeof opts.now === "number" ? opts.now : Date.now();

    if (skip !== "sources" && !inList(view.sources, row.source)) return false;
    if (skip !== "workModes" && !inList(view.workModes, workModeFor(row))) return false;
    if (skip !== "stages" && !inList(view.stages, stageOf(row))) return false;
    if (skip !== "companies" && !inList(view.companies, row.company)) return false;

    if (view.fitMin) {
      const fit = numberOrNull(row.fitScore);
      if (fit === null || fit < view.fitMin) return false;
    }
    if (view.matchMin) {
      const match = numberOrNull(row.matchScore);
      if (match === null || match < view.matchMin) return false;
    }
    if (view.salaryMin) {
      const salary = parseSalaryMax(row.salary);
      if (salary === null || salary < view.salaryMin) return false;
    }
    if (view.foundWithinDays) {
      const found = timeOf(row);
      if (!Number.isFinite(found) || now - found > view.foundWithinDays * DAY_MS) {
        return false;
      }
    }
    if (view.starred && !row.favorite) return false;
    if (!matchesQuery(row, view.q)) return false;
    return true;
  }

  function isDismissed(row) {
    return !!(row && row.dismissedAt);
  }

  /**
   * Both layers applied.
   * @returns {{ rows: object[], hidden: {row: object, reason: string, detail: string}[] }}
   *   `rows` is visible and sorted; with `showHidden` it also holds copies
   *   of the hidden rows, each marked `_hiddenReason` and pointing at the
   *   original through `_source`. `hidden` lists the rows the
   *   profile hides that the view and lens would otherwise show.
   */
  function filterLeads(rows, profile, view, options) {
    const opts = options || {};
    const v = normalizeView(view);
    const roles = targetRoles(profile);
    const visible = [];
    const hidden = [];
    for (const row of rows || []) {
      if (!row || isDismissed(row)) continue;
      if (!passView(row, v, opts) || !passLens(row, v.lens, roles)) continue;
      const why = hideReason(row, profile);
      if (why) {
        hidden.push(Object.assign({ row }, why));
      } else {
        visible.push(row);
      }
    }
    let out = visible;
    if (opts.showHidden) {
      out = visible.concat(
        hidden.map((entry) =>
          // A copy, so the markers never land on the sheet row; row
          // actions write through `_source`, the original object.
          Object.assign({}, entry.row, {
            _hiddenReason: entry.reason,
            _hiddenDetail: entry.detail,
            _source: entry.row,
          }),
        ),
      );
    }
    return { rows: sortLeads(out, v.sort), hidden };
  }

  /**
   * Live totals for the agent and the review bar.
   * @returns {{ visible: number, hidden: number, byReason: Object<string, number> }}
   */
  function countsFor(rows, profile, view) {
    const result = filterLeads(rows, profile, view);
    const byReason = {};
    for (const entry of result.hidden) {
      byReason[entry.reason] = (byReason[entry.reason] || 0) + 1;
    }
    return {
      visible: result.rows.length,
      hidden: result.hidden.length,
      byReason,
    };
  }

  /* ------------------------------------------------------------------
     Facet counts
     ------------------------------------------------------------------ */

  function fitBand(row) {
    const fit = numberOrNull(row.fitScore);
    if (fit !== null && fit >= 8) return "high";
    if (fit !== null && fit >= 6) return "mid";
    return "low";
  }

  /**
   * Counts per facet value. Each list facet is counted with its own filter
   * skipped; the lens counts ignore the lens. Profile-hidden rows count
   * only when `showHidden` is set.
   */
  function facetCounts(rows, profile, view, options) {
    const opts = options || {};
    const v = normalizeView(view);
    const roles = targetRoles(profile);
    const pool = (rows || []).filter(
      (row) => row && !isDismissed(row) && (opts.showHidden || !hideReason(row, profile)),
    );

    function tally(skip, valueOf) {
      const counts = {};
      for (const row of pool) {
        if (!passView(row, v, Object.assign({}, opts, { skip }))) continue;
        if (!passLens(row, v.lens, roles)) continue;
        const value = valueOf(row);
        if (!value) continue;
        counts[value] = (counts[value] || 0) + 1;
      }
      return counts;
    }

    const workModes = tally("workModes", workModeFor);
    for (const mode of WORK_MODES) workModes[mode] = workModes[mode] || 0;

    const lens = {
      all: 0,
      targets: 0,
      other: 0,
      byRole: {},
      fitBands: {},
    };
    for (const role of roles) lens.byRole[role] = 0;
    const bands = { all: { high: 0, mid: 0, low: 0 }, targets: { high: 0, mid: 0, low: 0 }, other: { high: 0, mid: 0, low: 0 } };
    for (const role of roles) bands[role] = { high: 0, mid: 0, low: 0 };
    let starred = 0;
    for (const row of pool) {
      if (!passView(row, v, opts)) continue;
      const band = fitBand(row);
      const index = roleIndexFor(row, roles);
      lens.all += 1;
      bands.all[band] += 1;
      if (index >= 0) {
        lens.targets += 1;
        bands.targets[band] += 1;
        lens.byRole[roles[index]] += 1;
        bands[roles[index]][band] += 1;
      } else {
        lens.other += 1;
        bands.other[band] += 1;
      }
      if (row.favorite && passLens(row, v.lens, roles)) starred += 1;
    }
    lens.fitBands = bands;

    return {
      workModes,
      stages: tally("stages", stageOf),
      companies: tally("companies", (row) => String(row.company || "").trim()),
      sources: tally("sources", (row) => String(row.source || "").trim()),
      lens,
      starred,
    };
  }

  /* ------------------------------------------------------------------
     Sort (no favoured-company pin)
     ------------------------------------------------------------------ */

  function descNullLast(a, b) {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a;
  }

  function newestFirst(a, b) {
    const ta = timeOf(a);
    const tb = timeOf(b);
    return descNullLast(Number.isFinite(ta) ? ta : null, Number.isFinite(tb) ? tb : null);
  }

  function byFit(a, b) {
    return descNullLast(numberOrNull(a.fitScore), numberOrNull(b.fitScore));
  }

  function byMatch(a, b) {
    return descNullLast(numberOrNull(a.matchScore), numberOrNull(b.matchScore));
  }

  const SORTS = {
    fit: (a, b) => byFit(a, b) || byMatch(a, b) || newestFirst(a, b),
    newest: (a, b) => newestFirst(a, b) || byFit(a, b),
    salary: (a, b) =>
      descNullLast(parseSalaryMax(a.salary), parseSalaryMax(b.salary)) || byFit(a, b),
    match: (a, b) => byMatch(a, b) || byFit(a, b),
    company: (a, b) =>
      String(a.company || "").localeCompare(String(b.company || ""), undefined, {
        sensitivity: "base",
      }) || byFit(a, b),
  };

  // The mockup's key for Newest.
  SORTS.new = SORTS.newest;

  /** An unknown key keeps the input order, so a bad value stays visible. */
  function sortLeads(rows, sort) {
    const out = (rows || []).slice();
    const compare = Object.prototype.hasOwnProperty.call(SORTS, sort) ? SORTS[sort] : null;
    return compare ? out.sort(compare) : out;
  }

  /* ------------------------------------------------------------------
     IndexedDB: saved views + history
     ------------------------------------------------------------------ */

  const DB_NAME = "jobbored-leads";
  const DB_VERSION = 1;
  const STORE = "records";

  function requestResult(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function newId(prefix) {
    const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
      return `${prefix}-${cryptoApi.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * @param {{ indexedDB?: IDBFactory, now?: () => number, openTimeoutMs?: number }} [options]
   */
  function createStore(options) {
    const opts = options || {};
    const now = typeof opts.now === "function" ? opts.now : () => Date.now();
    const timeoutMs = opts.openTimeoutMs || 5000;
    let dbPromise = null;
    let seq = 0;

    function factory() {
      if (opts.indexedDB) return opts.indexedDB;
      if (typeof indexedDB !== "undefined") return indexedDB;
      return null;
    }

    function openDb() {
      if (dbPromise) return dbPromise;
      const idb = factory();
      if (!idb) return Promise.reject(new Error("IndexedDB is not available."));
      dbPromise = new Promise((resolve, reject) => {
        const req = idb.open(DB_NAME, DB_VERSION);
        // Fail loud instead of hanging: a pending deleteDatabase in another
        // tab queues this open indefinitely (user-content-store.js does the
        // same). A success that arrives after we gave up is closed.
        let gaveUp = false;
        const giveUp = (message) => {
          if (gaveUp) return;
          gaveUp = true;
          clearTimeout(watchdog);
          dbPromise = null;
          reject(new Error(message));
        };
        const watchdog = setTimeout(
          () => giveUp("Leads DB open timed out. Close other JobBored tabs and retry."),
          timeoutMs,
        );
        req.onblocked = () =>
          giveUp("Leads DB is blocked by another JobBored tab. Close other JobBored tabs and retry.");
        req.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          // Release the connection when another tab deletes or upgrades the
          // DB, so that tab's request is never stranded behind this one.
          db.onversionchange = () => {
            try {
              db.close();
            } catch (_) {
              /* already closing */
            }
            dbPromise = null;
          };
          if (gaveUp) {
            try {
              db.close();
            } catch (_) {
              /* ignore */
            }
            return;
          }
          clearTimeout(watchdog);
          resolve(db);
        };
        req.onerror = () => {
          if (gaveUp) return;
          gaveUp = true;
          clearTimeout(watchdog);
          dbPromise = null;
          reject(req.error);
        };
      });
      return dbPromise;
    }

    async function objectStore(mode) {
      const db = await openDb();
      return db.transaction([STORE], mode).objectStore(STORE);
    }

    async function allOfKind(kind) {
      const store = await objectStore("readonly");
      const all = await requestResult(store.getAll());
      return (all || []).filter((record) => record && record.kind === kind);
    }

    async function listViews() {
      const views = await allOfKind("view");
      return views.sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
    }

    /** Insert or update a saved view. Returns the stored record. */
    async function saveView(input) {
      const name = String((input && input.name) || "").trim();
      if (!name) throw new Error("A saved view needs a name.");
      const reader = await objectStore("readonly");
      const existing = input.id ? await requestResult(reader.get(input.id)) : null;
      const at = now();
      const record = {
        id: input.id || newId("view"),
        kind: "view",
        name,
        view: normalizeView(input.view),
        createdAt: existing ? existing.createdAt : at,
        updatedAt: at,
        seq: existing ? existing.seq : ++seq,
      };
      const writer = await objectStore("readwrite");
      await requestResult(writer.put(record));
      return record;
    }

    async function deleteView(id) {
      const reader = await objectStore("readonly");
      const existing = await requestResult(reader.get(id));
      if (!existing || existing.kind !== "view") return false;
      const writer = await objectStore("readwrite");
      await requestResult(writer.delete(id));
      return true;
    }

    /** Newest first. */
    async function listHistory() {
      const entries = await allOfKind("history");
      return entries.sort((a, b) => b.at - a.at || b.seq - a.seq);
    }

    /** Append one entry and trim the log to the last 50. */
    async function appendHistory(entry) {
      const record = Object.assign({}, entry || {}, {
        id: newId("history"),
        kind: "history",
        at: now(),
        seq: ++seq,
      });
      const store = await objectStore("readwrite");
      await requestResult(store.put(record));
      const entries = await listHistory();
      for (const stale of entries.slice(HISTORY_LIMIT)) {
        const writer = await objectStore("readwrite");
        await requestResult(writer.delete(stale.id));
      }
      return record;
    }

    return {
      listViews,
      saveView,
      deleteView,
      listHistory,
      appendHistory,
    };
  }

  let sharedStore = null;

  /** The page's store, opened on first use against window.indexedDB. */
  function store() {
    if (!sharedStore) sharedStore = createStore();
    return sharedStore;
  }

  Object.assign(leadsCore, {
    DB_NAME,
    STORE_NAME: STORE,
    HISTORY_LIMIT,
    BLOCKLIST_CAP,
    WORK_MODES: WORK_MODES.slice(),
    REASONS: Object.assign({}, REASONS),
    DEFAULT_VIEW,
    workModeFor,
    parseSalaryMax,
    hideReason,
    tokenize,
    matchesQuery,
    highlightRanges,
    roleMatches,
    roleIndexFor,
    normalizeView,
    passView,
    filterLeads,
    countsFor,
    facetCounts,
    sortLeads,
    createStore,
    store,
  });
})();
