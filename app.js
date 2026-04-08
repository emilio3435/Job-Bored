/* ============================================
   COMMAND CENTER v2 — App Logic
   CSV read + Google Sheets API v4 write-back
   Google Identity Services (GIS) OAuth 2.0
   ============================================ */

// ============================================
// CONFIG VALIDATION
// ============================================

function getConfig() {
  const cfg = window.COMMAND_CENTER_CONFIG;
  if (!cfg) return null;
  if (!cfg.sheetId || cfg.sheetId === 'YOUR_SHEET_ID_HERE') return null;
  return cfg;
}

function getSheetId() {
  // URL parameter override
  const params = new URLSearchParams(window.location.search);
  const urlSheet = params.get('sheet');
  if (urlSheet && urlSheet.length > 10) return urlSheet;

  const cfg = getConfig();
  return cfg ? cfg.sheetId : null;
}

function getOAuthClientId() {
  const cfg = getConfig();
  if (!cfg) return null;
  if (!cfg.oauthClientId || cfg.oauthClientId === 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com') return null;
  return cfg.oauthClientId;
}

// ============================================
// STATE
// ============================================

let SHEET_ID = null;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

let pipelineData = [];
let pipelineRawRows = []; // Keep raw rows for row index mapping
let weeklyPulseData = [];
let aiBriefData = [];
let currentFilter = 'all';
let currentSort = 'fit';
let currentSearch = '';
let pulseChart = null;
let dataLoadFailed = false;

// Auth state — stored in memory (NOT localStorage, blocked in iframes)
let accessToken = null;
let userEmail = null;
let tokenClient = null;
let gisLoaded = false;

// ============================================
// TOAST SYSTEM
// ============================================

function showToast(message, type = 'success', persistent = false) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '✓',
    error: '✗',
    info: 'i',
  };

  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Dismiss">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;

  const dismiss = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);

  container.appendChild(toast);

  // Auto-dismiss success/info toasts
  if (!persistent && type !== 'error') {
    setTimeout(dismiss, 3000);
  }
}

// ============================================
// AUTH — Google Identity Services
// ============================================

function initAuth() {
  const clientId = getOAuthClientId();
  if (!clientId) {
    // No OAuth configured — hide auth section entirely
    const authSection = document.getElementById('authSection');
    if (authSection) authSection.style.display = 'none';
    return;
  }

  // Wait for GIS library to load
  function tryInit() {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      gisLoaded = true;
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/userinfo.email',
        callback: handleTokenResponse,
      });
      setupAuthUI();
    } else {
      // Retry in 200ms — GIS library is loaded async
      setTimeout(tryInit, 200);
    }
  }

  tryInit();
}

function handleTokenResponse(tokenResponse) {
  if (tokenResponse.error) {
    console.error('[Command Center] OAuth error:', tokenResponse.error);
    showToast('Sign-in failed: ' + (tokenResponse.error_description || tokenResponse.error), 'error');
    return;
  }

  accessToken = tokenResponse.access_token;
  console.log('[Command Center] Signed in successfully');

  // Fetch user email
  fetchUserEmail();
  updateAuthUI();
  showToast('Signed in — you can now update your sheet', 'success');

  // Re-render to show action buttons
  renderPipeline();
}

async function fetchUserEmail() {
  if (!accessToken) return;
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (resp.ok) {
      const data = await resp.json();
      userEmail = data.email || null;
      updateAuthUI();
    }
  } catch (err) {
    console.warn('[Command Center] Could not fetch user email:', err.message);
  }
}

function signIn() {
  if (!tokenClient) {
    showToast('OAuth not configured — edit config.js', 'error');
    return;
  }
  tokenClient.requestAccessToken();
}

function signOut() {
  if (accessToken) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {
        console.log('[Command Center] Token revoked');
      });
    } catch (e) {
      // Ignore revoke errors
    }
  }
  accessToken = null;
  userEmail = null;
  updateAuthUI();
  renderPipeline();
  showToast('Signed out', 'info');
}

function setupAuthUI() {
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');

  if (signInBtn) signInBtn.addEventListener('click', signIn);
  if (signOutBtn) signOutBtn.addEventListener('click', signOut);
}

