/* ============================================
   COMMAND CENTER v2 — Discovery Drawer
   Extracted from app.js (discovery-drawer cut).

   Classic-global IIFE under window.JobBoredDiscovery.drawer — NOT an ES module.
   Loaded BEFORE app.js (after apps-script-deploy.js).
   Drawer state, fit-profile prefill, source readiness, company chips,
   AI suggestions, subtabs, event binding, and run button wiring.
   ============================================ */
(() => {
  const root = window.JobBoredDiscovery || (window.JobBoredDiscovery = {});
  const drawer = root.drawer || (root.drawer = {});

  function host() {
    return drawer.host || {};
  }

  function h(name, ...args) {
    const fn = host()[name];
    return typeof fn === "function" ? fn(...args) : undefined;
  }

function normalizeSourcePreset(raw) {
  const SOURCE_PRESET_VALUES = Object.freeze([
    "browser_only",
    "ats_only",
    "browser_plus_ats",
  ]);
  const v = raw == null ? "" : String(raw).trim();
  if (SOURCE_PRESET_VALUES.includes(v)) return v;
  return "";
}

/**
 * Sync the source preset radio-group UI in the discovery prefs modal to
 * reflect the given normalized preset value. Highlights the active option.
 * @param {"" | "browser_only" | "ats_only" | "browser_plus_ats"} preset
 */
function syncSourcePresetUi(preset) {
  const VALID_PRESETS = ["browser_only", "ats_only", "browser_plus_ats"];
  const resolved = VALID_PRESETS.includes(preset) ? preset : "browser_plus_ats";
  document.querySelectorAll('input[name="dpSourcePreset"]').forEach((el) => {
    const isActive = el.value === resolved;
    el.checked = isActive;
    const option = el.closest(".dp-source-preset-option");
    if (option) {
      option.classList.toggle("dp-source-preset-option--active", isActive);
    }
  });
}
const discoveryDrawerState = {
  allow: [],
  block: [],
  /** Cached AI strata results so re-applying doesn't re-call the LLM. */
  strata: null,
};

// ────────────────────────────────────────────────────────────────────────────
// Per-run profile-driven preferences. Cleared when the discovery drawer closes.
// Never persisted — edits here do NOT write back to the master Fit Profile.
// The master profile lives at ~/.jobbored/profile.json and is served by
// GET /profile. The drawer treats it as a read-only source for defaults.
// ────────────────────────────────────────────────────────────────────────────
let discoveryRunProfileState = {
  baseProfile: null,      // UserProfile from GET /profile, or null when none
  perRunOverrides: {},    // Only fields the user explicitly edited this session
  fetchedAt: null,
};

/**
 * Load the master Fit Profile from GET /profile. Returns the profile or null.
 * Resilient to the endpoint being unavailable (treats as "no profile" state).
 */
async function loadMasterFitProfile() {
  try {
    const resp = await fetch("/profile", { method: "GET" });
    if (resp && resp.ok) {
      const data = await resp.json().catch(() => null);
      if (data && data.ok && data.profile) {
        discoveryRunProfileState = {
          baseProfile: data.profile,
          perRunOverrides: {},
          fetchedAt: new Date().toISOString(),
        };
        return data.profile;
      }
    }
  } catch (e) {
    console.warn("loadMasterFitProfile failed:", e);
  }
  discoveryRunProfileState = {
    baseProfile: null,
    perRunOverrides: {},
    fetchedAt: new Date().toISOString(),
  };
  return null;
}

/**
 * Returns the effective Fit Profile fields for THIS run only — base values
 * shadowed by any per-run overrides the user made in the drawer. Returns null
 * when no master profile is loaded (legacy free-form mode).
 */
function getEffectiveFitProfileFields() {
  const base = discoveryRunProfileState.baseProfile;
  const ov = discoveryRunProfileState.perRunOverrides;
  if (!base) return null;
  const identity = base.identity || {};
  const hc = base.hardConstraints || {};
  return {
    targetRoles: ov.targetRoles ?? (identity.targetRoles || []),
    targetSeniority: ov.targetSeniority ?? identity.targetSeniority,
    workMode: ov.workMode ?? hc.workMode,
    acceptableLocations:
      ov.acceptableLocations ?? (hc.acceptableLocations || []),
    wants: ov.wants ?? (base.wants || []),
    avoids: ov.avoids ?? (base.avoids || []),
  };
}

/**
 * Record (or clear) a per-run override for a single Fit Profile field.
 * If `value` is the same as the original base value, the override is removed
 * so getEffectiveFitProfileFields() falls through to the base profile.
 */
function setRunOverride(field, value, originalValue) {
  const same =
    Array.isArray(value) && Array.isArray(originalValue)
      ? value.length === originalValue.length &&
        value.every((v, i) => v === originalValue[i])
      : value === originalValue;
  if (same || value === undefined) {
    delete discoveryRunProfileState.perRunOverrides[field];
  } else {
    discoveryRunProfileState.perRunOverrides[field] = value;
  }
  const badge = document.querySelector(
    `[data-run-override-badge="${field}"]`,
  );
  if (badge) {
    badge.classList.toggle(
      "is-modified",
      field in discoveryRunProfileState.perRunOverrides,
    );
  }
}

// Map UserProfile.hardConstraints.workMode → legacy remotePolicy string
function workModeToRemotePolicy(workMode) {
  switch (workMode) {
    case "remote_only":
      return "remote";
    case "hybrid_ok":
      return "hybrid";
    case "onsite_ok":
      return "onsite";
    case "any":
    default:
      return "";
  }
}

// Map legacy remotePolicy string → UserProfile workMode (reverse direction)
function remotePolicyToWorkMode(remotePolicy) {
  const v = String(remotePolicy || "").trim().toLowerCase();
  if (!v) return "any";
  if (/remote/.test(v)) return "remote_only";
  if (/hybrid/.test(v)) return "hybrid_ok";
  if (/on[-\s]?site/.test(v)) return "onsite_ok";
  return "any";
}

// Map TargetSeniority enum → human-readable string for legacy payload field
function targetSeniorityToHuman(seniority) {
  switch (seniority) {
    case "intern":
      return "Intern";
    case "entry":
      return "Entry";
    case "ic_mid":
      return "Mid";
    case "ic_senior":
      return "Senior";
    case "ic_staff":
      return "Staff";
    case "ic_principal":
      return "Principal";
    case "manager":
      return "Manager";
    case "director":
      return "Director";
    case "head":
      return "Head";
    case "vp":
      return "VP";
    case "c_level":
      return "C-level";
    case "any":
    default:
      return "";
  }
}

/**
 * Render the empty-state banner shown when no master Fit Profile exists.
 * Inserts (or removes) a banner inside the discovery drawer body.
 */
function renderFitProfileEmptyState(profile) {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const body = drawer.querySelector(".discovery-drawer__body");
  if (!body) return;
  let banner = body.querySelector(".fit-profile-empty-banner");
  if (profile) {
    if (banner) banner.remove();
    // Restore visibility of fit-profile-driven inputs
    body
      .querySelectorAll("[data-fit-profile-input]")
      .forEach((el) => (el.hidden = false));
    return;
  }
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "fit-profile-empty-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML =
      '<span class="fit-profile-empty-banner__text">Set up your Fit Profile so JobBored can score jobs accurately.</span>' +
      '<a class="fit-profile-empty-banner__cta" href="#/onboarding/fit-profile">Set up Fit Profile</a>';
    body.insertBefore(banner, body.firstChild);
  }
  // When no profile, hide the fields the profile would have populated
  body
    .querySelectorAll("[data-fit-profile-input]")
    .forEach((el) => (el.hidden = true));
}

/**
 * Pre-fill the existing drawer inputs from the master Fit Profile. Also
 * attaches "Reset to profile" affordances + modified-badge holders so the
 * user can see which fields they edited this run.
 */
function prefillDrawerFromFitProfile(profile) {
  if (!profile) return;
  const identity = profile.identity || {};
  const hc = profile.hardConstraints || {};

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
  };

  setText("dpTargetRoles", (identity.targetRoles || []).join(", "));
  setText("dpLocations", (hc.acceptableLocations || []).join(", "));
  setText("dpRemotePolicy", workModeToRemotePolicy(hc.workMode));
  setText("dpSeniority", targetSeniorityToHuman(identity.targetSeniority));

  attachRunOverrideAffordance("dpTargetRoles", "targetRoles", () =>
    (identity.targetRoles || []).join(", "),
  );
  attachRunOverrideAffordance("dpLocations", "acceptableLocations", () =>
    (hc.acceptableLocations || []).join(", "),
  );
  attachRunOverrideAffordance("dpRemotePolicy", "workMode", () =>
    workModeToRemotePolicy(hc.workMode),
  );
  attachRunOverrideAffordance("dpSeniority", "targetSeniority", () =>
    targetSeniorityToHuman(identity.targetSeniority),
  );

  // Wire change handlers that translate UI strings → UserProfile shapes.
  bindOverrideChange("dpTargetRoles", (val) => {
    const arr = String(val || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setRunOverride("targetRoles", arr, identity.targetRoles || []);
  });
  bindOverrideChange("dpLocations", (val) => {
    const arr = String(val || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setRunOverride(
      "acceptableLocations",
      arr,
      hc.acceptableLocations || [],
    );
  });
  bindOverrideChange("dpRemotePolicy", (val) => {
    const mode = remotePolicyToWorkMode(val);
    setRunOverride("workMode", mode, hc.workMode);
  });
  bindOverrideChange("dpSeniority", (val) => {
    // Free-text seniority — only treat exact case-insensitive matches as
    // recognized enum overrides; otherwise leave the base value untouched.
    const human = String(val || "").trim().toLowerCase();
    const baseHuman = (targetSeniorityToHuman(identity.targetSeniority) || "")
      .toLowerCase();
    if (!human || human === baseHuman) {
      setRunOverride("targetSeniority", undefined, identity.targetSeniority);
      return;
    }
    setRunOverride("targetSeniority", val, identity.targetSeniority);
  });
}

/**
 * Inserts a tiny "↻ Reset to profile" link + modified badge after the input
 * with id `inputId`. Idempotent — replaces any prior affordance.
 */
function attachRunOverrideAffordance(inputId, field, getBaseValue) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.setAttribute("data-fit-profile-input", field);

  // Remove any prior affordance row so re-opening the drawer doesn't stack.
  const prior = input.parentElement
    ? input.parentElement.querySelector(
        `[data-run-override-row="${field}"]`,
      )
    : null;
  if (prior) prior.remove();

  const row = document.createElement("div");
  row.className = "fit-profile-run-override-row";
  row.setAttribute("data-run-override-row", field);

  const badge = document.createElement("span");
  badge.className = "fit-profile-run-override-badge";
  badge.setAttribute("data-run-override-badge", field);
  badge.textContent = "modified for this run";
  row.appendChild(badge);

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "fit-profile-run-override-reset";
  reset.textContent = "↻ Reset to profile";
  reset.addEventListener("click", () => {
    const baseValue = getBaseValue();
    input.value = baseValue;
    setRunOverride(field, undefined, baseValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  row.appendChild(reset);

  input.insertAdjacentElement("afterend", row);
}

/**
 * Bind an input/change handler that pipes the input's current value into
 * `handler`. Removes any prior handler we installed (tracked via dataset).
 */
function bindOverrideChange(inputId, handler) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.__fpOverrideHandler) {
    input.removeEventListener("input", input.__fpOverrideHandler);
  }
  const fn = () => handler(input.value);
  input.__fpOverrideHandler = fn;
  input.addEventListener("input", fn);
}

/**
 * Render the collapsible "Tuning from your Fit Profile" section that exposes
 * wants/avoids editing for this run only. Idempotent.
 */
function renderTuningFromProfile(profile) {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const body = drawer.querySelector(".discovery-drawer__body");
  if (!body) return;

  let section = body.querySelector(".fit-profile-tuning-section");
  if (!profile) {
    if (section) section.remove();
    return;
  }
  if (!section) {
    section = document.createElement("details");
    section.className = "fit-profile-tuning-section";
    section.setAttribute("data-fit-profile-input", "tuning");
    section.innerHTML = `
      <summary>Tuning from your Fit Profile</summary>
      <p class="fit-profile-tuning-section__lede">
        Edits here apply to this run only. Your master Fit Profile is unchanged.
      </p>
      <label class="field-label" for="dpRunWants">Wants (one per line)</label>
      <textarea id="dpRunWants" class="modal-input modal-textarea" rows="4"></textarea>
      <div class="fit-profile-run-override-row" data-run-override-row="wants">
        <span class="fit-profile-run-override-badge" data-run-override-badge="wants">modified for this run</span>
        <button type="button" class="fit-profile-run-override-reset" data-reset="wants">↻ Reset to profile</button>
      </div>
      <label class="field-label" for="dpRunAvoids">Avoids (one per line)</label>
      <textarea id="dpRunAvoids" class="modal-input modal-textarea" rows="4"></textarea>
      <div class="fit-profile-run-override-row" data-run-override-row="avoids">
        <span class="fit-profile-run-override-badge" data-run-override-badge="avoids">modified for this run</span>
        <button type="button" class="fit-profile-run-override-reset" data-reset="avoids">↻ Reset to profile</button>
      </div>
    `;
    body.appendChild(section);
  }

  const baseWants = Array.isArray(profile.wants) ? profile.wants : [];
  const baseAvoids = Array.isArray(profile.avoids) ? profile.avoids : [];

  const wantsEl = section.querySelector("#dpRunWants");
  const avoidsEl = section.querySelector("#dpRunAvoids");
  if (wantsEl) wantsEl.value = baseWants.join("\n");
  if (avoidsEl) avoidsEl.value = baseAvoids.join("\n");

  const linesOf = (v) =>
    String(v || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  if (wantsEl) {
    bindOverrideChange("dpRunWants", (val) =>
      setRunOverride("wants", linesOf(val), baseWants),
    );
  }
  if (avoidsEl) {
    bindOverrideChange("dpRunAvoids", (val) =>
      setRunOverride("avoids", linesOf(val), baseAvoids),
    );
  }

  section
    .querySelectorAll(".fit-profile-run-override-reset")
    .forEach((btn) => {
      const field = btn.getAttribute("data-reset");
      btn.onclick = () => {
        if (field === "wants" && wantsEl) {
          wantsEl.value = baseWants.join("\n");
          setRunOverride("wants", undefined, baseWants);
        } else if (field === "avoids" && avoidsEl) {
          avoidsEl.value = baseAvoids.join("\n");
          setRunOverride("avoids", undefined, baseAvoids);
        }
      };
    });
}

function discoveryDrawerEl() {
  return document.getElementById("discoveryDrawer");
}

function isDiscoveryDrawerOpen() {
  const d = discoveryDrawerEl();
  return !!d && d.style.display === "flex";
}

function sanitizeCompanyEntries(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= 50) break;
  }
  return out;
}

function renderCompanyChips(listKind) {
  const containerId =
    listKind === "block" ? "dpCompanyBlocklistChips" : "dpCompanyAllowlistChips";
  const emptyId =
    listKind === "block" ? "dpCompanyBlocklistEmpty" : "dpCompanyAllowlistEmpty";
  const container = document.getElementById(containerId);
  const empty = document.getElementById(emptyId);
  if (!container) return;
  const items = discoveryDrawerState[listKind] || [];
  // Remove all chips except the empty placeholder
  Array.from(container.querySelectorAll(".dp-chip")).forEach((el) =>
    el.remove(),
  );
  if (items.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  for (const name of items) {
    const chip = document.createElement("span");
    chip.className = "dp-chip";
    chip.dataset.list = listKind;
    const label = document.createElement("span");
    label.className = "dp-chip__label";
    label.textContent = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "dp-chip__remove";
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.dataset.action = "remove-chip";
    remove.dataset.list = listKind;
    remove.dataset.value = name;
    remove.textContent = "×";
    chip.appendChild(label);
    chip.appendChild(remove);
    container.appendChild(chip);
  }
}

function addCompanyChip(listKind, value) {
  const t = String(value || "").trim();
  if (!t) return;
  const list = discoveryDrawerState[listKind];
  if (!Array.isArray(list)) return;
  const key = t.toLowerCase();
  if (list.some((x) => x.toLowerCase() === key)) return;
  list.push(t);
  if (list.length > 50) list.length = 50;
  renderCompanyChips(listKind);
}

function removeCompanyChip(listKind, value) {
  const t = String(value || "").trim().toLowerCase();
  const list = discoveryDrawerState[listKind];
  if (!Array.isArray(list)) return;
  const idx = list.findIndex((x) => x.toLowerCase() === t);
  if (idx >= 0) list.splice(idx, 1);
  renderCompanyChips(listKind);
}

function setDiscoveryReadinessChip(state, label) {
  const chip = document.getElementById("discoveryDrawerReadiness");
  if (!chip) return;
  chip.dataset.state = state || "unknown";
  chip.textContent = label || "";
}

function refreshDiscoveryDrawerStatusChip() {
  try {
    const snap = h("getDiscoveryReadinessSnapshot", );
    const view = h("getDiscoverySettingsView", snap);
    const hasWebhook = !!h("getDiscoveryWebhookUrl", );
    if (view && view.runDiscoveryEnabled && hasWebhook) {
      setDiscoveryReadinessChip("ready", "Discovery ready");
    } else if (hasWebhook) {
      setDiscoveryReadinessChip("partial", "Setup partially configured");
    } else {
      setDiscoveryReadinessChip("unconfigured", "Discovery not configured");
    }
  } catch (_) {
    setDiscoveryReadinessChip("unknown", "Checking setup…");
  }
}

function getLocalDiscoveryWorkerHealthUrlForSources() {
  if (!h("isLocalDashboardOrigin", )) return "";
  const snap = h("getDiscoveryReadinessSnapshot", );
  const transport = h("getDiscoveryTransportSetupState", );
  const savedWebhookUrl = h("getDiscoveryWebhookUrl", );
  const localWebhookUrl =
    transport.localWebhookUrl ||
    (snap && snap.localWebhookUrl) ||
    (h("isLocalWebhookCandidateUrl", savedWebhookUrl) ? savedWebhookUrl : "");
  return h("getDiscoveryLocalWebhookHealthUrl", localWebhookUrl);
}

async function fetchLocalDiscoveryWorkerSourceReadiness() {
  // Source readiness reflects THIS machine's local worker. When the configured
  // run target is a remote endpoint (e.g. a Tailscale *.ts.net worker), the
  // local worker's grounded-web / SerpApi readiness is irrelevant to the run —
  // probing it produces a false "missing Gemini API key" warning even though
  // the remote worker that runs the job has the key. Skip it for remote targets.
  const runTarget = h("getDiscoveryWebhookUrl") || "";
  if (runTarget) {
    let remoteHost = false;
    try {
      const host = new URL(runTarget).hostname;
      remoteHost = !(
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "[::1]" ||
        host === "::1"
      );
    } catch (_) {}
    if (remoteHost) return null;
  }
  if (h("isLocalDashboardOrigin", )) {
    await h("hydrateDiscoveryTransportSetupFromLocalBootstrap", );
  }
  const healthUrl = getLocalDiscoveryWorkerHealthUrlForSources();
  if (!healthUrl) return null;
  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    return payload && payload.readiness && typeof payload.readiness === "object"
      ? payload.readiness
      : null;
  } catch (_) {
    return null;
  }
}

function getDiscoverySourceReadinessIssues(readiness) {
  if (!readiness || typeof readiness !== "object") return [];
  const issues = [];
  const groundedWeb = readiness.groundedWeb;
  if (
    groundedWeb &&
    groundedWeb.enabled &&
    groundedWeb.ready === false
  ) {
    issues.push("Gemini API key");
  }
  const serpApi = readiness.serpApiGoogleJobs;
  if (
    serpApi &&
    serpApi.enabled &&
    (serpApi.configured === false || serpApi.ready === false)
  ) {
    issues.push("SerpApi key");
  }
  return issues;
}

function renderDiscoveryDrawerSourceReadiness(issues) {
  const notice = document.getElementById("discoveryDrawerLastRun");
  if (!notice) return;
  if (!issues.length) {
    notice.hidden = true;
    notice.textContent = "";
    return;
  }
  setDiscoveryReadinessChip("partial", "Source config missing");
  notice.hidden = false;
  notice.textContent = `Missing source config: ${issues.join(", ")}. Discovery can still run with fewer sources.`;
}

async function refreshDiscoveryDrawerSourceReadiness() {
  const readiness = await fetchLocalDiscoveryWorkerSourceReadiness();
  if (!readiness) return [];
  const issues = getDiscoverySourceReadinessIssues(readiness);
  renderDiscoveryDrawerSourceReadiness(issues);
  return issues;
}

async function warnDiscoverySourceReadinessBeforeRun() {
  const readiness = await fetchLocalDiscoveryWorkerSourceReadiness();
  if (!readiness) return [];
  const issues = getDiscoverySourceReadinessIssues(readiness);
  if (issues.length) {
    h("showToast",
      `Discovery is missing ${issues.join(", ")}. This run will continue with fewer sources.`,
      "warning",
      true,
    );
  }
  return issues;
}

function openDiscoveryDrawer() {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const UC = window.CommandCenterUserContent;
  const fieldMap = {
    targetRoles: "dpTargetRoles",
    locations: "dpLocations",
    remotePolicy: "dpRemotePolicy",
    seniority: "dpSeniority",
    keywordsInclude: "dpKeywordsInclude",
    keywordsExclude: "dpKeywordsExclude",
    maxLeadsPerRun: "dpMaxLeads",
  };
  const prefilled =
    UC && typeof UC.getDiscoveryProfile === "function"
      ? Promise.resolve(UC.getDiscoveryProfile()).catch((err) => {
          console.warn("[JobBored] discovery profile preload:", err);
          return {};
        })
      : Promise.resolve({});
  prefilled.then(async (p) => {
    Object.entries(fieldMap).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.value = (p && p[key]) || "";
    });
    const gwEl = document.getElementById("dpGroundedWeb");
    if (gwEl) gwEl.checked = !p || p.groundedWebEnabled !== false;
    const preset = normalizeSourcePreset(
      p && p.sourcePreset ? p.sourcePreset : "",
    );
    syncSourcePresetUi(preset || "browser_plus_ats");
    discoveryDrawerState.allow = sanitizeCompanyEntries(
      p && Array.isArray(p.companyAllowlist) ? p.companyAllowlist : [],
    );
    discoveryDrawerState.block = sanitizeCompanyEntries(
      p && Array.isArray(p.companyBlocklist) ? p.companyBlocklist : [],
    );
    renderCompanyChips("allow");
    renderCompanyChips("block");
    refreshDiscoveryDrawerStatusChip();
    void refreshDiscoveryDrawerSourceReadiness();
    drawer.hidden = false;
    drawer.style.display = "flex";
    document.body.classList.add("detail-open");

    // Load the master Fit Profile and overlay it on the drawer. When present,
    // its fields become the source of truth and the legacy IndexedDB values
    // above are visually overwritten. When absent, an empty-state banner is
    // shown so the user can complete onboarding.
    try {
      const masterProfile = await loadMasterFitProfile();
      renderFitProfileEmptyState(masterProfile);
      if (masterProfile) {
        prefillDrawerFromFitProfile(masterProfile);
        renderTuningFromProfile(masterProfile);
      } else {
        renderTuningFromProfile(null);
      }
    } catch (e) {
      console.warn("[JobBored] Fit Profile overlay failed:", e);
    }
    // Surface AI provider availability when opening the drawer.
    checkDiscoveryAiAvailability();
    const first = document.getElementById("dpTargetRoles");
    if (first) first.focus();
    // First-run coach: auto-fires once per browser, gated by localStorage.
    try {
      const coach = window.JobBoredDiscoveryCoach;
      if (coach && typeof coach.start === "function") {
        coach.start({ force: false });
      }
    } catch (err) {
      console.warn("[JobBored] discovery coach start:", err);
    }
  });
}

