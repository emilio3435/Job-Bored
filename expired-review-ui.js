/* ============================================
   COMMAND CENTER v2 — Expired Review UI
   Extracted from app.js (expired-review-ui cut).

   Classic-global IIFE under window.JobBoredApp.expiredReview — NOT an ES module.
   Loaded BEFORE app.js. Library logic stays in expired-review.js
   (window.JobBoredExpiredReview).
   ============================================ */
(() => {
  const root = window.JobBoredApp || (window.JobBoredApp = {});
  const expiredReview = root.expiredReview || (root.expiredReview = {});

  function host() {
    return window.JobBoredApp.core.host;
  }

  function core() {
    return window.JobBoredApp.core;
  }

  function getPipelineData() {
    return core().getPipelineData();
  }

  let expiredReviewModalKeyHandler = null;

function getExpiredReviewItems() {
  const api = window.JobBoredExpiredReview;
  if (!api || typeof api.getReviewJobs !== "function") return [];
  return api.getReviewJobs(getPipelineData(), { now: new Date() });
}

function renderExpiredReviewButton() {
  const btn = document.getElementById("expiredReviewBtn");
  const countEl = document.getElementById("expiredReviewCount");
  if (!btn) return;
  const items = getExpiredReviewItems();
  const count = items.length;
  btn.hidden = count === 0;
  btn.setAttribute(
    "aria-label",
    count
      ? `Review ${count} potentially expired posting${count === 1 ? "" : "s"}`
      : "No postings need expired-job review",
  );
  btn.title = count
    ? `Review ${count} potentially expired posting${count === 1 ? "" : "s"}`
    : "No postings need expired-job review";
  if (countEl) {
    countEl.textContent = count > 99 ? "99+" : String(count);
    countEl.hidden = count === 0;
  }
}

function formatExpiredReviewDate(job) {
  const raw = job && (job.dateFoundRaw || job.dateFound);
  if (!raw) return "";
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) return String(raw || "");
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Selection state for the review modal. Cleared whenever the modal closes
// or the list re-renders, since indexes are re-derived from getPipelineData().
let expiredReviewSelection = new Set();

function renderExpiredReviewModal() {
  const list = document.getElementById("expiredReviewList");
  const summary = document.getElementById("expiredReviewModalSummary");
  const bulkbar = document.getElementById("expiredReviewBulkbar");
  if (!list) return;
  const items = getExpiredReviewItems();
  // Drop selections that no longer correspond to a listed row.
  const liveIndexes = new Set(items.map((it) => it.index));
  expiredReviewSelection.forEach((idx) => {
    if (!liveIndexes.has(idx)) expiredReviewSelection.delete(idx);
  });
  if (summary) {
    summary.textContent = items.length
      ? `${items.length} posting${items.length === 1 ? "" : "s"} need a quick check. Open the listing in a new tab, then mark each one Expired, dismiss it, or send it back to Researching.`
      : "All clear — every active posting passed the latest availability check.";
  }
  if (bulkbar) {
    bulkbar.hidden = items.length === 0;
  }
  if (!items.length) {
    list.innerHTML =
      '<p class="expired-review-empty">All clear. Aging New and Researching roles will appear here next time the cleanup pass flags them.</p>';
    updateExpiredReviewBulkUi(items);
    return;
  }
  list.innerHTML = items
    .map((entry) => {
      const job = entry.job || {};
      const reason = entry.reason || {};
      const href = host().safeHref(job.link);
      const found = formatExpiredReviewDate(job);
      const status = String(job.status || "New").trim() || "New";
      const title = job.title || "Untitled role";
      const company = job.company || "Unknown company";
      const meta = [
        status ? `Status: ${status}` : "",
        found ? `Found: ${found}` : "",
        job.location ? `Location: ${job.location}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const checked = expiredReviewSelection.has(entry.index) ? "checked" : "";
      return `
        <article class="expired-review-item" data-row-index="${entry.index}">
          <input type="checkbox" class="expired-review-item__select" data-action="expired-review-select" data-index="${entry.index}" ${checked} aria-label="Select ${host().escapeHtml(title)}" />
          <div class="expired-review-item__body">
            <h4 class="expired-review-item__title">${host().escapeHtml(title)}</h4>
            <p class="expired-review-item__company">${host().escapeHtml(company)}</p>
            ${meta ? `<p class="expired-review-item__meta">${host().escapeHtml(meta)}</p>` : ""}
            <span class="expired-review-item__reason">${host().escapeHtml(reason.label || "Needs review")}</span>
            ${
              reason.detail
                ? `<p class="expired-review-item__meta">${host().escapeHtml(reason.detail)}</p>`
                : ""
            }
          </div>
          <div class="expired-review-item__actions">
            ${
              href
                ? `<a class="expired-review-item__action" href="${host().escapeHtml(href)}" target="_blank" rel="noopener">Open posting</a>`
                : ""
            }
            <button type="button" class="expired-review-item__action expired-review-item__action--expire" data-action="expired-review-mark-expired" data-index="${entry.index}">Mark Expired</button>
            <button type="button" class="expired-review-item__action expired-review-item__action--dismiss" data-action="expired-review-dismiss" data-index="${entry.index}">Dismiss</button>
            <button type="button" class="expired-review-item__action expired-review-item__action--researching" data-action="expired-review-set-researching" data-index="${entry.index}">Set Researching</button>
          </div>
        </article>`;
    })
    .join("");
  updateExpiredReviewBulkUi(items);
}

function updateExpiredReviewBulkUi(items) {
  const total = items ? items.length : 0;
  const selected = expiredReviewSelection.size;
  const countEl = document.getElementById("expiredReviewSelectedCount");
  if (countEl) countEl.textContent = `${selected} selected`;
  const selectAll = document.getElementById("expiredReviewSelectAll");
  if (selectAll) {
    selectAll.checked = total > 0 && selected === total;
    selectAll.indeterminate = selected > 0 && selected < total;
  }
  document
    .querySelectorAll("#expiredReviewBulkbar [data-bulk-action]")
    .forEach((btn) => {
      btn.disabled = selected === 0;
    });
}

async function applyExpiredReviewAction(action, index) {
  const job = getPipelineData()[index];
  if (!job) return;
  if (!core().getAccessToken()) {
    host().showSheetAccessGate("signin");
    return;
  }
  if (action === "dismiss") {
    await host().dismissJob(index);
    return;
  }
  const sheetRow = host().getSheetRow(index);
  if (!sheetRow) return;
  let nextStatus = null;
  if (action === "expire") nextStatus = "Expired";
  if (action === "researching") nextStatus = "Researching";
  if (!nextStatus) return;
  const prevStatus = job.status;
  job.status = nextStatus;
  host().renderPipeline();
  try {
    const ok = await host().updateMultipleCells([
      { range: `Pipeline!M${sheetRow}`, value: nextStatus },
    ]);
    if (!ok) throw new Error(`Pipeline M${sheetRow} write failed`);
  } catch (err) {
    console.error("[JobBored] review action failed", err);
    job.status = prevStatus;
    host().renderPipeline();
    host().showToast(`Couldn't update status — reverted`, "error");
  }
}

async function applyExpiredReviewBulk(action) {
  const indexes = Array.from(expiredReviewSelection);
  if (!indexes.length) return;
  for (const idx of indexes) {
    // Sequential so each writeback completes before the next; matches the
    // shape of dismissJob's single-row toast/undo and avoids token races.
    // eslint-disable-next-line no-await-in-loop
    await applyExpiredReviewAction(action, idx);
  }
  expiredReviewSelection.clear();
  renderExpiredReviewModal();
}

async function runCleanupFromReviewModal() {
  const btn = document.getElementById("expiredReviewRunCleanup");
  const hint = document.getElementById("expiredReviewRunCleanupHint");
  const spinner = btn?.querySelector(".expired-review-card__run-spinner");
  if (btn) btn.disabled = true;
  if (spinner) spinner.hidden = false;
  if (hint) {
    hint.hidden = false;
    hint.textContent = "Running cleanup…";
  }
  try {
    const result = await callCleanupExpiredWebhook({ dryRun: false });
    if (!result || !result.ok) {
      throw new Error(result?.message || "Cleanup endpoint refused the request");
    }
    if (hint) {
      hint.textContent = `Cleanup finished — ${result.needsReview || 0} need review, ${result.updated || 0} flipped to Expired.`;
    }
    await host().loadAllData();
    renderExpiredReviewModal();
  } catch (err) {
    console.error("[JobBored] run cleanup now failed", err);
    if (hint) {
      hint.textContent = `Cleanup failed: ${err && err.message ? err.message : "unknown error"}`;
    }
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.hidden = true;
  }
}

async function callCleanupExpiredWebhook({ dryRun }) {
  const worker = window.JobBoredConfig && window.JobBoredConfig.discoveryWorker;
  const baseUrl = worker && worker.baseUrl;
  const secret = worker && worker.webhookSecret;
  const sheetId = window.JobBoredConfig && window.JobBoredConfig.spreadsheetId;
  if (!baseUrl || !secret || !sheetId) {
    throw new Error("Discovery worker is not configured (baseUrl/secret/sheetId).");
  }
  const url = baseUrl.replace(/\/+$/, "") + "/cleanup-expired";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discovery-secret": secret,
    },
    body: JSON.stringify({
      sheetId,
      dryRun: !!dryRun,
      googleAccessToken: core().getAccessToken() || undefined,
    }),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {
    payload = null;
  }
  if (!res.ok) {
    throw new Error((payload && payload.message) || `HTTP ${res.status}`);
  }
  return payload;
}

function openExpiredReviewModal() {
  const modal = document.getElementById("expiredReviewModal");
  if (!modal) return;
  if (expiredReviewModalKeyHandler) {
    document.removeEventListener("keydown", expiredReviewModalKeyHandler);
    expiredReviewModalKeyHandler = null;
  }
  renderExpiredReviewModal();
  modal.style.display = "flex";
  const closeBtn = document.getElementById("expiredReviewModalClose");
  if (closeBtn) closeBtn.focus();
  expiredReviewModalKeyHandler = (e) => {
    if (e.key === "Escape") closeExpiredReviewModal();
  };
  document.addEventListener("keydown", expiredReviewModalKeyHandler);
}

function closeExpiredReviewModal() {
  const modal = document.getElementById("expiredReviewModal");
  if (modal) modal.style.display = "none";
  if (expiredReviewModalKeyHandler) {
    document.removeEventListener("keydown", expiredReviewModalKeyHandler);
    expiredReviewModalKeyHandler = null;
  }
  expiredReviewSelection.clear();
}

function maybeAutoOpenExpiredReviewModal() {
  if (window.__expiredReviewAutoOpenedThisSession) return;
  // Only auto-open after an actual interactive sign-in. A plain page
  // refresh triggers a silent-restore (token still valid in storage)
  // and should NOT pop the triage modal — that was a flicker bug.
  // The interactive sign-in path sets this flag right before calling
  // loadAllData(); silent paths leave it false.
  if (!window.__expiredReviewArmFromInteractiveSignin) return;
  const items = getExpiredReviewItems();
  if (!items.length) return;
  window.__expiredReviewAutoOpenedThisSession = true;
  window.__expiredReviewArmFromInteractiveSignin = false;
  // Defer one tick so the dashboard finishes its post-load render first;
  // otherwise the modal pops over a half-painted card grid.
  setTimeout(openExpiredReviewModal, 60);
}

function initExpiredReviewUi() {
  document
    .getElementById("expiredReviewBtn")
    ?.addEventListener("click", openExpiredReviewModal);
  document
    .getElementById("expiredReviewModalClose")
    ?.addEventListener("click", closeExpiredReviewModal);
  document
    .getElementById("expiredReviewRunCleanup")
    ?.addEventListener("click", runCleanupFromReviewModal);
  const selectAll = document.getElementById("expiredReviewSelectAll");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      const items = getExpiredReviewItems();
      expiredReviewSelection.clear();
      if (selectAll.checked) {
        items.forEach((it) => expiredReviewSelection.add(it.index));
      }
      renderExpiredReviewModal();
    });
  }
  document
    .querySelectorAll("#expiredReviewBulkbar [data-bulk-action]")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-bulk-action");
        applyExpiredReviewBulk(action);
      });
    });
  const modal = document.getElementById("expiredReviewModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeExpiredReviewModal();
        return;
      }
      const expireBtn = e.target.closest?.(
        '[data-action="expired-review-mark-expired"]',
      );
      if (expireBtn) {
        const idx = parseInt(expireBtn.dataset.index, 10);
        applyExpiredReviewAction("expire", idx).then(renderExpiredReviewModal);
        return;
      }
      const dismissBtn = e.target.closest?.(
        '[data-action="expired-review-dismiss"]',
      );
      if (dismissBtn) {
        const idx = parseInt(dismissBtn.dataset.index, 10);
        applyExpiredReviewAction("dismiss", idx).then(renderExpiredReviewModal);
        return;
      }
      const researchBtn = e.target.closest?.(
        '[data-action="expired-review-set-researching"]',
      );
      if (researchBtn) {
        const idx = parseInt(researchBtn.dataset.index, 10);
        applyExpiredReviewAction("researching", idx).then(
          renderExpiredReviewModal,
        );
        return;
      }
    });
    modal.addEventListener("change", (e) => {
      const cb = e.target.closest?.('[data-action="expired-review-select"]');
      if (!cb) return;
      const idx = parseInt(cb.dataset.index, 10);
      if (Number.isNaN(idx)) return;
      if (cb.checked) expiredReviewSelection.add(idx);
      else expiredReviewSelection.delete(idx);
      updateExpiredReviewBulkUi(getExpiredReviewItems());
    });
  }
}


  Object.assign(expiredReview, {
    getExpiredReviewItems,
    renderExpiredReviewButton,
    renderExpiredReviewModal,
    openExpiredReviewModal,
    closeExpiredReviewModal,
    maybeAutoOpenExpiredReviewModal,
    initExpiredReviewUi,
  });
})();