function updateAuthUI() {
  const signInBtn = document.getElementById('signInBtn');
  const authUser = document.getElementById('authUser');
  const authEmail = document.getElementById('authEmail');

  if (accessToken) {
    signInBtn.style.display = 'none';
    authUser.style.display = 'flex';
    authEmail.textContent = userEmail || 'Signed in';
  } else {
    signInBtn.style.display = 'flex';
    authUser.style.display = 'none';
    authEmail.textContent = '';
  }
}

function isSignedIn() {
  return !!accessToken;
}

// ============================================
// WRITE-BACK — Google Sheets API v4
// ============================================

async function updateSheetCell(range, value) {
  if (!accessToken) {
    showToast('Sign in to update your sheet', 'error');
    return false;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;

  try {
    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        range: range,
        majorDimension: 'ROWS',
        values: [[value]],
      }),
    });

    if (resp.status === 401) {
      // Token expired
      accessToken = null;
      userEmail = null;
      updateAuthUI();
      renderPipeline();
      showToast('Session expired — please sign in again', 'error');
      return false;
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${resp.status}`;
      console.error('[Command Center] Sheet update failed:', errMsg);
      showToast('Update failed: ' + errMsg, 'error');
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Command Center] Sheet update error:', err);
    showToast('Update failed — check your connection', 'error');
    return false;
  }
}

async function updateMultipleCells(updates) {
  // updates: Array of { range, value }
  if (!accessToken) {
    showToast('Sign in to update your sheet', 'error');
    return false;
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updates.map(u => ({
          range: u.range,
          majorDimension: 'ROWS',
          values: [[u.value]],
        })),
      }),
    });

    if (resp.status === 401) {
      accessToken = null;
      userEmail = null;
      updateAuthUI();
      renderPipeline();
      showToast('Session expired — please sign in again', 'error');
      return false;
    }

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${resp.status}`;
      showToast('Update failed: ' + errMsg, 'error');
      return false;
    }

    return true;
  } catch (err) {
    showToast('Update failed — check your connection', 'error');
    return false;
  }
}

// Row index: the position in pipelineData maps to raw row index
// pipelineData[i] comes from pipelineRawRows[i], which is rows[i+1] (skip header)
// So sheet row = rawRowIndex + 2 (1-indexed, +1 for header)
function getSheetRow(dataIndex) {
  // dataIndex is the index into pipelineData
  // We need to map back to the original row in the raw CSV
  const job = pipelineData[dataIndex];
  if (!job || job._rawIndex == null) return null;
  return job._rawIndex + 2; // +1 for 0-based, +1 for header row
}