function closeDiscoveryDrawer() {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  drawer.style.display = "none";
  drawer.hidden = true;
  document.body.classList.remove("detail-open");
  // Per-run profile state dies with the drawer. This is the no-write-back
  // rule — anything the user edited this run does NOT persist.
  discoveryRunProfileState = {
    baseProfile: null,
    perRunOverrides: {},
    fetchedAt: null,
  };
}

function checkDiscoveryAiAvailability() {
  const hint = document.getElementById("dpAiHint");
  const suggestBtn = document.getElementById("dpSuggestBtn");
  const Insights = window.CommandCenterJobPostingInsights;
  const canUse =
    Insights && Insights.canEnrichWithLLM && Insights.canEnrichWithLLM();
  if (hint) hint.hidden = !!canUse;
  if (suggestBtn) suggestBtn.disabled = !canUse;
}

/**
 * Generate Safe / Adjacent / Stretch search variants from the candidate profile.
 * Returns { safe, adjacent, stretch } where each entry is a search-intent
 * shape: { targetRoles, locations, remotePolicy, seniority, keywordsInclude,
 *   keywordsExclude, sourcePreset, companyAllowlist, rationale }.
 *
 * scrapedJob is optional context only — it does not gate generation.
 */
async function generateDiscoverySuggestions(scrapedJob) {
  const RG = window.CommandCenterResumeGenerate;
  if (!RG || typeof RG.getResumeGenerationConfig !== "function") {
    throw new Error("Resume generation module not loaded.");
  }
  const g = RG.getResumeGenerationConfig();
  // callConfiguredAi reads the configured provider itself; we no longer pin
  // the suggestion path to a single BYO transport or throw opaque errors for
  // openrouter/local — the router returns actionable messages for webhook /
  // missing-key cases and routes openrouter/local natively.

  const UC = h("getUserContent", );
  if (!UC) throw new Error("User content store not available.");
  await UC.openDb();

  const profileExcerpt = await h("buildCandidateProfileExcerpt", UC, 12000);
  const discoveryProfile = UC.getDiscoveryProfile
    ? await UC.getDiscoveryProfile()
    : {};

  const jobContext = scrapedJob
    ? [
        "JOB LISTING (scraped):",
        `Title: ${scrapedJob.title || ""}`,
        `Company: ${scrapedJob.company || ""}`,
        `Location: ${scrapedJob.location || ""}`,
        `Description: ${String(scrapedJob.description || "").slice(0, 4000)}`,
        scrapedJob.requirements && scrapedJob.requirements.length
          ? `Requirements: ${scrapedJob.requirements.slice(0, 20).join("; ")}`
          : "",
        scrapedJob.skills && scrapedJob.skills.length
          ? `Skills: ${scrapedJob.skills.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const existingFilters = [
    discoveryProfile.targetRoles
      ? `Current target roles: ${discoveryProfile.targetRoles}`
      : "",
    discoveryProfile.locations
      ? `Current locations: ${discoveryProfile.locations}`
      : "",
    discoveryProfile.remotePolicy
      ? `Current remote policy: ${discoveryProfile.remotePolicy}`
      : "",
    discoveryProfile.seniority
      ? `Current seniority: ${discoveryProfile.seniority}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt =
    "You are an expert career advisor. Generate THREE distinct discovery search variants " +
    "(safe, adjacent, stretch) from the candidate's profile and optional job context. " +
    "Return ONLY valid JSON of shape: " +
    "{ \"safe\": Variant, \"adjacent\": Variant, \"stretch\": Variant } where Variant is " +
    "{ targetRoles: string (comma-separated role titles), " +
    "locations: string (comma-separated cities/regions), " +
    "remotePolicy: string, seniority: string, " +
    "keywordsInclude: string (comma-separated), keywordsExclude: string (comma-separated), " +
    "sourcePreset: one of 'browser_only' | 'ats_only' | 'browser_plus_ats', " +
    "companyAllowlist: string[] (5-15 real, currently-hiring companies that match this stratum; never invent), " +
    "rationale: string (1-2 sentences) }. " +
    "Definitions: safe = closest to the candidate's current target. adjacent = nearby role families " +
    "and industries. stretch = ambitious or non-obvious paths the candidate could realistically reach. " +
    "Always populate companyAllowlist with at least 5 plausible companies per stratum.";

  const userParts = [
    "CANDIDATE PROFILE:",
    profileExcerpt || "(No resume or profile data available)",
    "",
  ];
  if (existingFilters) {
    userParts.push("EXISTING DISCOVERY FILTERS:", existingFilters, "");
  }
  if (jobContext) {
    userParts.push(jobContext, "");
  }
  userParts.push(
    "Generate three distinct search variants (safe, adjacent, stretch) for this candidate.",
    "Return JSON only.",
  );

  const userPrompt = userParts.join("\n");

  // Route through the provider-agnostic router so openrouter / local work
  // without a Gemini key. The router surfaces "Add your <provider> key in
  // Settings" for missing keys and "doesn't support inline suggestions" for
  // webhook — both actionable, neither an opaque throw.
  const text = await h("callConfiguredAi", systemPrompt, userPrompt, {
    json: true,
  });

  const parsed = h("parseJsonSafeForSuggestions", text);
  return {
    safe: normalizeStratum(parsed && parsed.safe),
    adjacent: normalizeStratum(parsed && parsed.adjacent),
    stretch: normalizeStratum(parsed && parsed.stretch),
  };
}

/**
 * Coerce a raw stratum payload from the LLM into a safe shape that the
 * drawer can consume without throwing on missing/wrong-typed fields.
 */
function normalizeStratum(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const str = (k) => (typeof o[k] === "string" ? o[k].trim() : "");
  const allowedPresets = new Set([
    "browser_only",
    "ats_only",
    "browser_plus_ats",
  ]);
  const presetRaw = typeof o.sourcePreset === "string" ? o.sourcePreset.trim() : "";
  const sourcePreset = allowedPresets.has(presetRaw) ? presetRaw : "";
  return {
    targetRoles: str("targetRoles"),
    locations: str("locations"),
    remotePolicy: str("remotePolicy"),
    seniority: str("seniority"),
    keywordsInclude: str("keywordsInclude"),
    keywordsExclude: str("keywordsExclude"),
    sourcePreset,
    companyAllowlist: sanitizeCompanyEntries(
      Array.isArray(o.companyAllowlist) ? o.companyAllowlist : [],
    ),
    rationale: str("rationale"),
  };
}

function parseJsonSafeForSuggestions(raw) {
  const s = String(raw || "").trim();
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenceMatch ? fenceMatch[1].trim() : s;
  try {
    return JSON.parse(body);
  } catch (_) {
    const braceStart = body.indexOf("{");
    const braceEnd = body.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      try {
        return JSON.parse(body.slice(braceStart, braceEnd + 1));
      } catch (__) {}
    }
    return {};
  }
}

