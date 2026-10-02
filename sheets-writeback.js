/* ============================================
   COMMAND CENTER — Sheets write-back (Google Sheets API v4)
   Extracted from app.js. Classic-global IIFE under window.JobBoredApp.sheetsWrite.
   Loaded AFTER materials-feature.js, BEFORE app.js.
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const sheetsWrite = root.sheetsWrite || (root.sheetsWrite = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function sheetsRead() {
    return window.JobBoredApp.sheetsRead;
  }

  function sheetId() {
    const h = host();
    return (h.getActiveSheetId && h.getActiveSheetId()) || h.getSheetId() || "";
  }

// ============================================
// Row identity guard (HOLES A4, A9, A15)
// ============================================
// A job's Sheet row is mapped once, at load (_rawIndex). The person can sort
// the Sheet or delete rows after that, so a write passes { guard: true } and
// the writer re-reads each target row right before writing: its Link must
// still match (Title + Company for a link-less row). A row that moved is
// found again by that key; a row that is gone, or a key that now sits on two
// rows, is refused with a visible error, never guessed. Mirrors the worker's
// resolveRowsByLink (integrations/browser-use-discovery/src/sheets/sheets-client.ts).

const PIPELINE_ROW_RANGE = /^Pipeline!([A-Z]+)(\d+)$/;
const PIPELINE_LAST_COLUMN = "Z";
const IDENTITY_COL = { title: 1, company: 2, link: 4, notes: 14 };
const NOTES_COLUMN = "O";

function identityText(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

/** The key a job is found by after any await (A15): its Link, else Title + Company. */
function jobKeyOf(job) {
  if (!job) return "";
  const link = normalizeLeadUrlClient(job.link || "");
  if (link) return `link::${link}`;
  const title = identityText(job.title);
  const company = identityText(job.company);
  return title || company ? `synthetic::${company}::${title}` : "";
}

function targetForJob(job) {
  if (!job || job._rawIndex == null) return null;
  return {
    job,
    key: jobKeyOf(job),
    row: job._rawIndex + 2,
    link: normalizeLeadUrlClient(job.link || ""),
    title: identityText(job.title),
    company: identityText(job.company),
    notesBase: job._rawNotes == null ? "" : String(job._rawNotes),
  };
}

/** Capture, at call time, the job a write is for. */
function writeTarget(dataIndex) {
  return targetForJob((host().getPipelineData() || [])[dataIndex]);
}

/** The live copy of a target's job after an await: same object, else same key. */
function liveJob(target) {
  if (!target) return null;
  const data = host().getPipelineData() || [];
  if (data.indexOf(target.job) !== -1) return target.job;
  if (!target.key) return null;
  return data.find((job) => jobKeyOf(job) === target.key) || null;
}

function liveIndex(target) {
  const job = liveJob(target);
  return job ? (host().getPipelineData() || []).indexOf(job) : -1;
}

/** Which job each Pipeline row in `updates` is for, read before any await. */
function targetsForUpdates(updates) {
  const data = host().getPipelineData() || [];
  const rows = [];
  for (const u of updates) {
    const m = PIPELINE_ROW_RANGE.exec((u && u.range) || "");
    if (m && rows.indexOf(Number(m[2])) === -1) rows.push(Number(m[2]));
  }
  return rows.map((row) => {
    const job = data.find((j) => j && j._rawIndex != null && j._rawIndex + 2 === row);
    return targetForJob(job) || { job: null, key: "", row };
  });
}

function rowMatchesTarget(cells, target) {
  if (!target.job) return false;
  const row = cells || [];
  const link = normalizeLeadUrlClient(row[IDENTITY_COL.link] || "");
  if (target.link) return link === target.link;
  return (
    !link &&
    identityText(row[IDENTITY_COL.title]) === target.title &&
    identityText(row[IDENTITY_COL.company]) === target.company
  );
}

/** found {row, cells} | missing | ambiguous {rows}, one per target. */
async function resolveTargets(targets) {
  const fresh = await sheetsValuesBatchGet(
    targets.map((t) => `Pipeline!A${t.row}:${PIPELINE_LAST_COLUMN}${t.row}`),
  );
  const results = targets.map((t, i) => {
    const cells = (fresh[i] && fresh[i][0]) || [];
    return rowMatchesTarget(cells, t) ? { status: "found", row: t.row, cells } : null;
  });
  const moved = [];
  results.forEach((r, i) => {
    if (!r) moved.push(i);
  });
  if (!moved.length) return results;

  // Title..Link for every row; the identity columns, read once.
  const scan = (await sheetsValuesGet("Pipeline!B2:E")).values || [];
  const refetch = [];
  for (const i of moved) {
    const candidates = [];
    scan.forEach((cells, offset) => {
      if (rowMatchesTarget([""].concat(cells || []), targets[i])) candidates.push(offset + 2);
    });
    if (!candidates.length) results[i] = { status: "missing" };
    else if (candidates.length > 1) results[i] = { status: "ambiguous", rows: candidates };
    else refetch.push({ i, row: candidates[0] });
  }
  if (refetch.length) {
    const again = await sheetsValuesBatchGet(
      refetch.map((r) => `Pipeline!A${r.row}:${PIPELINE_LAST_COLUMN}${r.row}`),
    );
    refetch.forEach((r, k) => {
      const cells = (again[k] && again[k][0]) || [];
      results[r.i] = rowMatchesTarget(cells, targets[r.i])
        ? { status: "found", row: r.row, cells }
        : { status: "missing" };
    });
  }
  return results;
}

/* A9: notes merge, never overwrite from a stale copy. `base` is the cell as
   loaded, `mine` what this write wants, `theirs` the cell now. When nobody
   else touched it, `mine` is written as is; otherwise each line someone
   added since the load is kept: on top when they prepended (the dated,
   newest-first entries), else at the end. */