async function updateJobStatus(dataIndex, newStatus) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!M${sheetRow}`;
  const success = await updateSheetCell(range, newStatus);

  if (success) {
    // Optimistic update
    pipelineData[dataIndex].status = newStatus;
    renderPipeline();
    renderStats();
    showToast(`Updated to "${newStatus}"`);
  }
}

async function markApplied(dataIndex) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const success = await updateMultipleCells([
    { range: `Pipeline!M${sheetRow}`, value: 'Applied' },
    { range: `Pipeline!N${sheetRow}`, value: today },
  ]);

  if (success) {
    pipelineData[dataIndex].status = 'Applied';
    pipelineData[dataIndex].appliedDate = today;
    renderPipeline();
    renderStats();
    showToast('Marked as Applied');
  }
}

async function updateJobNotes(dataIndex, notes) {
  const sheetRow = getSheetRow(dataIndex);
  if (!sheetRow) return;

  const range = `Pipeline!O${sheetRow}`;
  const success = await updateSheetCell(range, notes);

  if (success) {
    pipelineData[dataIndex].notes = notes;
    showToast('Notes saved');
  }
}

// ============================================
// LIGHTWEIGHT CSV PARSER
// ============================================

function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];
  let fieldStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (fieldStart && ch === '"') {
      inQuotes = true;
      fieldStart = false;
      continue;
    }

    fieldStart = false;

    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === ',') {
        row.push(current.trim());
        current = '';
        fieldStart = true;
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        row.push(current.trim());
        if (row.some(cell => cell !== '')) {
          rows.push(row);
        }
        row = [];
        current = '';
        fieldStart = true;
        if (ch === '\r') i++;
      } else if (ch === '\r') {
        row.push(current.trim());
        if (row.some(cell => cell !== '')) {
          rows.push(row);
        }
        row = [];
        current = '';
        fieldStart = true;
      } else {
        current += ch;
      }
    }
  }

  row.push(current.trim());
  if (row.some(cell => cell !== '')) {
    rows.push(row);
  }

  return rows;
}

// ============================================
// DATA FETCHING — JSONP (bypasses CORS/iframe restrictions)
// ============================================

let _jsonpCounter = 0;

function fetchSheetJSONP(sheetName) {
  return new Promise((resolve, reject) => {
    const callbackName = `__commandCenter_cb_${++_jsonpCounter}`;
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(sheetName)}`;

    console.log(`[Command Center] JSONP fetch: ${sheetName}`);

    const timeout = setTimeout(() => {
      cleanup();
      console.error(`[Command Center] JSONP timeout for ${sheetName}`);
      reject(new Error(`Timeout fetching ${sheetName}`));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      const el = document.getElementById(`jsonp-${callbackName}`);
      if (el) el.remove();
    }

    window[callbackName] = function(response) {
      cleanup();
      if (!response || !response.table) {
        reject(new Error(`Invalid response for ${sheetName}`));
        return;
      }
      console.log(`[Command Center] ${sheetName} loaded via JSONP (${response.table.rows ? response.table.rows.length : 0} rows)`);
      resolve(response.table);
    };

    const script = document.createElement('script');
    script.id = `jsonp-${callbackName}`;
    script.src = url;
    script.onerror = () => {
      cleanup();
      console.error(`[Command Center] JSONP script error for ${sheetName}`);
      reject(new Error(`Script load failed for ${sheetName}`));
    };
    document.head.appendChild(script);
  });
}

function getCellValue(cell) {
  if (!cell) return null;
  if (cell.v === null || cell.v === undefined) return null;
  return cell.v;
}

function getCellFormatted(cell) {
  if (!cell) return null;
  if (cell.f) return cell.f;
  return getCellValue(cell);
}

function parseGvizDate(val) {
  if (!val) return null;
  if (typeof val === 'string' && val.startsWith('Date(')) {
    const parts = val.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (parts) return new Date(parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]));
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