/**
 * Single source of truth for which Gemini model the app uses.
 *
 * Resolution order (high → low):
 *   1. Explicit caller arg (when a feature wants to pin a model — rare)
 *   2. localStorage override (Settings → Resume → Gemini model field)
 *   3. config.js → window.COMMAND_CENTER_CONFIG.resumeGeminiModel
 *   4. Hardcoded fallback (only hit if both config files are missing)
 *
 * If a Gemini model gets retired, this is the ONLY place to update the
 * default. Every Gemini call site must route through here — do not embed
 * model name strings or "gemini-…" fallbacks elsewhere in app.js.
 */
function resolveGeminiModel(explicit) {
  if (explicit && typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  try {
    const overrides =
      typeof readStoredConfigOverrides === "function"
        ? readStoredConfigOverrides()
        : {};
    if (overrides && typeof overrides.resumeGeminiModel === "string" && overrides.resumeGeminiModel.trim()) {
      return overrides.resumeGeminiModel.trim();
    }
  } catch (_) {
    /* localStorage may be unavailable in private/embedded contexts. */
  }
  const cfg = (typeof window !== "undefined" && window.COMMAND_CENTER_CONFIG) || {};
  if (typeof cfg.resumeGeminiModel === "string" && cfg.resumeGeminiModel.trim()) {
    return cfg.resumeGeminiModel.trim();
  }
  return "gemini-3.5-flash";
}

async function callDiscoveryAiGemini(system, user, apiKey, model, opts) {
  const resolvedModel = resolveGeminiModel(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  // Detect 2.5+ family — those models burn "thinking tokens" against the
  // output budget, so a 2048-cap on a long-system-prompt JSON response can
  // silently produce zero visible characters with finishReason=MAX_TOKENS.
  // Also pin response MIME to JSON whenever the caller marks the request
  // as JSON-only — this dramatically improves reliability vs. free-form
  // prose responses that have to be regex-extracted later.
  const wantJson = !!(opts && opts.json);
  const isThinkingModel = /^gemini-(2\.[5-9]|3(\.\d+)?)/.test(resolvedModel);
  const generationConfig = {
    maxOutputTokens: isThinkingModel ? 8192 : 2048,
    temperature: 0.5,
  };
  if (wantJson) generationConfig.responseMimeType = "application/json";
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig,
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error?.message || `Gemini HTTP ${resp.status}`);
  }
  const candidate = data.candidates?.[0];
  const text =
    candidate?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text.trim()) {
    // Surface the real reason instead of a generic "Empty response".
    // Common cases: MAX_TOKENS (thinking eats the budget), SAFETY,
    // RECITATION, or upstream finish reasons that need the user to retry
    // with different input rather than silently fail.
    const reason = candidate?.finishReason || data.promptFeedback?.blockReason;
    if (reason === "MAX_TOKENS") {
      throw new Error(
        "Gemini hit the output token cap before producing visible text. Try Show me more, or shorten your resume.",
      );
    }
    if (reason === "SAFETY" || reason === "RECITATION") {
      throw new Error(
        `Gemini blocked the response (${reason}). Try Show me more, or remove sensitive content from your resume.`,
      );
    }
    if (reason) throw new Error(`Gemini returned no text (${reason}).`);
    throw new Error("Empty response from Gemini");
  }
  return text.trim();
}

