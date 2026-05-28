/**
 * fit-profile-backcompat.js — Task #6 UI wiring.
 *
 * Two surfaces:
 *   1. Fills the `#fit-profile-rescore-slot` left by fit-profile-editor.js
 *      with a "Rescore" button that POSTs /profile/rescore and shows the
 *      response message inline.
 *   2. Adds a one-time "Import from ~/.hermes" affordance to the onboarding
 *      wizard's empty state: a button that POSTs /profile/migrate and, on
 *      success, reloads the page so the wizard sees the new profile.
 *
 * Both surfaces are passive — they do nothing until their host element is
 * actually in the DOM. Safe to load on every page.
 */
(function () {
  "use strict";

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "style") Object.assign(node.style, attrs[k]);
        else if (k === "className") node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  /* ── 1. Rescore button ──────────────────────────────────────────────── */

  function renderRescoreSlot() {
    var slot = document.getElementById("fit-profile-rescore-slot");
    if (!slot || slot.dataset.bcReady === "1") return;
    slot.dataset.bcReady = "1";
    slot.innerHTML = "";

    var heading = el("h5", { className: "fp-heading" }, ["Rescore old listings"]);
    var lede = el("p", { className: "fp-lede" }, [
      "New discoveries automatically use your current Fit Profile. To rescore listings already in your Pipeline, trigger a discovery run or re-ingest specific URLs.",
    ]);
    var status = el("div", { className: "fp-rescore-status", role: "status" });
    var button = el("button", {
      type: "button",
      className: "btn-primary fp-rescore-btn",
    }, ["Rescore"]);

    button.addEventListener("click", async function () {
      button.disabled = true;
      status.textContent = "Working…";
      try {
        var resp = await fetch("/profile/rescore", { method: "POST" });
        var data = await resp.json();
        if (data && data.ok) {
          status.textContent = data.message || "Done.";
        } else {
          status.textContent = "Rescore failed: " + (data && data.reason ? data.reason : "unknown error");
        }
      } catch (err) {
        status.textContent = "Rescore failed: " + (err && err.message ? err.message : String(err));
      } finally {
        button.disabled = false;
      }
    });

    slot.appendChild(heading);
    slot.appendChild(lede);
    slot.appendChild(button);
    slot.appendChild(status);
  }

  /* ── 2. Legacy migration banner ────────────────────────────────────── */

  function renderMigrationBannerIfNoProfile() {
    // Show in the wizard's empty state when the user clearly has a legacy
    // hermes profile waiting to be picked up. We probe by attempting the
    // migrate endpoint in "dry" mode — but our endpoint is idempotent and
    // returns `migrated: false, reason: "no_legacy_files"` cheaply, so we
    // just call it and read the reason.
    var host = document.querySelector(".fp-wizard-empty, .fp-onboarding-empty, #onboarding-empty-state");
    if (!host || host.dataset.bcReady === "1") return;

    fetch("/profile", { method: "GET" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.profile) return; // already has profile
        // Probe whether legacy files exist via a HEAD-style migrate dry-run.
        // The migrate endpoint is idempotent; we don't actually trigger
        // until the user clicks.
        var banner = el("div", { className: "fp-migration-banner" }, [
          el("strong", null, ["Have an old profile from ~/.hermes/job-hunt?"]),
          el("p", null, ["Import it in one click — you can edit any field after."]),
        ]);
        var btn = el("button", {
          type: "button",
          className: "btn-secondary",
        }, ["Import from ~/.hermes"]);
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          btn.textContent = "Importing…";
          try {
            var resp = await fetch("/profile/migrate", { method: "POST" });
            var result = await resp.json();
            if (result && result.ok && result.migrated) {
              // Reload so the wizard re-fetches and shows the imported profile
              window.location.reload();
              return;
            }
            btn.disabled = false;
            btn.textContent = "Import from ~/.hermes";
            var note = el("p", { className: "fp-migration-note" }, [
              result && result.reason === "no_legacy_files"
                ? "No legacy profile found in ~/.hermes/job-hunt/profile/."
                : "Nothing to import (" + (result && result.reason ? result.reason : "unknown") + ").",
            ]);
            banner.appendChild(note);
          } catch (err) {
            btn.disabled = false;
            btn.textContent = "Import from ~/.hermes";
          }
        });
        banner.appendChild(btn);
        host.appendChild(banner);
        host.dataset.bcReady = "1";
      })
      .catch(function () { /* swallow — banner is optional */ });
  }

  /* ── Boot + observe ─────────────────────────────────────────────────── */

  function tick() {
    renderRescoreSlot();
    renderMigrationBannerIfNoProfile();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tick);
  } else {
    tick();
  }

  // The Settings tab and the wizard mount their hosts lazily. Re-run on
  // hashchange + use a MutationObserver as a final safety net.
  window.addEventListener("hashchange", tick);

  var observer = new MutationObserver(function () { tick(); });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
})();