async function fetchSheetCSV(sheetName) {
  // Primary: use JSONP (works inside iframes, no CORS issues)
  try {
    const table = await fetchSheetJSONP(sheetName);
    // Convert gviz table to CSV-like rows array for compatibility with existing parsers
    const headers = table.cols.map(c => c.label || c.id);
    const rows = [headers];
    for (const row of (table.rows || [])) {
      const cells = [];
      for (let i = 0; i < headers.length; i++) {
        const cell = row.c ? row.c[i] : null;
        if (!cell || cell.v === null || cell.v === undefined) {
          cells.push('');
        } else if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) {
          const d = parseGvizDate(cell.v);
          cells.push(d ? d.toISOString().split('T')[0] : (cell.f || ''));
        } else if (cell.f) {
          cells.push(cell.f);
        } else {
          cells.push(String(cell.v));
        }
      }
      rows.push(cells);
    }
    return rows;
  } catch (err) {
    console.error(`[Command Center] JSONP failed for ${sheetName}:`, err.message);
  }

  // Fallback: try fetch CSV (works when not in iframe)
  const csvUrls = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pub?gid=0&single=true&output=csv`,
  ];

  for (const url of csvUrls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (!text || text.length < 10) continue;
      if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) continue;
      console.log(`[Command Center] ${sheetName} loaded via CSV fallback`);
      return parseCSV(text);
    } catch (e) {
      continue;
    }
  }

  console.error(`[Command Center] All fetch attempts failed for ${sheetName}`);
  return null;
}

function parsePipelineCSV(rows) {
  if (!rows || rows.length < 2) return [];

  const dataRows = rows.slice(1);
  const results = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const title = row[1] || null;
    const company = row[2] || null;

    if (!title && !company) continue;
    if (!company && !row[4] && !row[7]) continue;

    const fitScoreRaw = row[7];
    let fitScore = null;
    if (fitScoreRaw) {
      const parsed = parseFloat(fitScoreRaw);
      if (!isNaN(parsed)) fitScore = parsed;
    }

    let dateFound = null;
    const dateRaw = row[0] || null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!isNaN(d.getTime())) dateFound = d;
    }

    results.push({
      _rawIndex: i, // Index into dataRows (0-based), sheet row = i + 2
      dateFound: dateFound,
      dateFoundRaw: dateRaw,
      title: title ? title.trim() : null,
      company: company,
      location: row[3] || null,
      link: row[4] || null,
      source: row[5] || null,
      salary: row[6] || null,
      fitScore: fitScore,
      priority: row[8] || null,
      tags: row[9] || null,
      fitAssessment: row[10] || null,
      contact: row[11] || null,
      status: row[12] || null,
      appliedDate: row[13] || null,
      notes: row[14] || null,
      followUpDate: row[15] || null,
      talkingPoints: row[16] || null,
    });
  }

  return results;
}

function parseWeeklyPulseCSV(rows) {
  if (!rows || rows.length < 2) return [];
  const dataRows = rows.slice(1);
  const results = [];
  for (const row of dataRows) {
    const weekOf = row[0] || null;
    if (!weekOf) continue;
    results.push({
      weekOf, totalFound: row[1] || null, applied: row[2] || null,
      responses: row[3] || null, interviews: row[4] || null,
      topCompanies: row[5] || null, trends: row[6] || null,
      strategyNote: row[7] || null,
    });
  }
  return results;
}

function parseAIBriefCSV(rows) {
  if (!rows || rows.length < 2) return [];
  const dataRows = rows.slice(1);
  const results = [];
  for (const row of dataRows) {
    const date = row[0] || null;
    if (!date) continue;
    results.push({ date, brief: row[1] || null });
  }
  return results;
}

// ============================================
// MAIN DATA LOADER
// ============================================

async function loadAllData() {
  const refreshBtn = document.getElementById('refreshBtn');
  refreshBtn.classList.add('loading');

  try {
    const [pipelineRows, pulseRows, briefRows] = await Promise.all([
      fetchSheetCSV('Pipeline'),
      fetchSheetCSV('Weekly Pulse'),
      fetchSheetCSV('AI Brief'),
    ]);

    if (!pipelineRows && !pulseRows && !briefRows) {
      showErrorState();
      dataLoadFailed = true;
      return;
    }

    dataLoadFailed = false;
    hideErrorState();

    if (pipelineRows) {
      pipelineRawRows = pipelineRows;
      pipelineData = parsePipelineCSV(pipelineRows);
      console.log(`[Command Center] Pipeline: ${pipelineData.length} jobs`);
    }

    if (pulseRows) {
      weeklyPulseData = parseWeeklyPulseCSV(pulseRows);
    }

    if (briefRows) {
      aiBriefData = parseAIBriefCSV(briefRows);
    }

    renderAll();
    updateLastRefresh();
  } catch (err) {
    console.error('[Command Center] Error loading data:', err);
    showErrorState();
    dataLoadFailed = true;
  } finally {
    refreshBtn.classList.remove('loading');
  }
}

function showErrorState() {
  const jobCards = document.getElementById('jobCards');
  const errorState = document.getElementById('errorState');
  const errorOpenDirect = document.getElementById('errorOpenDirect');
  const errorViewSheet = document.getElementById('errorViewSheet');

  jobCards.innerHTML = '';
  errorState.style.display = 'block';
  errorOpenDirect.href = window.location.href;
  errorViewSheet.href = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
}

function hideErrorState() {
  document.getElementById('errorState').style.display = 'none';
}

// ============================================
// RENDERING
// ============================================

function renderAll() {
  renderStats();
  renderPipeline();
  renderBrief();
  renderPulse();
}

function renderStats() {
  const total = pipelineData.length;
  const hot = pipelineData.filter(r => r.priority === '🔥').length;
  const applied = pipelineData.filter(r => r.status && r.status.toLowerCase().includes('applied')).length;
  const interviewing = pipelineData.filter(r => {
    if (!r.status) return false;
    const s = r.status.toLowerCase();
    return s.includes('interview') || s.includes('phone screen');
  }).length;

  const scores = pipelineData.filter(r => r.fitScore != null).map(r => r.fitScore);
  const avgFit = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—';

  const appliedRoles = pipelineData.filter(r => r.status && r.status.toLowerCase().includes('applied'));
  const withResponse = appliedRoles.filter(r => {
    const s = r.status.toLowerCase();
    return s.includes('interview') || s.includes('phone') || s.includes('offer') || s.includes('rejected');
  });
  const responseRate = appliedRoles.length > 0
    ? Math.round((withResponse.length / appliedRoles.length) * 100) + '%'
    : '—';

  animateNumber('totalRoles', total);
  animateNumber('hotCount', hot);
  animateNumber('appliedCount', applied);
  animateNumber('interviewCount', interviewing);
  document.getElementById('avgFit').textContent = avgFit;
  document.getElementById('responseRate').textContent = responseRate;
}

function animateNumber(id, value) {
  const el = document.getElementById(id);
  if (el.textContent === '—' || el.textContent === '0') {
    el.textContent = value;
    return;
  }
  const start = parseInt(el.textContent) || 0;
  if (start === value) return;
  const duration = 400;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (value - start) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// --- Pipeline ---
function getFilteredData() {
  let data = [...pipelineData];

  switch (currentFilter) {
    case 'hot':
      data = data.filter(r => r.priority === '🔥');
      break;
    case 'high':
      data = data.filter(r => r.priority === '⚡');
      break;
    case 'applied':
      data = data.filter(r => r.status && r.status.toLowerCase().includes('applied'));
      break;
    case 'interviewing':
      data = data.filter(r => {
        if (!r.status) return false;
        const s = r.status.toLowerCase();
        return s.includes('interview') || s.includes('phone');
      });
      break;
    case 'new':
      data = data.filter(r => r.status && r.status.toLowerCase() === 'new');
      break;
  }

  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    data = data.filter(r => {
      const searchable = [r.title, r.company, r.tags, r.location, r.source, r.notes].filter(Boolean).join(' ').toLowerCase();
      return searchable.includes(q);
    });
  }

  switch (currentSort) {
    case 'fit':
      data.sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));
      break;
    case 'date':
      data.sort((a, b) => {
        const da = a.dateFound ? a.dateFound.getTime() : 0;
        const db = b.dateFound ? b.dateFound.getTime() : 0;
        return db - da;
      });
      break;
    case 'company':
      data.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
      break;
    case 'priority':
      const priorityOrder = { '🔥': 0, '⚡': 1, '—': 2, '↓': 3 };
      data.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));
      break;
  }

  return data;
}

function renderPipeline() {
  const container = document.getElementById('jobCards');
  const emptyState = document.getElementById('emptyState');
  const roleCountEl = document.getElementById('roleCount');
  const data = getFilteredData();

  roleCountEl.textContent = `${data.length} of ${pipelineData.length}`;

  if (data.length === 0 && !dataLoadFailed) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';
  if (data.length === 0) return;

  container.innerHTML = data.map((job, i) => renderJobCard(job, i)).join('');
  attachCardListeners();
}

function renderJobCard(job, index) {
  const priorityClass = job.priority === '🔥' ? 'priority-hot' : job.priority === '⚡' ? 'priority-high' : '';
  const priorityBadge = job.priority || '—';

  let fitClass = 'low';
  if (job.fitScore >= 9) fitClass = 'high';
  else if (job.fitScore >= 7) fitClass = 'mid';

  const statusClass = getStatusClass(job.status);
  const statusLabel = job.status || 'Unknown';
  const tags = job.tags ? job.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  // Follow up warning
  let followUpHtml = '';
  if (job.followUpDate) {
    const now = new Date();
    const fDate = new Date(job.followUpDate);
    const isOverdue = fDate < now;
    followUpHtml = `
      <span class="card-followup ${isOverdue ? 'overdue' : ''}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Follow-up: ${escapeHtml(job.followUpDate)}${isOverdue ? ' (overdue)' : ''}
      </span>
    `;
  }

  // Contact
  let contactHtml = '';
  if (job.contact && job.contact !== 'Not found') {
    contactHtml = `
      <span class="card-contact">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        ${escapeHtml(job.contact)}
      </span>
    `;
  }

  // Talking points
  let talkingPointsHtml = '';
  if (job.talkingPoints) {
    const points = job.talkingPoints
      .split('\n')
      .map(l => l.replace(/^[•\-\*]\s*/, '').trim())
      .filter(Boolean);
    if (points.length > 0) {
      talkingPointsHtml = `
        <div class="card-talking-points visible">
          <div class="talking-points-header" data-toggle="tp-${index}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Talking Points
            <svg class="tp-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="talking-points-content" id="tp-${index}">
            <ul>
              ${points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
            </ul>
          </div>
        </div>
      `;
    }
  }

  // Fit assessment
  let assessmentHtml = '';
  if (job.fitAssessment) {
    assessmentHtml = `
      <div class="card-assessment">
        <div class="assessment-text" data-expandable="assess-${index}">${escapeHtml(job.fitAssessment)}</div>
        <button class="expand-btn" data-expand="assess-${index}">Show more</button>
      </div>
    `;
  }

  // Actions section
  const actionsHtml = renderCardActions(job, index);

  const title = job.title || 'Untitled Role';
  const company = job.company || 'Unknown Company';

  return `
    <article class="job-card ${priorityClass}" style="animation-delay: ${index * 40}ms">
      <div class="card-top">
        <div class="card-top-left">
          <span class="priority-badge">${priorityBadge}</span>
          ${job.fitScore != null ? `<span class="fit-score ${fitClass}">${job.fitScore}</span>` : ''}
          <div class="card-title-group">
            <h3 class="card-title">${escapeHtml(title)}</h3>
            <span class="card-company">${escapeHtml(company)}</span>
          </div>
        </div>
        <div class="card-top-right">
          <span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span>
        </div>
      </div>

      <div class="card-meta">
        ${job.location ? `
          <span class="card-meta-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${escapeHtml(job.location)}
          </span>
        ` : ''}
        ${job.source ? `
          <span class="meta-divider"></span>
          <span class="card-meta-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            ${escapeHtml(job.source)}
          </span>
        ` : ''}
        ${job.salary && job.salary.toLowerCase() !== 'not listed' ? `
          <span class="meta-divider"></span>
          <span class="card-meta-item salary-tag">${escapeHtml(job.salary)}</span>
        ` : ''}
        ${job.dateFoundRaw ? `
          <span class="meta-divider"></span>
          <span class="card-meta-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            ${escapeHtml(job.dateFoundRaw)}
          </span>
        ` : ''}
      </div>

      ${tags.length > 0 ? `
        <div class="card-tags">
          ${tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}
        </div>
      ` : ''}

      ${assessmentHtml}
      ${talkingPointsHtml}

      <div class="card-footer">
        <div style="display:flex; gap: var(--space-3); flex-wrap: wrap; align-items: center;">
          ${contactHtml}
          ${followUpHtml}
        </div>
        ${job.link ? `
          <a href="${escapeHtml(job.link)}" target="_blank" rel="noopener" class="apply-link">
            View Role
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        ` : ''}
      </div>

      ${actionsHtml}
    </article>
  `;
}

function renderCardActions(job, index) {
  // Find the real index in pipelineData
  const dataIndex = pipelineData.indexOf(job);

  if (!isSignedIn()) {
    return `
      <div class="signin-prompt">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span><span class="signin-prompt-link" data-action="signin">Sign in with Google</span> to update status and notes</span>
      </div>
    `;
  }

  const statuses = ['New', 'Researching', 'Applied', 'Phone Screen', 'Interviewing', 'Offer', 'Rejected', 'Passed'];
  const currentStatus = (job.status || '').toLowerCase();

  const pills = statuses.map(s => {
    const isActive = currentStatus === s.toLowerCase();
    return `<button class="status-pill ${isActive ? 'status-pill-active' : ''}" data-action="status" data-index="${dataIndex}" data-status="${s}">${s}<span class="pill-spinner"></span></button>`;
  }).join('');

  const isApplied = currentStatus.includes('applied');

  return `
    <div class="card-actions">
      <div class="status-pills">${pills}</div>
      <div class="quick-actions">
        ${!isApplied ? `<button class="btn-mark-applied" data-action="mark-applied" data-index="${dataIndex}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Mark Applied
        </button>` : ''}
      </div>
      <div class="notes-wrapper">
        <div class="notes-label">Notes</div>
        <textarea class="notes-textarea" data-action="notes" data-index="${dataIndex}" placeholder="Add notes...">${escapeHtml(job.notes || '')}</textarea>
      </div>
    </div>
  `;
}

function getStatusClass(status) {
  if (!status) return 'status-new';
  const s = status.toLowerCase();
  if (s.includes('new')) return 'status-new';
  if (s.includes('research')) return 'status-researching';
  if (s.includes('applied')) return 'status-applied';
  if (s.includes('phone')) return 'status-phone';
  if (s.includes('interview')) return 'status-interviewing';
  if (s.includes('offer')) return 'status-offer';
  if (s.includes('reject')) return 'status-rejected';
  if (s.includes('pass')) return 'status-passed';
  return 'status-new';
}

function attachCardListeners() {
  // Expand/collapse assessment
  document.querySelectorAll('.expand-btn[data-expand]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.expand;
      const text = document.querySelector(`[data-expandable="${id}"]`);
      if (text) {
        text.classList.toggle('expanded');
        btn.textContent = text.classList.contains('expanded') ? 'Show less' : 'Show more';
      }
    });
  });

  // Expand/collapse talking points
  document.querySelectorAll('.talking-points-header[data-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const id = header.dataset.toggle;
      const content = document.getElementById(id);
      if (content) {
        content.classList.toggle('show');
        const chevron = header.querySelector('.tp-chevron');
        if (chevron) {
          chevron.style.transform = content.classList.contains('show') ? 'rotate(180deg)' : '';
        }
      }
    });
  });

  // Status pill clicks
  document.querySelectorAll('[data-action="status"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('status-pill-active') || btn.classList.contains('loading')) return;

      const dataIndex = parseInt(btn.dataset.index, 10);
      const newStatus = btn.dataset.status;

      // Show loading
      btn.classList.add('loading');
      btn.disabled = true;

      await updateJobStatus(dataIndex, newStatus);

      // Loading state removed by re-render
    });
  });

  // Mark Applied clicks
  document.querySelectorAll('[data-action="mark-applied"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      const dataIndex = parseInt(btn.dataset.index, 10);
      btn.disabled = true;
      btn.textContent = 'Updating...';
      await markApplied(dataIndex);
    });
  });

  // Notes blur saves
  document.querySelectorAll('[data-action="notes"]').forEach(textarea => {
    let originalValue = textarea.value;

    textarea.addEventListener('focus', () => {
      originalValue = textarea.value;
    });

    textarea.addEventListener('blur', async () => {
      const newValue = textarea.value.trim();
      if (newValue === originalValue.trim()) return; // No change

      const dataIndex = parseInt(textarea.dataset.index, 10);
      textarea.classList.add('saving');
      await updateJobNotes(dataIndex, newValue);
      textarea.classList.remove('saving');
      originalValue = newValue;
    });
  });

  // Sign-in prompt clicks
  document.querySelectorAll('[data-action="signin"]').forEach(el => {
    el.addEventListener('click', signIn);
  });
}

// --- AI Brief ---
function renderBrief() {
  const container = document.getElementById('briefContent');
  const dateEl = document.getElementById('briefDate');

  if (aiBriefData.length === 0) return;

  const latest = aiBriefData[aiBriefData.length - 1];
  dateEl.textContent = latest.date || '';

  if (!latest.brief) return;

  container.innerHTML = `<div class="brief-rendered">${renderMarkdown(latest.brief)}</div>`;
}

function renderMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  let html = '';
  let inList = false;

  for (let line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${processInline(trimmed.slice(4))}</h3>`;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2>${processInline(trimmed.slice(3))}</h2>`;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h1>${processInline(trimmed.slice(2))}</h1>`;
      continue;
    }

    if (/^[•\-\*]\s/.test(trimmed)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${processInline(trimmed.replace(/^[•\-\*]\s*/, ''))}</li>`;
      continue;
    }

    if (trimmed === '') {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }

    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${processInline(trimmed)}</p>`;
  }

  if (inList) html += '</ul>';
  return html;
}