function mergeNotes(base, mine, theirs) {
  const b = base == null ? "" : String(base);
  const m = mine == null ? "" : String(mine);
  const t = theirs == null ? "" : String(theirs);
  if (t === b || t === m) return m;
  const known = new Set(b.split("\n").concat(m.split("\n")).map((line) => line.trim()));
  const theirLines = t.split("\n");
  const added = theirLines.filter((line) => line.trim() && !known.has(line.trim()));
  if (!added.length) return m;
  if (!m.trim()) return added.join("\n");
  return theirLines[0].trim() === added[0].trim()
    ? `${added.join("\n")}\n${m}`
    : `${m}\n${added.join("\n")}`;
}

function refreshFromSheet() {
  const read = sheetsRead();
  if (read && typeof read.loadAllData === "function") void read.loadAllData();
}

function sessionEnded() {
  host().clearSessionAuthState();
  host().renderPipeline();
  host().showToast("Your Google session ended — sign in again", "error", true, {
    label: "Sign in",
    onClick: () => host().showSheetAccessGate("signin"),
  });
}

/**
 * Re-point each guarded update at the row its job holds NOW and merge notes.
 * Rewrites update.range / update.value in place, so the caller's local copy
 * matches what the Sheet receives. Resolves the notes cells it will write
 * ([{ target, value }]), or null after telling the person why nothing was.
 */
async function guardUpdates(updates, targets, silent) {
  if (!targets.length) return [];
  let resolved;
  try {
    resolved = await resolveTargets(targets);
  } catch (err) {
    if (err && err.status === 401) {
      sessionEnded();
    } else if (!silent) {
      host().showToast(
        err && err.status
          ? `Update failed: ${err.message}`
          : "Update failed — check your connection",
        "error",
      );
    }
    return null;
  }
  const refused = resolved.find((r) => r.status !== "found");
  if (refused) {
    console.warn("[JobBored] Sheet write refused: target row", refused.status);
    if (!silent) {
      host().showToast(
        refused.status === "ambiguous"
          ? "Couldn’t save — that role now appears more than once in your Sheet. Refresh, then try again."
          : "Couldn’t save — that role moved or was removed in your Sheet. Refresh, then try again.",
        "error",
        true,
        { label: "Refresh", onClick: refreshFromSheet },
      );
    }
    return null;
  }
  const byRow = new Map(targets.map((t, i) => [t.row, { target: t, found: resolved[i] }]));
  const notes = [];
  for (const u of updates) {
    const m = PIPELINE_ROW_RANGE.exec((u && u.range) || "");
    const hit = m && byRow.get(Number(m[2]));
    if (!hit) continue;
    u.range = `Pipeline!${m[1]}${hit.found.row}`;
    if (m[1] === NOTES_COLUMN) {
      u.value = mergeNotes(hit.target.notesBase, u.value, hit.found.cells[IDENTITY_COL.notes]);
      notes.push({ target: hit.target, value: u.value });
    }
  }
  return notes;
}

/** After a guarded write lands, the Notes it wrote are the new merge base. */
function recordNotesWritten(notes) {
  for (const n of notes || []) {
    const job = liveJob(n.target);
    if (job) job._rawNotes = n.value;
  }
}