async function callDiscoveryAiOpenAI(system, user, apiKey, model) {
  const m = model || "gpt-4o-mini";
  const limitKey = m.toLowerCase().startsWith("gpt-5")
    ? "max_completion_tokens"
    : "max_tokens";
  const body = {
    model: m,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    [limitKey]: 2048,
  };
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw new Error(data.error?.message || `OpenAI HTTP ${resp.status}`);
  const text = data.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new Error("Empty response from OpenAI");
  return text.trim();
}

async function callDiscoveryAiAnthropic(system, user, apiKey, model) {
  const body = {
    model: model || "claude-sonnet-4-6",
    max_tokens: 2048,
    system,
    messages: [{ role: "user", content: user }],
  };
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok)
    throw new Error(data.error?.message || `Anthropic HTTP ${resp.status}`);
  const text = Array.isArray(data.content)
    ? data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text || "")
        .join("")
    : "";
  if (!text.trim()) throw new Error("Empty response from Anthropic");
  return text.trim();
}

/**
 * Shared OpenAI-compatible chat/completions call (OpenRouter, local Ollama, and
 * any other /v1/chat/completions endpoint). Authorization is sent only when a
 * key is provided (Ollama ignores it). opts.json bumps the output cap so a
 * longer JSON response isn't truncated.
 */