function processInline(text) {
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return text;
}

// --- Weekly Pulse ---
function renderPulse() {
  const container = document.getElementById('pulseContent');
  const chartWrap = document.getElementById('pulseChartWrap');

  if (weeklyPulseData.length === 0) return;

  const latest = weeklyPulseData[weeklyPulseData.length - 1];

  let html = `<div class="pulse-stats">`;
  if (latest.totalFound) {
    html += `<div class="pulse-stat"><div class="pulse-stat-value">${escapeHtml(String(latest.totalFound))}</div><div class="pulse-stat-label">Found</div></div>`;
  }
  if (latest.applied) {
    html += `<div class="pulse-stat"><div class="pulse-stat-value">${escapeHtml(String(latest.applied))}</div><div class="pulse-stat-label">Applied</div></div>`;
  }
  if (latest.responses) {
    html += `<div class="pulse-stat"><div class="pulse-stat-value">${escapeHtml(String(latest.responses))}</div><div class="pulse-stat-label">Responses</div></div>`;
  }
  if (latest.interviews) {
    html += `<div class="pulse-stat"><div class="pulse-stat-value">${escapeHtml(String(latest.interviews))}</div><div class="pulse-stat-label">Interviews</div></div>`;
  }
  html += `</div>`;

  if (latest.trends) {
    html += `<div class="pulse-note"><div class="pulse-note-label">Trends</div>${escapeHtml(latest.trends)}</div>`;
  }
  if (latest.strategyNote) {
    html += `<div class="pulse-note"><div class="pulse-note-label">Strategy</div>${escapeHtml(latest.strategyNote)}</div>`;
  }

  container.innerHTML = html;

  if (weeklyPulseData.length > 1) {
    chartWrap.style.display = 'block';
    renderPulseChart();
  }
}