async function updateSheetCell(range, value, isRetry, opts) {
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return false;
  }

  if (opts && opts.guard && !isRetry) {
    const update = { range, value };
    const targets = targetsForUpdates([update]);
    const notes = await guardUpdates([update], targets, false);
    if (!notes) return false;
    const ok = await updateSheetCell(update.range, update.value, false);
    if (ok) recordNotesWritten(notes);
    return ok;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  try {
    const resp = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${host().getAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range: range,
        majorDimension: "ROWS",
        values: [[value]],
      }),
    });

    if (resp.status === 401) {
      if (!isRetry) {
        const refreshed = await host().refreshAccessTokenSilently();
        if (refreshed) return updateSheetCell(range, value, true);
      }
      host().clearSessionAuthState();
      host().renderPipeline();
      host().showToast("Your Google session ended — sign in again", "error", true, {
        label: "Sign in",
        onClick: () => host().showSheetAccessGate("signin"),
      });
      return false;
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${resp.status}`;
      console.error("[JobBored] Sheet update failed:", errMsg);
      host().showToast("Update failed: " + errMsg, "error");
      return false;
    }

    return true;
  } catch (err) {
    console.error("[JobBored] Sheet update error:", err);
    host().showToast("Update failed — check your connection", "error");
    return false;
  }
}
async function updateMultipleCells(updates, isRetry, opts) {
  // opts.silent: the caller shows its own single message (UX01 SS-06), so
  // do not also toast here. Session-expired still toasts — it needs Sign in.
  const silent = !!(opts && opts.silent);
  // updates: Array of { range, value }
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return false;
  }

  // opts.guard (A4): which job each row is for is read HERE, before any
  // await — a caller may edit the job optimistically right after this call.
  if (opts && opts.guard && !isRetry) {
    const targets = targetsForUpdates(updates);
    const notes = await guardUpdates(updates, targets, silent);
    if (!notes) return false;
    const ok = await updateMultipleCells(updates, false, { silent });
    if (ok) recordNotesWritten(notes);
    return ok;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values:batchUpdate`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${host().getAccessToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: updates.map((u) => ({
          range: u.range,
          majorDimension: "ROWS",
          values: [[u.value]],
        })),
      }),
    });

    if (resp.status === 401) {
      if (!isRetry) {
        const refreshed = await host().refreshAccessTokenSilently();
        if (refreshed) return updateMultipleCells(updates, true, opts);
      }
      host().clearSessionAuthState();
      host().renderPipeline();
      host().showToast("Your Google session ended — sign in again", "error", true, {
        label: "Sign in",
        onClick: () => host().showSheetAccessGate("signin"),
      });
      return false;
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${resp.status}`;
      if (!silent) host().showToast("Update failed: " + errMsg, "error");
      return false;
    }

    return true;
  } catch (err) {
    if (!silent) host().showToast("Update failed — check your connection", "error");
    return false;
  }
}

// ============================================
// Favorite / Dismiss + Blacklist (Layer 5)
// ============================================

// Mirror the backend's normalizeLeadUrl. Keep the two in lockstep —
// the Blacklist dedup breaks if frontend writes a differently-normalized
// URL than the backend reads.
const BLACKLIST_STRIP_PARAMS =
  /^(utm_.+|ref|source|src|gh_src|lever-source|fbclid|gclid|trk)$/i;

function normalizeLeadUrlClient(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  u.hash = "";
  u.username = "";
  u.password = "";
  if (
    (u.protocol === "http:" && u.port === "80") ||
    (u.protocol === "https:" && u.port === "443")
  ) {
    u.port = "";
  }
  const keep = [];
  for (const [k, v] of u.searchParams) {
    if (!BLACKLIST_STRIP_PARAMS.test(k)) keep.push([k, v]);
  }
  // Rebuild query in original order minus stripped keys
  const params = new URLSearchParams();
  for (const [k, v] of keep) params.append(k, v);
  u.search = params.toString() ? `?${params.toString()}` : "";
  // Strip trailing slashes from pathname, but keep root "/"
  if (u.pathname && u.pathname !== "/") {
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  }
  return u.toString();
}

/* R13: a block is keyed by its URL and, where the URL names one, the job
   board's own posting id, so a Link the worker later re-canonicalizes
   (boards.greenhouse.io → job-boards.greenhouse.io, a new tracking param)
   still finds its block. Same shape as the worker's provider keys
   (listing-fingerprint.ts): provider:<board>:<tenant>:<id>, for the boards
   whose URLs carry a stable posting id. */
const PROVIDER_KEY_RULES = [
  { provider: "greenhouse", host: /(^|\.)greenhouse\.io$/i, query: "gh_jid", path: /\/jobs\/([^/?#]+)/i },
  { provider: "lever", host: /(^|\.)lever\.co$/i, path: /^\/[^/]+\/([^/?#]+)/i },
  { provider: "ashby", host: /(^|\.)ashbyhq\.com$/i, path: /^\/[^/]+\/([^/?#]+)/i },
  { provider: "smartrecruiters", host: /(^|\.)smartrecruiters\.com$/i, path: /^\/[^/]+\/([^/?#]+)/i },
  { provider: "workable", host: /(^|\.)workable\.com$/i, path: /\/j\/([^/?#]+)/i },
];

function providerIdPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function providerKeyForUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || "").trim());
  } catch {
    return "";
  }
  const rule = PROVIDER_KEY_RULES.find((r) => r.host.test(u.hostname));
  if (!rule) return "";
  const match = rule.path.exec(u.pathname);
  const id = providerIdPart((rule.query && u.searchParams.get(rule.query)) || (match && match[1]));
  const tenant = providerIdPart(u.pathname.split("/").filter(Boolean)[0]);
  if (!id || !tenant || id === tenant) return "";
  return `provider:${rule.provider}:${tenant}:${id}`;
}

async function sheetsBatchUpdate(body, isRetry) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}:batchUpdate`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host().getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (resp.status === 401 && !isRetry) {
    const ok = await host().refreshAccessTokenSilently();
    if (ok) return sheetsBatchUpdate(body, true);
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return resp.json();
}

async function sheetsValuesAppend(range, values, isRetry) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(
    range,
  )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host().getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });
  if (resp.status === 401 && !isRetry) {
    const ok = await host().refreshAccessTokenSilently();
    if (ok) return sheetsValuesAppend(range, values, true);
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const msg = err.error?.message || `HTTP ${resp.status}`;
    const e = new Error(msg);
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

async function sheetsValuesGet(range, isRetry) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(
    range,
  )}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${host().getAccessToken()}` },
  });
  if (resp.status === 401 && !isRetry) {
    const ok = await host().refreshAccessTokenSilently();
    if (ok) return sheetsValuesGet(range, true);
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const e = new Error(err.error?.message || `HTTP ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  return resp.json();
}

/** values:batchGet — one `values` array per range, in order. */
async function sheetsValuesBatchGet(ranges, isRetry) {
  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values:batchGet?${query}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${host().getAccessToken()}` },
  });
  if (resp.status === 401 && !isRetry) {
    const ok = await host().refreshAccessTokenSilently();
    if (ok) return sheetsValuesBatchGet(ranges, true);
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    const e = new Error(err.error?.message || `HTTP ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  const data = await resp.json();
  return (data.valueRanges || []).map((vr) => (vr && vr.values) || []);
}

async function sheetsValuesUpdate(range, values, isRetry) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}/values/${encodeURIComponent(
    range,
  )}?valueInputOption=RAW`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${host().getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values }),
  });
  if (resp.status === 401 && !isRetry) {
    const ok = await host().refreshAccessTokenSilently();
    if (ok) return sheetsValuesUpdate(range, values, true);
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${resp.status}`);
  }
  return resp.json();
}

async function ensureBlacklistTab() {
  // Create the Blacklist tab + header row. Called only on the
  // "Unable to parse range" failure path, so we know the tab is missing.
  await sheetsBatchUpdate({
    requests: [{ addSheet: { properties: { title: "Blacklist" } } }],
  });
  await sheetsValuesUpdate("Blacklist!A1:F1", [
    ["URL", "Dismissed At", "Title", "Company", "Reason", "Provider ID"],
  ]);
}