async function callDiscoveryAiOpenAICompatible(endpoint, system, user, apiKey, model, opts) {
  const wantJson = !!(opts && opts.json);
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    max_tokens: wantJson ? 4096 : 2048,
  };
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      "Couldn't reach the AI provider. Check your connection (or that your local model server is running).",
    );
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error?.message || `AI provider HTTP ${resp.status}`);
  }
  const text = data.choices?.[0]?.message?.content || "";
  if (!text.trim()) throw new Error("Empty response from the AI provider");
  return text.trim();
}

async function callDiscoveryAiOpenRouter(system, user, apiKey, model, baseUrl, opts) {
  const base = String(baseUrl || "https://openrouter.ai/api/v1").replace(
    /\/+$/,
    "",
  );
  return callDiscoveryAiOpenAICompatible(
    `${base}/chat/completions`,
    system,
    user,
    apiKey,
    model || "openai/gpt-oss-120b:free",
    opts,
  );
}

async function callDiscoveryAiLocal(system, user, apiKey, model, baseUrl, opts) {
  const base = String(baseUrl || "http://127.0.0.1:11434/v1").replace(
    /\/+$/,
    "",
  );
  return callDiscoveryAiOpenAICompatible(
    `${base}/chat/completions`,
    system,
    user,
    apiKey || "",
    model || "gemma4:e2b",
    opts,
  );
}