function renderPulseChart() {
  const ctx = document.getElementById('pulseChart').getContext('2d');
  if (pulseChart) pulseChart.destroy();

  const labels = weeklyPulseData.map(w => w.weekOf || '');
  const found = weeklyPulseData.map(w => parseInt(w.totalFound) || 0);
  const applied = weeklyPulseData.map(w => parseInt(w.applied) || 0);

  pulseChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Found',
          data: found,
          backgroundColor: 'rgba(37, 99, 235, 0.15)',
          borderColor: 'rgba(37, 99, 235, 0.5)',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Applied',
          data: applied,
          backgroundColor: 'rgba(21, 128, 61, 0.15)',
          borderColor: 'rgba(21, 128, 61, 0.5)',
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#6b7280',
            font: { family: "'Inter', sans-serif", size: 11 },
            boxWidth: 12,
            padding: 12,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af', font: { family: "'Inter', sans-serif", size: 10 } },
        },
        y: {
          grid: { color: '#f3f4f6' },
          ticks: { color: '#9ca3af', font: { family: "'JetBrains Mono', monospace", size: 10 } },
          beginAtZero: true,
        },
      },
    },
  });
}

// ============================================
// UTILITY
// ============================================

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateLastRefresh() {
  const el = document.getElementById('lastRefresh');
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  el.textContent = `Updated ${time}`;
}

// ============================================
// INITIALIZATION
// ============================================

function init() {
  // Check config
  SHEET_ID = getSheetId();

  if (!SHEET_ID) {
    // Show setup screen
    document.getElementById('setupScreen').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
    return;
  }

  // Show dashboard
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';

  // Set dynamic title
  const cfg = getConfig();
  if (cfg && cfg.title) {
    document.getElementById('dashboardTitle').textContent = cfg.title;
    document.title = cfg.title + ' — Job Search Dashboard';
  }

  // Set sheet links
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  document.getElementById('sheetLink').href = sheetUrl;
  document.getElementById('footerSheetLink').href = sheetUrl;

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderPipeline();
    });
  });

  // Sort
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderPipeline();
  });

  // Search
  let searchTimeout;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentSearch = e.target.value.trim();
      renderPipeline();
    }, 200);
  });

  // Refresh
  document.getElementById('refreshBtn').addEventListener('click', () => {
    loadAllData();
  });

  // Init auth
  initAuth();

  // Initial load
  loadAllData();

  // Auto-refresh
  setInterval(loadAllData, REFRESH_INTERVAL);
}

document.addEventListener('DOMContentLoaded', init);
