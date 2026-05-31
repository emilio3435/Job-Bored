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

  function sheetId() {
    const h = host();
    return (h.getActiveSheetId && h.getActiveSheetId()) || h.getSheetId() || "";
  }

async function updateSheetCell(range, value, isRetry) {
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return false;
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
      host().showToast("Session expired — please sign in again", "error");
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
async function updateMultipleCells(updates, isRetry) {
  // updates: Array of { range, value }
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return false;
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
        if (refreshed) return updateMultipleCells(updates, true);
      }
      host().clearSessionAuthState();
      host().renderPipeline();
      host().showToast("Session expired — please sign in again", "error");
      return false;
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${resp.status}`;
      host().showToast("Update failed: " + errMsg, "error");
      return false;
    }

    return true;
  } catch (err) {
    host().showToast("Update failed — check your connection", "error");
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
  await sheetsValuesUpdate("Blacklist!A1:E1", [
    ["URL", "Dismissed At", "Title", "Company", "Reason"],
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
  ];
  try {
    await sheetsValuesAppend("Blacklist!A:E", [row]);
    return;
  } catch (err) {
    const msg = String(err?.message || "");
    if (/Unable to parse range/i.test(msg)) {
      await ensureBlacklistTab();
      await sheetsValuesAppend("Blacklist!A:E", [row]);
      return;
    }
    throw err;
  }
}

async function deleteBlacklistRowByUrl(url) {
  if (!host().getAccessToken()) throw new Error("Not signed in");
  const normalized = normalizeLeadUrlClient(url || "");
  if (!normalized) return false;
  let data;
  try {
    data = await sheetsValuesGet("Blacklist!A:A");
  } catch (err) {
    const msg = String(err?.message || "");
    if (/Unable to parse range/i.test(msg)) return false;
    throw err;
  }
  const values = data.values || [];
  let rowIndex = -1; // 0-based sheet row
  for (let i = 0; i < values.length; i++) {
    const cell = (values[i] && values[i][0]) || "";
    if (normalizeLeadUrlClient(cell) === normalized) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 1) return false; // skip header row (0) or missing
  // Look up the sheetId for "Blacklist"
  const meta = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${host().getAccessToken()}` } },
  ).then((r) => r.json());
  const sheet = (meta.sheets || []).find(
    (s) => s.properties && s.properties.title === "Blacklist",
  );
  if (!sheet) return false;
  await sheetsBatchUpdate({
    requests: [
      {
        deleteDimension: {
          range: {
            sheetId: sheet.properties.sheetId,
            dimension: "ROWS",
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
        },
      },
    ],
  });
  return true;
}

// localStorage-backed pending favorites map. Keyed by the job link (or by a
// link-less synthetic key built from title|company so manually-entered rows
// without a link still persist). Survives across refresh so a user who
// clicked the star but hadn't yet signed in / whose Sheet write failed
// still sees their pick on next load. Cleared per-row once the Sheet write
// succeeds (canonical column V holds "★").
const PENDING_FAVORITES_STORAGE_KEY = "jobbored.favorites.pending";

function favoriteCacheKeyForJob(job) {
  if (!job) return "";
  const link = job.link ? String(job.link).trim() : "";
  if (link) return link;
  const title = job.title ? String(job.title).trim().toLowerCase() : "";
  const company = job.company ? String(job.company).trim().toLowerCase() : "";
  if (!title && !company) return "";
  return `synthetic::${company}::${title}`;
}