async function appendBlacklistRow({ url, dismissedAt, title, company }) {
  if (!host().getAccessToken()) throw new Error("Not signed in");
  const normalized = normalizeLeadUrlClient(url || "");
  const row = [
    normalized,
    dismissedAt || "",
    title || "",
    company || "",
    "",
    providerKeyForUrl(normalized),
  ];
  try {
    await sheetsValuesAppend("Blacklist!A:F", [row]);
    return;
  } catch (err) {
    const msg = String(err?.message || "");
    if (/Unable to parse range/i.test(msg)) {
      await ensureBlacklistTab();
      await sheetsValuesAppend("Blacklist!A:F", [row]);
      return;
    }
    throw err;
  }
}

/** The provider key a Blacklist row is for: column F, else its URL's. */
function blacklistRowProviderKey(cells) {
  return String((cells && cells[5]) || "").trim() || providerKeyForUrl((cells && cells[0]) || "");
}

/** Remove EVERY Blacklist row matching one of `urls` (normalized) or
 *  `providerKeys`: a dismiss → restore → dismiss cycle leaves duplicates, a
 *  re-canonicalized Link leaves its old URL behind, and one survivor keeps
 *  the role blocked. Resolves whether anything was removed. */
async function deleteBlacklistRows(urls, providerKeys) {
  if (!host().getAccessToken()) throw new Error("Not signed in");
  const wantUrls = (urls || []).map((u) => normalizeLeadUrlClient(u || "")).filter(Boolean);
  const wantKeys = (providerKeys || []).filter(Boolean);
  if (!wantUrls.length && !wantKeys.length) return false;
  let data;
  try {
    data = await sheetsValuesGet("Blacklist!A:F");
  } catch (err) {
    const msg = String(err?.message || "");
    if (/Unable to parse range/i.test(msg)) return false;
    throw err;
  }
  const values = data.values || [];
  const rows = []; // 0-based sheet rows; row 0 is the header
  for (let i = 1; i < values.length; i++) {
    const cells = values[i] || [];
    const url = normalizeLeadUrlClient(cells[0] || "");
    const key = blacklistRowProviderKey(cells);
    if ((url && wantUrls.includes(url)) || (key && wantKeys.includes(key))) rows.push(i);
  }
  if (!rows.length) return false;
  // Look up the sheetId for "Blacklist"
  const metaResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${host().getAccessToken()}` } },
  );
  if (!metaResp.ok) throw new Error(`Blacklist lookup failed (HTTP ${metaResp.status})`);
  const meta = await metaResp.json();
  const sheet = (meta.sheets || []).find(
    (s) => s.properties && s.properties.title === "Blacklist",
  );
  if (!sheet) return false;
  // Bottom-up, so each delete leaves the earlier row indexes in place.
  await sheetsBatchUpdate({
    requests: rows.reverse().map((rowIndex) => ({
      deleteDimension: {
        range: {
          sheetId: sheet.properties.sheetId,
          dimension: "ROWS",
          startIndex: rowIndex,
          endIndex: rowIndex + 1,
        },
      },
    })),
  });
  return true;
}

async function deleteBlacklistRowByUrl(url) {
  const normalized = normalizeLeadUrlClient(url || "");
  if (!normalized) return false;
  return deleteBlacklistRows([normalized], [providerKeyForUrl(normalized)]);
}

/** R13: the Blacklist tab as one entry per role (by provider key, else
 *  URL), newest first. A Sheet without the tab has nothing blocked. */
async function listBlockedRoles() {
  let data;
  try {
    data = await sheetsValuesGet("Blacklist!A2:F");
  } catch (err) {
    if (/Unable to parse range/i.test(String(err?.message || ""))) return [];
    throw err;
  }
  const byKey = new Map();
  for (const cells of data.values || []) {
    const url = normalizeLeadUrlClient((cells && cells[0]) || "");
    const providerKey = blacklistRowProviderKey(cells);
    const key = providerKey || url;
    if (!key) continue;
    const dismissedAt = String(cells[1] || "");
    const entry = byKey.get(key);
    if (!entry) {
      byKey.set(key, {
        key,
        url,
        providerKey,
        title: String(cells[2] || ""),
        company: String(cells[3] || ""),
        dismissedAt,
        count: 1,
      });
    } else {
      entry.count += 1;
      if (dismissedAt > entry.dismissedAt) {
        entry.dismissedAt = dismissedAt;
        if (url) entry.url = url;
      }
    }
  }
  return [...byKey.values()].sort((a, b) =>
    a.dismissedAt < b.dismissedAt ? 1 : a.dismissedAt > b.dismissedAt ? -1 : 0,
  );
}

/** Write every pending favorite whose Sheet cell disagrees with the
 *  user's pick. Called on "online" and from the Retry action. Quiet on
 *  success per row; one summary toast at the end. */
async function flushPendingFavorites() {
  const read = sheetsRead();
  if (!read || !host().getAccessToken()) return 0;
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem("jobbored.favorites.pending") || "{}") || {};
  } catch (_) {
    map = {};
  }
  const keys = Object.keys(map);
  if (!keys.length) return 0;
  const data = host().getPipelineData() || [];
  const updates = [];
  const flushed = [];
  data.forEach((job, idx) => {
    const key = read.favoriteCacheKeyForJob(job);
    if (!key || !(key in map)) return;
    const row = getSheetRow(idx);
    if (!row) return;
    updates.push({ range: `Pipeline!V${row}`, value: map[key] ? "★" : "" });
    flushed.push(key);
  });
  if (!updates.length) return 0;
  const ok = await updateMultipleCells(updates, false, { silent: true, guard: true });
  if (!ok) return 0;
  for (const key of flushed) read.clearPendingFavorite(key);
  host().showToast(
    flushed.length === 1 ? "Star saved to your Sheet" : `${flushed.length} stars saved to your Sheet`,
    "success",
  );
  return flushed.length;
}

async function toggleFavorite(stableKey) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return false;
  const next = !job.favorite;
  const read = sheetsRead();
  const cacheKey = read.favoriteCacheKeyForJob(job);

  // Mutate the in-memory model + record the user's intent locally
  // BEFORE any network/auth check, so the chip stays correct across a
  // refresh even if the Sheet write never lands.
  job.favorite = next;
  if (cacheKey) read.setPendingFavorite(cacheKey, next);
  host().renderPipeline();

  if (!host().getAccessToken()) {
    // Surface the sign-in gate for context, but keep the local intent.
    // On sign-in, applyFavoriteCache will reconcile against the Sheet.
    host().showSheetAccessGate("signin");
    return true;
  }
  const sheetRow = getSheetRow(stableKey);
  if (!sheetRow) {
    // No row mapping (e.g., locally added job not yet in Sheets). Local
    // intent persists in the cache; nothing to write.
    return true;
  }
  const ok = await updateMultipleCells(
    [{ range: `Pipeline!V${sheetRow}`, value: next ? "★" : "" }],
    false,
    { silent: true, guard: true },
  );
  if (ok) {
    // Sheet now matches local intent — drop the cache entry.
    if (cacheKey) read.clearPendingFavorite(cacheKey);
    host().showToast(next ? "Favorited" : "Unfavorited", "success");
    return true;
  }
  // Sheet write failed but local intent stays in the cache so a refresh
  // still shows the user's pick. Surface a soft error. Return true so the
  // optimistic UI does NOT roll back — the favorite is durably captured
  // locally and the next successful CSV refresh will reconcile.
  // UX01 SS-06: ONE warning, with a Retry, instead of two red toasts. The
  // pending-favorites cache is flushed automatically when the browser
  // comes back online (sheets-read-load.js "online" hook).
  const offline =
    typeof navigator !== "undefined" && navigator && navigator.onLine === false;
  host().showToast(
    offline
      ? `Starred "${job.title || "this role"}" here — it will reach your Sheet when you’re back online`
      : `Couldn’t save the star on "${job.title || "this role"}" to your Sheet yet`,
    "warning",
    true,
    { label: "Retry", onClick: () => void flushPendingFavorites() },
  );
  return true;
}

/* A8 / R12: a dismiss is two writes — Pipeline!W and the Blacklist row that
   keeps discovery from re-adding the role. They land together or not at
   all: W goes first, and if the Blacklist half then fails, W is put back.
   Restore runs the same halves in reverse. Both resolve true or false. */
async function putBack(range, value) {
  if (await updateMultipleCells([{ range, value }], false, { silent: true })) return;
  console.error("[JobBored] rollback failed; the Sheet may hold half a change at", range);
  host().showToast(
    "Couldn’t undo the half that saved — refresh to check your Sheet",
    "error",
    true,
    { label: "Refresh", onClick: refreshFromSheet },
  );
}

async function persistDismiss(target, at, prevW) {
  const w = { range: `Pipeline!W${target.row}`, value: at };
  if (!(await updateMultipleCells([w], false, { guard: true }))) return false;
  if (!target.link) return true; // nothing to key a block on
  try {
    await appendBlacklistRow({
      url: target.job.link || "",
      dismissedAt: at,
      title: target.job.title || "",
      company: target.job.company || "",
    });
    return true;
  } catch (err) {
    console.error("[JobBored] dismiss: Blacklist write failed; putting W back", err);
    await putBack(w.range, prevW || "");
    return false;
  }
}

async function persistRestore(target, prevW, also) {
  const w = { range: `Pipeline!W${target.row}`, value: "" };
  if (!(await updateMultipleCells([w], false, { guard: true }))) return false;
  const link = normalizeLeadUrlClient(target.job.link || "");
  try {
    await deleteBlacklistRows(
      [link].concat((also && also.urls) || []),
      [providerKeyForUrl(link)].concat((also && also.providerKeys) || []),
    );
    return true;
  } catch (err) {
    console.error("[JobBored] restore: Blacklist delete failed; putting W back", err);
    await putBack(w.range, prevW || "");
    return false;
  }
}

/** Set dismissedAt on the job as it is now (a reload may have replaced it). */
function setDismissedAt(target, value) {
  const job = liveJob(target) || target.job;
  if ((job.dismissedAt || null) === (value || null)) return;
  job.dismissedAt = value;
  host().renderPipeline();
}

async function dismissJob(stableKey) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return false;
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return false;
  }
  const target = writeTarget(stableKey);
  if (!target) return false;
  const prev = job.dismissedAt || null;
  const now = new Date().toISOString();
  job.dismissedAt = now;
  host().renderPipeline();

  // Written now, not after a 10 s window: Undo reverses what already landed.
  const persisted = persistDismiss(target, now, prev);
  const closeToast = host().showToast(
    `Dismissed "${job.title || "role"}"`,
    "info",
    true,
    {
      label: "Undo",
      onClick: () => {
        void persisted.then((ok) => (ok ? undoDismiss(target, now) : false));
      },
    },
  );
  if (await persisted) {
    setDismissedAt(target, now);
    return true;
  }
  if (typeof closeToast === "function") closeToast();
  setDismissedAt(target, prev);
  host().showToast("Couldn't save dismiss — reverted", "error");
  return false;
}

async function undoDismiss(target, dismissedAt) {
  setDismissedAt(target, null);
  if (await persistRestore(target, dismissedAt)) {
    host().showToast("Restored", "success");
    return true;
  }
  setDismissedAt(target, dismissedAt);
  host().showToast("Couldn't undo — the role is still dismissed", "error");
  return false;
}

async function restoreJob(stableKey) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return false;
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return false;
  }
  const target = writeTarget(stableKey);
  if (!target) return false;
  const prev = job.dismissedAt;
  job.dismissedAt = null;
  host().renderPipeline();
  if (await persistRestore(target, prev)) {
    setDismissedAt(target, null);
    host().showToast("Restored", "success");
    return true;
  }
  setDismissedAt(target, prev);
  host().showToast("Couldn't restore — reverted", "error");
  return false;
}

/** R13: lift a block from the Dismissed & blocked manager. When the role
 *  is still a dismissed Pipeline row, it is un-dismissed too, with the same
 *  two halves and rollback as restoreJob. Resolves true or false. */
async function restoreBlockedRole(entry) {
  if (!entry || !host().getAccessToken()) return false;
  const urls = entry.url ? [entry.url] : [];
  const providerKeys = entry.providerKey ? [entry.providerKey] : [];
  const data = host().getPipelineData() || [];
  const idx = data.findIndex((job) => {
    if (!job || !job.dismissedAt) return false;
    const link = normalizeLeadUrlClient(job.link || "");
    const key = providerKeyForUrl(link);
    return (!!link && urls.includes(link)) || (!!key && providerKeys.includes(key));
  });
  const target = idx === -1 ? null : writeTarget(idx);
  if (!target) {
    try {
      await deleteBlacklistRows(urls, providerKeys);
      return true;
    } catch (err) {
      console.error("[JobBored] lifting a block failed", err);
      return false;
    }
  }
  const prev = target.job.dismissedAt;
  setDismissedAt(target, null);
  if (await persistRestore(target, prev, { urls, providerKeys })) return true;
  setDismissedAt(target, prev);
  return false;
}

/**
 * Flip column M (Status) to "Expired" for a single pipeline row. Used by the
 * Daily Brief lead-story popover and the review modal's per-row Mark Expired
 * action. Optimistic — reverts the in-memory status if the writeback fails.
 */
async function markStatusExpired(stableKey) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return;
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return;
  }
  const target = writeTarget(stableKey);
  if (!target) return;
  const sheetRow = target.row;
  const prevStatus = job.status;
  if ((prevStatus || "").toLowerCase() === "expired") return;
  job.status = "Expired";
  host().renderPipeline();
  try {
    const ok = await updateMultipleCells(
      [{ range: `Pipeline!M${sheetRow}`, value: "Expired" }],
      false,
      { guard: true },
    );
    if (!ok) throw new Error(`Pipeline M${sheetRow} write failed`);
    host().showToast("Marked Expired", "info");
  } catch (err) {
    console.error("[JobBored] markStatusExpired failed", err);
    (liveJob(target) || job).status = prevStatus;
    host().renderPipeline();
    host().showToast("Couldn't mark expired — reverted", "error");
  }
}

// Identity fields the user can edit in the v2 dossier masthead. The column
// letters are fixed by STARTER_PIPELINE_HEADERS order (line ~861): Title=B,
// Company=C, Location=D, Salary=G. Reads use the same indices in
// parsePipelineCSV, so writes must target these exact columns.
const EDIT_FIELD_COLUMN = { title: "B", company: "C", location: "D", salary: "G" };
const EDIT_LOCK_COLUMN = "Y"; // STARTER_PIPELINE_HEADERS -> "Edit Lock" (sheetIndex 24)

// Union a field id into the comma-separated, de-duplicated Edit Lock value so
// re-discovery (mergeExistingRow) leaves user-edited identity fields intact
// while still improving untouched ones.
function unionLock(existing, field) {
  const ids = String(existing || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.indexOf(field) === -1) ids.push(field);
  return ids.join(",");
}

// Persist a user edit to title/company/location/salary from the dossier
// masthead. Mirrors markStatusExpired (optimistic mutate + render before the
// await, revert + error toast on failure) but writes the field value AND the
// unioned Edit Lock in ONE atomic updateMultipleCells batch so there is no
// window where the value persists unlocked.
async function editJobField(stableKey, field, value) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return;
  const col = EDIT_FIELD_COLUMN[field];
  if (!col) return;
  const next = String(value).trim(); // compare trimmed: a whitespace-only change is a no-op
  if ((job[field] || "") === next) return; // no-op on unchanged value
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return;
  }
  const sheetRow = getSheetRow(stableKey);
  if (!sheetRow) return; // locally-added job, no row to write
  const prevValue = job[field];
  const prevLock = job._editLock || "";
  const nextLock = unionLock(prevLock, field);
  // The guard reads which job this row is for as the call starts (A4), so
  // the write starts before the optimistic edit renames a link-less job.
  const write = updateMultipleCells(
    [
      { range: `Pipeline!${col}${sheetRow}`, value: next },
      { range: `Pipeline!${EDIT_LOCK_COLUMN}${sheetRow}`, value: nextLock },
    ],
    false,
    { guard: true },
  );
  job[field] = next;
  job._editLock = nextLock;
  host().renderPipeline();
  try {
    const ok = await write;
    if (!ok) throw new Error(`Pipeline ${col}${sheetRow} write failed`);
    host().showToast("Saved", "info");
  } catch (err) {
    console.error("[JobBored] editJobField failed", err);
    job[field] = prevValue;
    job._editLock = prevLock;
    host().renderPipeline();
    host().showToast("Couldn't save — reverted", "error");
  }
}

// Row index: the position in host().getPipelineData() maps to raw row index
// host().getPipelineData()[i] comes from pipelineRawRows[i], which is rows[i+1] (skip header)
// So sheet row = rawRowIndex + 2 (1-indexed, +1 for header)
function getSheetRow(dataIndex) {
  // dataIndex is the index into host().getPipelineData()
  // We need to map back to the original row in the raw CSV
  const job = host().getPipelineData()[dataIndex];
  if (!job || job._rawIndex == null) return null;
  return job._rawIndex + 2; // +1 for 0-based, +1 for header row
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function futureDateStr(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
}

// Smart status transitions — each status change may auto-update related fields
function isIsoDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

/* D11: the submission dialog's evidence in the same "Applied via …" shape the
   planner path writes (see submission-flow.js noteFor): newest entry first,
   exact-line dedupe. Returns "" when there is nothing new to write. */
function appliedEvidenceNote(evidence, existingNotes, today) {
  const source =
    evidence && evidence.source != null ? String(evidence.source).trim() : "";
  if (!source) return "";
  const parts = ["Applied via " + source];
  const receipt =
    evidence.receiptNote != null ? String(evidence.receiptNote).trim() : "";
  if (receipt) parts.push("receipt: " + receipt);
  if (Array.isArray(evidence.sent)) {
    const sent = evidence.sent
      .map((label) => String(label).trim())
      .filter(Boolean);
    if (sent.length) parts.push("sent: " + sent.join(", "));
  }
  const entry = "[" + today + "] " + parts.join(" · ");
  const current = existingNotes == null ? "" : String(existingNotes);
  if (!current) return entry;
  if (current.split("\n").some((line) => line.trim() === entry)) return "";
  return entry + "\n" + current;
}

function getStatusSideEffects(newStatus, job, sheetRow, evidence) {
  const updates = [{ range: `Pipeline!M${sheetRow}`, value: newStatus }];
  const localUpdates = { status: newStatus };
  const today = todayStr();

  switch (newStatus) {
    case "Applied": {
      // D11: the confirmed evidence wins over the row's own values (planner
      // parity — the dialog's date is what the person typed). Without
      // evidence, keep today's defaults.
      const evidenceDate =
        evidence && isIsoDateString(evidence.appliedDate)
          ? String(evidence.appliedDate).trim()
          : "";
      const evidenceFollowUp =
        evidence && isIsoDateString(evidence.followUpDate)
          ? String(evidence.followUpDate).trim()
          : "";
      if (evidenceDate) {
        if (job.appliedDate !== evidenceDate) {
          updates.push({ range: `Pipeline!N${sheetRow}`, value: evidenceDate });
          localUpdates.appliedDate = evidenceDate;
        }
      } else if (!job.appliedDate) {
        updates.push({ range: `Pipeline!N${sheetRow}`, value: today });
        localUpdates.appliedDate = today;
      }
      if (evidenceFollowUp) {
        if (job.followUpDate !== evidenceFollowUp) {
          updates.push({ range: `Pipeline!P${sheetRow}`, value: evidenceFollowUp });
          localUpdates.followUpDate = evidenceFollowUp;
        }
      } else if (!job.followUpDate) {
        // Set Follow-up Date to 5 business days out if not already set
        const followUp = futureDateStr(7);
        updates.push({ range: `Pipeline!P${sheetRow}`, value: followUp });
        localUpdates.followUpDate = followUp;
      }
      const note = appliedEvidenceNote(evidence, job.notes, today);
      if (note) {
        updates.push({ range: `Pipeline!O${sheetRow}`, value: note });
        localUpdates.notes = note;
        localUpdates._rawNotes = note;
      }
      break;
    }

    case "Phone Screen":
      // Set Applied Date if somehow skipped
      if (!job.appliedDate) {
        updates.push({ range: `Pipeline!N${sheetRow}`, value: today });
        localUpdates.appliedDate = today;
      }
      // Set Follow-up Date to 3 days out (tighter loop)
      const psFollowUp = futureDateStr(3);
      updates.push({ range: `Pipeline!P${sheetRow}`, value: psFollowUp });
      localUpdates.followUpDate = psFollowUp;
      break;

    case "Interviewing":
      // Set Applied Date if somehow skipped
      if (!job.appliedDate) {
        updates.push({ range: `Pipeline!N${sheetRow}`, value: today });
        localUpdates.appliedDate = today;
      }
      // Set Follow-up Date to 5 days out
      const intFollowUp = futureDateStr(5);
      updates.push({ range: `Pipeline!P${sheetRow}`, value: intFollowUp });
      localUpdates.followUpDate = intFollowUp;
      break;

    case "Offer":
      // Clear Follow-up Date (you got the offer)
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.followUpDate = null;
      break;

    case "Rejected":
      // Clear Follow-up Date
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.followUpDate = null;
      break;

    case "Passed":
      // Clear Follow-up Date
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.followUpDate = null;
      break;

    case "Expired":
      // Clear Follow-up Date
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.followUpDate = null;
      break;

    case "New":
      // Reverting — clear Applied Date and Follow-up Date
      updates.push({ range: `Pipeline!N${sheetRow}`, value: "" });
      updates.push({ range: `Pipeline!P${sheetRow}`, value: "" });
      localUpdates.appliedDate = null;
      localUpdates.followUpDate = null;
      break;

    case "Researching":
      // No side effects
      break;
  }

  return { updates, localUpdates };
}

function emitPipelineMoveSucceeded(jobKey, fromStage, toStage) {
  if (typeof document === "undefined" || typeof CustomEvent !== "function") {
    return;
  }
  try {
    document.dispatchEvent(new CustomEvent("jb:write:succeeded", {
      detail: {
        jobKey,
        kind: "pipeline:move",
        fromStage,
        toStage,
        status: toStage,
      },
    }));
  } catch (err) {
    console.warn("[JobBored] status write event dispatch failed", err);
  }
}

/* D11: evidence is the submission dialog's { appliedDate, source,
   receiptNote, followUpDate } (submission-flow.js evidenceFrom). For Applied
   it overrides the default dates and appends the "Applied via …" note;
   other statuses ignore it. Optional — existing 3-arg callers are unchanged. */
async function updateJobStatus(dataIndex, newStatus, prevStatusOverride, evidence) {
  const target = writeTarget(dataIndex);
  if (!target) {
    return false;
  }
  const sheetRow = target.row;
  const job = target.job;
  // Callers that optimistically mutate job.status before invoking this
  // function (e.g. the Lattice board's drag/keyboard move) must pass the
  // real previous status through prevStatusOverride. Otherwise job.status
  // has already been clobbered to newStatus and the jb:write:succeeded event
  // would report fromStage === toStage, which breaks the Discovered ->
  // Researching auto-draft trigger in role-materials.js.
  const prevStatus =
    prevStatusOverride != null && prevStatusOverride !== undefined
      ? prevStatusOverride
      : job
        ? job.status
        : "";
  const { updates, localUpdates } = getStatusSideEffects(
    newStatus,
    job,
    sheetRow,
    newStatus === "Applied" ? evidence : undefined,
  );

  const success = await updateMultipleCells(updates, false, { guard: true });

  if (success) {
    // The Applied note may have been merged with newer Sheet text (A9).
    const notesCell = updates.find((u) => /^Pipeline!O\d+$/.test(u.range));
    if (notesCell && "notes" in localUpdates) {
      localUpdates.notes = notesCell.value;
      localUpdates._rawNotes = notesCell.value;
    }
    // Apply all local updates to the job as it is NOW: a reload during the
    // await replaced the array, so the old index may hold another job (A15).
    const live = liveJob(target);
    if (live) Object.assign(live, localUpdates);
    host().renderPipeline();
    host().renderStats();
    host().renderBrief();
    dataIndex = liveIndex(target); // where the job sits in the array now
    if (dataIndex >= 0) emitPipelineMoveSucceeded(dataIndex, prevStatus, newStatus);

    // Build a descriptive toast
    const extras = [];
    if (localUpdates.appliedDate) extras.push("applied date set");
    if (localUpdates.followUpDate)
      extras.push(`follow-up: ${localUpdates.followUpDate}`);
    if (localUpdates.followUpDate === null && newStatus !== "New")
      extras.push("follow-up cleared");
    const msg =
      extras.length > 0
        ? `${newStatus} — ${extras.join(", ")}`
        : `Updated to "${newStatus}"`;
    host().showToast(msg);
  }
  return success;
}

async function updateJobNotes(dataIndex, notes) {
  const target = writeTarget(dataIndex);
  if (!target) return false;

  // The guard re-reads the cell and merges, so text added in the Sheet since
  // the load survives this save (A9); update.value is what was written.
  const update = { range: `Pipeline!O${target.row}`, value: notes };
  const success = await updateMultipleCells([update], false, { guard: true });

  if (success) {
    const job = liveJob(target);
    if (job) {
      job.notes = update.value;
      job._rawNotes = update.value;
    }
    const idx = liveIndex(target);
    if (idx >= 0) host().refreshDrawerIfOpen(idx);
    host().renderExpiredReviewButton();
    host().renderBrief();
    host().showToast(
      update.value === notes ? "Notes saved" : "Notes saved, with newer lines from your Sheet",
    );
  }
  return success;
}

async function updateFollowUpDate(dataIndex, date) {
  const target = writeTarget(dataIndex);
  if (!target) return;

  const range = `Pipeline!P${target.row}`;
  const success = await updateSheetCell(range, date, false, { guard: true });

  if (success) {
    const job = liveJob(target);
    if (job) job.followUpDate = date || null;
    const idx = liveIndex(target);
    if (idx >= 0) host().refreshDrawerIfOpen(idx);
    host().renderPipeline();
    host().renderBrief();
    host().showToast(date ? `Follow-up set: ${date}` : "Follow-up cleared");
  }
}

async function updateLastHeardFrom(dataIndex, value) {
  const target = writeTarget(dataIndex);
  if (!target) return;

  const range = `Pipeline!R${target.row}`;
  const success = await updateSheetCell(range, value, false, { guard: true });

  if (success) {
    const job = liveJob(target);
    if (job) job.lastHeardFrom = value.trim() ? value.trim() : null;
    const idx = liveIndex(target);
    if (idx >= 0) host().refreshDrawerIfOpen(idx);
    host().renderBrief();
    host().showToast("Last contact saved");
  }
}

async function updateJobResponseFlag(dataIndex, value) {
  const target = writeTarget(dataIndex);
  if (!target) return;

  const range = `Pipeline!S${target.row}`;
  const success = await updateSheetCell(range, value, false, { guard: true });

  if (success) {
    const job = liveJob(target);
    if (job) job.responseFlag = value.trim() ? value.trim() : null;
    const idx = liveIndex(target);
    if (idx >= 0) host().refreshDrawerIfOpen(idx);
    host().renderBrief();
    host().renderStats();
    host().showToast("Reply status saved");
  }
}

  /** Apply F1-A transition patches as ONE Pipeline-tab batch.
   *  patches: [{ column:"M", sheetRow:7, value:"Interviewing" }, ...]
   *  or planner cells that already carry `range`. */
  async function applyCells(patches) {
    if (!Array.isArray(patches) || patches.length === 0) return true;
    const updates = patches.map((p) => ({
      range: p.range || ("Pipeline!" + p.column + p.sheetRow),
      value: p.value,
    }));
    const ok = await updateMultipleCells(updates, false, { guard: true });
    // A merged Notes cell (A9) is what the Sheet now holds: hand it back so
    // the caller's local sync shows the same text.
    if (ok) updates.forEach((u, i) => { patches[i].value = u.value; });
    return ok;
  }

  Object.assign(sheetsWrite, {
    updateSheetCell,
    updateMultipleCells,
    applyCells,
    sheetsBatchUpdate,
    sheetsValuesAppend,
    sheetsValuesGet,
    sheetsValuesUpdate,
    normalizeLeadUrlClient,
    ensureBlacklistTab,
    appendBlacklistRow,
    deleteBlacklistRowByUrl,
    providerKeyForUrl,
    listBlockedRoles,
    restoreBlockedRole,
    toggleFavorite,
    flushPendingFavorites,
    dismissJob,
    restoreJob,
    markStatusExpired,
    editJobField,
    getSheetRow,
    todayStr,
    futureDateStr,
    getStatusSideEffects,
    emitPipelineMoveSucceeded,
    updateJobStatus,
    updateJobNotes,
    updateFollowUpDate,
    updateLastHeardFrom,
    updateJobResponseFlag,
  });
})();