/**
 * Provider-agnostic completion: routes a system+user prompt to whichever AI
 * provider the user configured in the first-run wizard / Settings, using that
 * provider's key + model. Returns raw text (callers parse JSON themselves).
 *
 * This is what lets onboarding role suggestions / "edges" and discovery strata
 * work with OpenRouter (the cold-start default), local Ollama, Gemini, OpenAI,
 * or Anthropic without each feature hardcoding Gemini. The key is guaranteed by
 * the first-run wizard's Provider step, so a missing key here is an edge case
 * that points the user back to Settings rather than a per-feature key gate.
 */
async function callConfiguredAi(system, user, opts) {
  const gen = window.CommandCenterResumeGenerate;
  const g =
    gen && typeof gen.getResumeGenerationConfig === "function"
      ? gen.getResumeGenerationConfig()
      : {};
  const provider = g.provider || "gemini";
  const needKey = (label) => {
    throw new Error(`Add your ${label} key in Settings to use AI suggestions.`);
  };
  switch (provider) {
    case "openrouter":
      if (!g.resumeOpenRouterApiKey) needKey("OpenRouter");
      return callDiscoveryAiOpenRouter(
        system,
        user,
        g.resumeOpenRouterApiKey,
        g.resumeOpenRouterModel,
        g.resumeOpenRouterBaseUrl,
        opts,
      );
    case "local":
      // Local servers (Ollama) usually need no key — base URL + model suffice.
      return callDiscoveryAiLocal(
        system,
        user,
        g.resumeLocalApiKey,
        g.resumeLocalModel,
        g.resumeLocalBaseUrl,
        opts,
      );
    case "openai":
      if (!g.resumeOpenAIApiKey) needKey("OpenAI");
      return callDiscoveryAiOpenAI(
        system,
        user,
        g.resumeOpenAIApiKey,
        g.resumeOpenAIModel,
      );
    case "anthropic":
      if (!g.resumeAnthropicApiKey) needKey("Anthropic");
      return callDiscoveryAiAnthropic(
        system,
        user,
        g.resumeAnthropicApiKey,
        g.resumeAnthropicModel,
      );
    case "webhook":
      throw new Error(
        "Your AI provider is set to a custom webhook, which doesn't support inline suggestions. Switch to OpenRouter, Gemini, OpenAI, Anthropic, or local in Settings.",
      );
    case "gemini":
    default:
      if (!g.resumeGeminiApiKey) needKey("Gemini");
      return callDiscoveryAiGemini(
        system,
        user,
        g.resumeGeminiApiKey,
        g.resumeGeminiModel,
        opts,
      );
  }
}

/**
 * Discovery drawer sub-tab controller. Mirrors the WAI-ARIA tabs pattern
 * used by settings-tabs.js but scoped to the drawer (Search · Sources ·
 * Automation · Connection · History).
 *
 * Exposed on window.JobBoredDiscoveryDrawerSubtabs so adapter code
 * (settings-discovery-adapters.js) can deep-link into a sub-tab when
 * opening the drawer in response to a Settings-era flow (e.g. Cloudflare
 * relay return, Apps Script remediation, webhook focus).
 */
const DISCOVERY_SUBTAB_ORDER = [
  "search",
  "sources",
  "automation",
  "connection",
  "history",
];
let activeDiscoverySubtab = "search";

function setDiscoveryDrawerSubtab(subtab, opts) {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const id = String(subtab || "search");
  if (DISCOVERY_SUBTAB_ORDER.indexOf(id) === -1) return;
  DISCOVERY_SUBTAB_ORDER.forEach((tid) => {
    const btn = drawer.querySelector(`#dd-tab-${tid}`);
    const panel = drawer.querySelector(`#dd-panel-${tid}`);
    if (btn) {
      btn.setAttribute("aria-selected", tid === id ? "true" : "false");
      btn.setAttribute("tabindex", tid === id ? "0" : "-1");
    }
    if (panel) panel.hidden = tid !== id;
  });
  activeDiscoverySubtab = id;
  const silent = opts && opts.silent;
  if (!silent) {
    const activeBtn = drawer.querySelector(`#dd-tab-${id}`);
    if (activeBtn) activeBtn.focus();
  }
}

function initDiscoverySubtabs() {
  const drawer = discoveryDrawerEl();
  if (!drawer) return;
  const tablist = drawer.querySelector("#discoverySubtabs");
  if (!tablist) return;
  if (tablist.dataset.subtabBound === "true") return;
  tablist.dataset.subtabBound = "true";
  const buttons = tablist.querySelectorAll('[role="tab"]');
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-subtab");
      if (id) setDiscoveryDrawerSubtab(id);
    });
    btn.addEventListener("keydown", (e) => {
      const idx = DISCOVERY_SUBTAB_ORDER.indexOf(activeDiscoverySubtab);
      if (idx === -1) return;
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % DISCOVERY_SUBTAB_ORDER.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next =
          (idx - 1 + DISCOVERY_SUBTAB_ORDER.length) %
          DISCOVERY_SUBTAB_ORDER.length;
      } else if (e.key === "Home") {
        next = 0;
      } else if (e.key === "End") {
        next = DISCOVERY_SUBTAB_ORDER.length - 1;
      }
      if (next >= 0) {
        e.preventDefault();
        setDiscoveryDrawerSubtab(DISCOVERY_SUBTAB_ORDER[next]);
      }
    });
  });
  // Open the runs log and setup doctor from the History sub-tab.
  const openRunsBtn = drawer.querySelector("#discoveryDrawerOpenRunsBtn");
  if (openRunsBtn && openRunsBtn.dataset.bound !== "true") {
    openRunsBtn.dataset.bound = "true";
    openRunsBtn.addEventListener("click", () => {
      closeDiscoveryDrawer();
      const runsBtn = document.getElementById("runsBtn");
      if (runsBtn) runsBtn.click();
    });
  }
  const openDoctorBtn = drawer.querySelector("#discoveryDrawerOpenDoctorBtn");
  if (openDoctorBtn && openDoctorBtn.dataset.bound !== "true") {
    openDoctorBtn.dataset.bound = "true";
    openDoctorBtn.addEventListener("click", () => {
      closeDiscoveryDrawer();
      const doctorBtn = document.getElementById("setupDoctorBtn");
      if (doctorBtn) doctorBtn.click();
    });
  }
  setDiscoveryDrawerSubtab("search", { silent: true });
}