function loadPendingFavorites() {
  try {
    const raw = localStorage.getItem(PENDING_FAVORITES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePendingFavorites(map) {
  try {
    localStorage.setItem(PENDING_FAVORITES_STORAGE_KEY, JSON.stringify(map || {}));
  } catch {
    // Quota exceeded or storage disabled — silent best-effort.
  }
}

function setPendingFavorite(cacheKey, favorite) {
  if (!cacheKey) return;
  const map = loadPendingFavorites();
  map[cacheKey] = !!favorite;
  savePendingFavorites(map);
}

function clearPendingFavorite(cacheKey) {
  if (!cacheKey) return;
  const map = loadPendingFavorites();
  if (!(cacheKey in map)) return;
  delete map[cacheKey];
  savePendingFavorites(map);
}

/** Layer pending (unwritten / unsynced) favorites into freshly-parsed jobs.
 *  Called after parsePipelineCSV so a user whose Sheet write failed or who
 *  toggled while auth-gated still sees their pick after refresh. Entries
 *  that match the canonical Sheet state are dropped from the cache. */
function applyFavoriteCache(jobs) {
  if (!jobs || !jobs.length) return;
  const map = loadPendingFavorites();
  if (!map || !Object.keys(map).length) return;
  let dirty = false;
  for (const job of jobs) {
    const cacheKey = favoriteCacheKeyForJob(job);
    if (!cacheKey || !(cacheKey in map)) continue;
    const pending = !!map[cacheKey];
    if (pending === !!job.favorite) {
      // Sheet caught up — drop the cache entry.
      delete map[cacheKey];
      dirty = true;
    } else {
      job.favorite = pending;
    }
  }
  if (dirty) savePendingFavorites(map);
}

async function toggleFavorite(stableKey) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return false;
  const next = !job.favorite;
  const cacheKey = favoriteCacheKeyForJob(job);

  // Mutate the in-memory model + record the user's intent locally
  // BEFORE any network/auth check, so the chip stays correct across a
  // refresh even if the Sheet write never lands.
  job.favorite = next;
  if (cacheKey) setPendingFavorite(cacheKey, next);
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
  const ok = await updateMultipleCells([
    { range: `Pipeline!V${sheetRow}`, value: next ? "★" : "" },
  ]);
  if (ok) {
    // Sheet now matches local intent — drop the cache entry.
    if (cacheKey) clearPendingFavorite(cacheKey);
    host().showToast(next ? "Favorited" : "Unfavorited", "success");
    return true;
  }
  // Sheet write failed but local intent stays in the cache so a refresh
  // still shows the user's pick. Surface a soft error. Return true so the
  // optimistic UI does NOT roll back — the favorite is durably captured
  // locally and the next successful CSV refresh will reconcile.
  host().showToast("Saved locally — retry when reconnected", "error");
  return true;
}

async function dismissJob(stableKey) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return;
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return;
  }
  const sheetRow = getSheetRow(stableKey);
  if (!sheetRow) return;
  const now = new Date().toISOString();
  job.dismissedAt = now;
  host().renderPipeline();

  let undone = false;
  const dismissToast = host().showToast(
    `Dismissed "${job.title || "role"}"`,
    "info",
    true,
    {
      label: "Undo",
      onClick: () => {
        undone = true;
        job.dismissedAt = null;
        host().renderPipeline();
      },
    },
  );

  await new Promise((r) => setTimeout(r, 10_000));
  if (typeof dismissToast === "function") dismissToast();
  if (undone) return;

  try {
    await Promise.all([
      (async () => {
        const ok = await updateMultipleCells([
          { range: `Pipeline!W${sheetRow}`, value: now },
        ]);
        if (!ok) throw new Error("Pipeline W write failed");
      })(),
      appendBlacklistRow({
        url: job.link || "",
        dismissedAt: now,
        title: job.title || "",
        company: job.company || "",
      }),
    ]);
  } catch (err) {
    console.error("[JobBored] dismiss persist failed", err);
    job.dismissedAt = null;
    host().renderPipeline();
    host().showToast("Couldn't save dismiss — reverted", "error");
  }
}