function initDiscoveryDrawer() {
  const drawer = discoveryDrawerEl();
  const runBtn = document.getElementById("discoveryPrefsRun");
  if (!drawer) return;

  // Close on backdrop, close button, cancel button, or any data-action="close-discovery-drawer"
  drawer.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.dataset && target.dataset.action === "close-discovery-drawer") {
      closeDiscoveryDrawer();
      return;
    }
    const close = target.closest('[data-action="close-discovery-drawer"]');
    if (close) closeDiscoveryDrawer();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isDiscoveryDrawerOpen()) closeDiscoveryDrawer();
  });

  /* ---- First-run coach: "?" button restarts the walkthrough ---- */
  const coachBtn = document.getElementById("discoveryDrawerCoachBtn");
  if (coachBtn && coachBtn.dataset.bound !== "true") {
    coachBtn.dataset.bound = "true";
    coachBtn.addEventListener("click", () => {
      try {
        const coach = window.JobBoredDiscoveryCoach;
        if (coach && typeof coach.start === "function") {
          coach.start({ force: true });
        }
      } catch (err) {
        console.warn("[JobBored] discovery coach restart:", err);
      }
    });
  }

  /* ---- Source preset mutual-exclusivity ---- */
  document
    .querySelectorAll('input[name="dpSourcePreset"]')
    .forEach((el) => {
      el.addEventListener("change", () => {
        const checked = document.querySelector(
          'input[name="dpSourcePreset"]:checked',
        );
        syncSourcePresetUi(checked ? normalizeSourcePreset(checked.value) : "");
      });
    });

  /* ---- Company chip controls (allow + block) ---- */
  function bindChipInput(inputId, addBtnId, listKind) {
    const input = document.getElementById(inputId);
    const addBtn = document.getElementById(addBtnId);
    function commit() {
      if (!input) return;
      const v = input.value;
      if (v && v.trim()) {
        addCompanyChip(listKind, v);
        input.value = "";
      }
    }
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      });
    }
    if (addBtn) addBtn.addEventListener("click", commit);
  }
  bindChipInput("dpCompanyAllowlistInput", "dpCompanyAllowlistAddBtn", "allow");
  bindChipInput("dpCompanyBlocklistInput", "dpCompanyBlocklistAddBtn", "block");

  // Chip remove handler — delegated for both lists.
  drawer.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('[data-action="remove-chip"]');
    if (!btn) return;
    const list = btn.getAttribute("data-list");
    const value = btn.getAttribute("data-value");
    if (!list || !value) return;
    if (list === "allow" || list === "block") removeCompanyChip(list, value);
  });

  /* ---- Scrape job listing (optional context for AI ideas) ---- */
  const scrapeBtn = document.getElementById("dpScrapeBtn");
  let scrapedJobData = null;

  if (scrapeBtn) {
    scrapeBtn.addEventListener("click", async () => {
      const urlInput = document.getElementById("dpJobUrl");
      const statusEl = document.getElementById("dpScrapeStatus");
      const url = urlInput ? urlInput.value.trim() : "";
      if (!url) {
        if (statusEl) {
          statusEl.textContent = "Paste a URL first.";
          statusEl.hidden = false;
        }
        return;
      }
      const base = h("getJobPostingScrapeUrl", );
      if (!base) {
        if (statusEl) {
          statusEl.textContent =
            "No scraper configured. Set one in Settings or use localhost.";
          statusEl.hidden = false;
        }
        return;
      }
      scrapeBtn.disabled = true;
      scrapeBtn.textContent = "Scraping...";
      if (statusEl) {
        statusEl.textContent = "Fetching job listing...";
        statusEl.hidden = false;
      }
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30_000);
        const res = await fetch(`${base}/api/scrape-job`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        scrapedJobData = data;
        const title = data.title || "Untitled";
        const company = data.company || "";
        if (statusEl) {
          statusEl.textContent = `Scraped: ${title}${company ? " at " + company : ""}`;
          statusEl.hidden = false;
        }
      } catch (err) {
        scrapedJobData = null;
        if (statusEl) {
          statusEl.textContent = `Scrape failed: ${err.message || err}`;
          statusEl.hidden = false;
        }
      } finally {
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = "Scrape";
      }
    });
  }

  /* ---- AI ideation: generate Safe / Adjacent / Stretch strata ---- */
  const suggestBtn = document.getElementById("dpSuggestBtn");
  if (suggestBtn) {
    suggestBtn.addEventListener("click", async () => {
      suggestBtn.disabled = true;
      const originalLabel = suggestBtn.textContent;
      suggestBtn.textContent = "Analyzing...";
      const grid = document.getElementById("dpStrataGrid");
      const status = document.getElementById("dpSuggestStatus");
      if (status) {
        status.textContent = "Generating ideas…";
        status.hidden = false;
      }
      try {
        const strata = await generateDiscoverySuggestions(scrapedJobData);
        discoveryDrawerState.strata = strata;
        renderStrataCards(strata);
        if (grid) grid.hidden = false;
        if (status) status.hidden = true;
      } catch (err) {
        if (status) {
          status.textContent = `AI ideas failed: ${err.message || err}`;
          status.hidden = false;
        }
        h("showToast", `AI ideas failed: ${err.message || err}`, "error");
      } finally {
        suggestBtn.disabled = false;
        suggestBtn.textContent = originalLabel;
      }
    });
  }

  /* ---- Apply a stratum to the drawer fields ---- */
  drawer.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const applyBtn = target.closest('[data-action="apply-stratum"]');
    if (!applyBtn) return;
    const card = applyBtn.closest("[data-stratum]");
    if (!card) return;
    const key = card.getAttribute("data-stratum");
    const strata = discoveryDrawerState.strata;
    if (!strata || !strata[key]) return;
    applyStratumToDrawer(strata[key]);
    h("showToast", `Applied "${key}" search variant`, "success");
  });

  /* ---- Run discovery (saves drawer fields, dispatches webhook) ---- */
  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      const UC = window.CommandCenterUserContent;
      const val = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : "";
      };

      const finalTargetRoles = val("dpTargetRoles").trim();
      const finalKeywordsInclude = val("dpKeywordsInclude").trim();

      if (!finalTargetRoles && !finalKeywordsInclude) {
        h("showToast",
          "Add target roles or keywords, or pick an AI idea above.",
          "warning",
          true,
        );
        const grid = document.getElementById("dpStrataGrid");
        if (grid && grid.hidden) {
          // Auto-trigger AI generation when intent is blank.
          const sb = document.getElementById("dpSuggestBtn");
          if (sb && !sb.disabled) sb.click();
        }
        return;
      }

      const gwEl = document.getElementById("dpGroundedWeb");
      const groundedWebEnabled = gwEl ? gwEl.checked : true;
      const selectedPresetEl = document.querySelector(
        'input[name="dpSourcePreset"]:checked',
      );
      const sourcePreset = selectedPresetEl
        ? normalizeSourcePreset(selectedPresetEl.value)
        : "";
      const companyAllowlist = sanitizeCompanyEntries(
        discoveryDrawerState.allow,
      );
      const companyBlocklist = sanitizeCompanyEntries(
        discoveryDrawerState.block,
      );

      if (UC && typeof UC.saveDiscoveryProfile === "function") {
        // When the master Fit Profile is the source of truth, strip the
        // fit-profile-driven fields (targetRoles, locations, remotePolicy,
        // seniority) from the IndexedDB save. This prevents per-run edits
        // from drifting the local cache away from ~/.jobbored/profile.json.
        // Legacy fields (sourcePreset, maxLeadsPerRun, etc.) still persist.
        const hasMasterProfile = !!discoveryRunProfileState.baseProfile;
        const savePayload = hasMasterProfile
          ? {
              keywordsInclude: finalKeywordsInclude,
              keywordsExclude: val("dpKeywordsExclude"),
              maxLeadsPerRun: val("dpMaxLeads"),
              groundedWebEnabled,
              sourcePreset,
              companyAllowlist,
              companyBlocklist,
            }
          : {
              targetRoles: finalTargetRoles,
              locations: val("dpLocations"),
              remotePolicy: val("dpRemotePolicy"),
              seniority: val("dpSeniority"),
              keywordsInclude: finalKeywordsInclude,
              keywordsExclude: val("dpKeywordsExclude"),
              maxLeadsPerRun: val("dpMaxLeads"),
              groundedWebEnabled,
              sourcePreset,
              companyAllowlist,
              companyBlocklist,
            };
        await UC.saveDiscoveryProfile(savePayload);
      }
      closeDiscoveryDrawer();
      const openBtn = document.getElementById("discoveryBtn");
      if (openBtn) {
        openBtn.disabled = true;
        openBtn.classList.add("loading");
      }
      await h("triggerDiscoveryRun", );
      if (openBtn) {
        openBtn.classList.remove("loading");
      }
      h("syncDiscoveryButtonState", );
    });
  }
}