async function restoreJob(stableKey) {
  const job = host().getPipelineData()[stableKey];
  if (!job) return;
  if (!host().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return;
  }
  const sheetRow = getSheetRow(stableKey);
  if (!sheetRow) return;
  const prev = job.dismissedAt;
  job.dismissedAt = null;
  host().renderPipeline();
  try {
    const ok = await updateMultipleCells([
      { range: `Pipeline!W${sheetRow}`, value: "" },
    ]);
    if (!ok) throw new Error("Pipeline W clear failed");
    await deleteBlacklistRowByUrl(job.link || "");
    host().showToast("Restored", "success");
  } catch (err) {
    console.error("[JobBored] restore failed", err);
    job.dismissedAt = prev;
    host().renderPipeline();
    host().showToast("Couldn't restore — reverted", "error");
  }
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
  const sheetRow = getSheetRow(stableKey);
  if (!sheetRow) return;
  const prevStatus = job.status;
  if ((prevStatus || "").toLowerCase() === "expired") return;
  job.status = "Expired";
  host().renderPipeline();
  try {
    const ok = await updateMultipleCells([
      { range: `Pipeline!M${sheetRow}`, value: "Expired" },
    ]);
    if (!ok) throw new Error(`Pipeline M${sheetRow} write failed`);
    host().showToast("Marked Expired", "info");
  } catch (err) {
    console.error("[JobBored] markStatusExpired failed", err);
    job.status = prevStatus;
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
  job[field] = next;
  job._editLock = nextLock;
  host().renderPipeline();
  try {
    const ok = await updateMultipleCells([
      { range: `Pipeline!${col}${sheetRow}`, value: next },
      { range: `Pipeline!${EDIT_LOCK_COLUMN}${sheetRow}`, value: nextLock },
    ]);
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
function getStatusSideEffects(newStatus, job, sheetRow) {
  const updates = [{ range: `Pipeline!M${sheetRow}`, value: newStatus }];
  const localUpdates = { status: newStatus };
  const today = todayStr();

  switch (newStatus) {
    case "Applied":
      // Set Applied Date to today if not already set
      if (!job.appliedDate) {
        updates.push({ range: `Pipeline!N${sheetRow}`, value: today });
        localUpdates.appliedDate = today;
      }
      // Set Follow-up Date to 5 business days out if not already set
      if (!job.followUpDate) {
        const followUp = futureDateStr(7);
        updates.push({ range: `Pipeline!P${sheetRow}`, value: followUp });
        localUpdates.followUpDate = followUp;
      }
      break;

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

async function updateJobStatus(dataIndex, newStatus) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) {
    return false;
  }

  const job = host().getPipelineData()[dataIndex];
  const prevStatus = job ? job.status : "";
  const { updates, localUpdates } = getStatusSideEffects(
    newStatus,
    job,
    sheetRow,
  );

  const success = await updateMultipleCells(updates);

  if (success) {
    // Apply all local updates
    Object.assign(host().getPipelineData()[dataIndex], localUpdates);
    host().renderPipeline();
    host().renderStats();
    host().renderBrief();
    emitPipelineMoveSucceeded(dataIndex, prevStatus, newStatus);

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
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!O${sheetRow}`;
  const success = await updateSheetCell(range, notes);

  if (success) {
    host().getPipelineData()[dataIndex].notes = notes;
    host().getPipelineData()[dataIndex]._rawNotes = notes;
    host().refreshDrawerIfOpen(dataIndex);
    host().renderExpiredReviewButton();
    host().renderBrief();
    host().showToast("Notes saved");
  }
}

async function updateFollowUpDate(dataIndex, date) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!P${sheetRow}`;
  const success = await updateSheetCell(range, date);

  if (success) {
    host().getPipelineData()[dataIndex].followUpDate = date || null;
    host().refreshDrawerIfOpen(dataIndex);
    host().renderPipeline();
    host().renderBrief();
    host().showToast(date ? `Follow-up set: ${date}` : "Follow-up cleared");
  }
}

async function updateLastHeardFrom(dataIndex, value) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!R${sheetRow}`;
  const success = await updateSheetCell(range, value);

  if (success) {
    host().getPipelineData()[dataIndex].lastHeardFrom = value.trim() ? value.trim() : null;
    host().refreshDrawerIfOpen(dataIndex);
    host().renderBrief();
    host().showToast("Last contact saved");
  }
}

async function updateJobResponseFlag(dataIndex, value) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!S${sheetRow}`;
  const success = await updateSheetCell(range, value);

  if (success) {
    host().getPipelineData()[dataIndex].responseFlag = value.trim() ? value.trim() : null;
    host().refreshDrawerIfOpen(dataIndex);
    host().renderBrief();
    host().renderStats();
    host().showToast("Reply status saved");
  }
}

  Object.assign(sheetsWrite, {
    updateSheetCell,
    updateMultipleCells,
    sheetsBatchUpdate,
    sheetsValuesAppend,
    sheetsValuesGet,
    sheetsValuesUpdate,
    normalizeLeadUrlClient,
    ensureBlacklistTab,
    appendBlacklistRow,
    deleteBlacklistRowByUrl,
    favoriteCacheKeyForJob,
    loadPendingFavorites,
    savePendingFavorites,
    setPendingFavorite,
    clearPendingFavorite,
    applyFavoriteCache,
    toggleFavorite,
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