/**
 * Paint the three AI strata cards from a normalized strata payload.
 */
function renderStrataCards(strata) {
  const keys = ["safe", "adjacent", "stretch"];
  for (const key of keys) {
    const card = document.querySelector(
      `.dp-stratum-card[data-stratum="${key}"]`,
    );
    if (!card) continue;
    const v = (strata && strata[key]) || normalizeStratum({});
    const set = (field, value) => {
      const el = card.querySelector(`[data-field="${field}"]`);
      if (el) el.textContent = value || "—";
    };
    set("rationale", v.rationale);
    set("targetRoles", v.targetRoles);
    set("locations", v.locations);
    set("keywordsInclude", v.keywordsInclude);
    set(
      "companies",
      Array.isArray(v.companyAllowlist) && v.companyAllowlist.length
        ? v.companyAllowlist.slice(0, 8).join(", ")
        : "—",
    );
  }
}

/**
 * Replace the drawer intent fields and company chips with the selected stratum.
 * The user can still edit before running.
 */
function applyStratumToDrawer(stratum) {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || "";
  };
  setVal("dpTargetRoles", stratum.targetRoles);
  setVal("dpLocations", stratum.locations);
  setVal("dpRemotePolicy", stratum.remotePolicy);
  setVal("dpSeniority", stratum.seniority);
  setVal("dpKeywordsInclude", stratum.keywordsInclude);
  setVal("dpKeywordsExclude", stratum.keywordsExclude);
  if (stratum.sourcePreset) {
    syncSourcePresetUi(normalizeSourcePreset(stratum.sourcePreset));
  }
  // Auto-include companies (replace allowlist with the stratum's selection).
  discoveryDrawerState.allow = sanitizeCompanyEntries(
    Array.isArray(stratum.companyAllowlist) ? stratum.companyAllowlist : [],
  );
  renderCompanyChips("allow");
}

function initDiscoveryButton() {
  const modal = document.getElementById("discoveryHelpModal");
  const openBtn = document.getElementById("discoveryBtn");
  const closeBtn = document.getElementById("discoveryHelpClose");
  const openSettingsBtn = document.getElementById("discoveryHelpOpenSettings");
  if (!openBtn) return;

  function closeHelp(skipFocus) {
    if (modal) modal.style.display = "none";
    if (!skipFocus) openBtn.focus();
  }

  function openHelp() {
    if (modal) modal.style.display = "flex";
    const primary = document.getElementById("discoveryHelpOpenSettings");
    if (primary) primary.focus();
    else if (closeBtn) closeBtn.focus();
  }

  openBtn.addEventListener("click", () => {
    openDiscoveryDrawer();
  });

  if (closeBtn) closeBtn.addEventListener("click", () => closeHelp());
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", async () => {
      closeHelp(true);
      await h("openSettingsForDiscoveryWebhook", );
    });
  }
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeHelp();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.style.display === "flex") closeHelp();
    });
  }

  h("syncDiscoveryButtonState", );
}

  Object.assign(drawer, {
    openDiscoveryDrawer,
    closeDiscoveryDrawer,
    isDiscoveryDrawerOpen,
    initDiscoveryDrawer,
    initDiscoverySubtabs,
    initDiscoveryButton,
    getEffectiveFitProfileFields,
    getDiscoveryRunProfileState() {
      return discoveryRunProfileState;
    },
    getDiscoveryDrawerState() {
      return discoveryDrawerState;
    },
    normalizeSourcePreset,
    syncSourcePresetUi,
    sanitizeCompanyEntries,
    warnDiscoverySourceReadinessBeforeRun,
    refreshDiscoveryDrawerSourceReadiness,
    generateDiscoverySuggestions,
    normalizeStratum,
    applyStratumToDrawer,
    parseJsonSafeForSuggestions,
    resolveGeminiModel,
    callDiscoveryAiGemini,
    callDiscoveryAiOpenAI,
    callDiscoveryAiAnthropic,
    callDiscoveryAiOpenRouter,
    callDiscoveryAiLocal,
    callConfiguredAi,
    setDiscoveryDrawerSubtab,
    getActiveDiscoverySubtab() {
      return activeDiscoverySubtab;
    },
  });

  window.JobBoredDiscoveryDrawerSubtabs = {
    setActiveSubtab: setDiscoveryDrawerSubtab,
    getActiveSubtab: () => activeDiscoverySubtab,
    ORDER: DISCOVERY_SUBTAB_ORDER.slice(),
  };

  window.openDiscoveryDrawer = openDiscoveryDrawer;
  window.closeDiscoveryDrawer = closeDiscoveryDrawer;
})();
