/**
 * pipeline-transitions.js — canonical stage registry + atomic Sheet planner.
 *
 * Isolated helper (F1-A). Product surfaces (flowing-writes.js, pipeline.js,
 * expired-review.js, sheets-writeback.js) should call this planner so Status,
 * dates, follow-up, audit notes, closure, restore, and undo share one writer.
 *
 * Dismissed is a closed kind via column W, not a Status rewrite. Expired
 * always writes "Expired". Applied from product paths requires an explicit
 * confirmation payload { submitted, date, source }.
 *
 * IIFE. No network. Tests mock applyCells.
 */
(function (root) {
  "use strict";

  var COLUMNS = Object.freeze({
    status: "M",
    appliedDate: "N",
    notes: "O",
    followUpDate: "P",
    lastContact: "R",
    dismissedAt: "W",
  });

  var STAGE_LIST = [
    { key: "new", status: "New", kind: "active" },
    { key: "researching", status: "Researching", kind: "active" },
    { key: "applied", status: "Applied", kind: "active" },
    { key: "phone-screen", status: "Phone Screen", kind: "active" },
    { key: "interviewing", status: "Interviewing", kind: "active" },
    { key: "offer", status: "Offer", kind: "active" },
    { key: "rejected", status: "Rejected", kind: "closed" },
    { key: "passed", status: "Passed", kind: "closed" },
    { key: "expired", status: "Expired", kind: "closed" },
    { key: "dismissed", status: null, kind: "closed", dismissed: true },
  ];

  var STAGE_BY_KEY = Object.create(null);
  var STAGE_BY_STATUS = Object.create(null);
  for (var i = 0; i < STAGE_LIST.length; i++) {
    var entry = Object.freeze(STAGE_LIST[i]);
    STAGE_LIST[i] = entry;
    STAGE_BY_KEY[entry.key] = entry;
    if (entry.status) STAGE_BY_STATUS[entry.status.toLowerCase()] = entry;
  }
  Object.freeze(STAGE_LIST);

  function slugify(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
  }

  function resolveStage(value) {
    if (!value) return null;
    if (typeof value === "object") {
      if (value.key && STAGE_BY_KEY[value.key]) return STAGE_BY_KEY[value.key];
      if (value.status) return resolveStage(value.status);
      return null;
    }
    var slug = slugify(value);
    if (STAGE_BY_KEY[slug]) return STAGE_BY_KEY[slug];
    var lowered = String(value).trim().toLowerCase();
    if (STAGE_BY_STATUS[lowered]) return STAGE_BY_STATUS[lowered];
    return null;
  }

  function statusFor(key) {
    var stage = resolveStage(key);
    return stage ? stage.status : null;
  }

  function isClosed(key) {
    var stage = resolveStage(key);
    return !!(stage && stage.kind === "closed");
  }

  function isActive(key) {
    var stage = resolveStage(key);
    return !!(stage && stage.kind === "active");
  }

  function isoDate(now) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    return d.toISOString().slice(0, 10);
  }

  function plusDaysIso(iso, days) {
    var parts = String(iso).split("-").map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function cell(column, rowNumber, value) {
    return {
      range: "Pipeline!" + column + rowNumber,
      column: column,
      value: value == null ? "" : String(value),
    };
  }

  function appendNote(existing, text, date) {
    var entry = "[" + date + "] " + text;
    var current = existing == null ? "" : String(existing);
    if (!current) return entry;
    var lines = current.split("\n");
    for (var n = 0; n < lines.length; n++) {
      if (lines[n].trim() === entry) return current;
    }
    return entry + "\n" + current;
  }

  function hasAppliedConfirmation(confirmation) {
    if (!confirmation || typeof confirmation !== "object") return false;
    if (confirmation.submitted !== true) return false;
    if (!confirmation.date || typeof confirmation.date !== "string" || !confirmation.date.trim()) {
      return false;
    }
    if (!confirmation.source || typeof confirmation.source !== "string" || !confirmation.source.trim()) {
      return false;
    }
    return true;
  }

  function fail(code, message) {
    return { ok: false, code: code, message: message, patches: [] };
  }

  function snapshot(row, patches) {
    var previous = [];
    for (var p = 0; p < patches.length; p++) {
      var col = patches[p].column;
      var prev = "";
      if (col === COLUMNS.status) prev = row.status || "";
      else if (col === COLUMNS.appliedDate) prev = row.appliedDate || "";
      else if (col === COLUMNS.notes) prev = row.notes || "";
      else if (col === COLUMNS.followUpDate) prev = row.followUpDate || "";
      else if (col === COLUMNS.lastContact) prev = row.lastContact || "";
      else if (col === COLUMNS.dismissedAt) prev = row.dismissedAt || "";
      previous.push(cell(col, row.sheetRow, prev));
    }
    return previous;
  }

  function followUpDaysFor(status) {
    if (status === "Applied") return 7;
    if (status === "Phone Screen") return 3;
    if (status === "Interviewing") return 5;
    return 0;
  }

  function planDismiss(row, now, note) {
    var date = isoDate(now);
    var stamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    var patches = [cell(COLUMNS.dismissedAt, row.sheetRow, stamp)];
    var noteText = note && String(note).trim() ? String(note).trim() : "Dismissed";
    patches.push(cell(COLUMNS.notes, row.sheetRow, appendNote(row.notes, noteText, date)));
    return {
      ok: true,
      action: "dismiss",
      patches: patches,
      rollback: {
        handle: "dismiss:" + row.sheetRow + ":" + stamp,
        patches: snapshot(row, patches),
      },
    };
  }

  function planRestore(row, now, note) {
    var date = isoDate(now);
    var patches = [cell(COLUMNS.dismissedAt, row.sheetRow, "")];
    var noteText = note && String(note).trim() ? String(note).trim() : "Restored";
    patches.push(cell(COLUMNS.notes, row.sheetRow, appendNote(row.notes, noteText, date)));
    return {
      ok: true,
      action: "restore",
      patches: patches,
      rollback: {
        handle: "restore:" + row.sheetRow + ":" + date,
        patches: snapshot(row, patches),
      },
    };
  }

  function planStatusMove(fromStage, toStage, row, now, confirmation, note) {
    var target = resolveStage(toStage);
    if (!target) return fail("unknown_stage", "Unknown toStage: " + String(toStage));
    if (target.dismissed) return planDismiss(row, now, note);

    if (target.key === "applied" && !hasAppliedConfirmation(confirmation)) {
      return fail(
        "confirmation_required",
        "Applied requires an explicit submission confirmation payload (submitted, date, source).",
      );
    }

    var date = isoDate(now);
    var appliedDate = row.appliedDate || "";
    var followUpDate = row.followUpDate || "";
    var patches = [];
    var statusLabel = target.status;

    if ((row.status || "") !== statusLabel) {
      patches.push(cell(COLUMNS.status, row.sheetRow, statusLabel));
    }

    if (target.key === "applied") {
      var confirmedDate = confirmation.date.trim();
      if (!appliedDate) {
        appliedDate = confirmedDate;
        patches.push(cell(COLUMNS.appliedDate, row.sheetRow, appliedDate));
      }
      if (!followUpDate) {
        followUpDate = plusDaysIso(appliedDate || confirmedDate, followUpDaysFor("Applied"));
        patches.push(cell(COLUMNS.followUpDate, row.sheetRow, followUpDate));
      }
      var appliedNote = note && String(note).trim()
        ? String(note).trim()
        : "Applied via " + confirmation.source.trim();
      patches.push(cell(COLUMNS.notes, row.sheetRow, appendNote(row.notes, appliedNote, date)));
    } else if (target.key === "phone-screen" || target.key === "interviewing") {
      if (!appliedDate) {
        appliedDate = date;
        patches.push(cell(COLUMNS.appliedDate, row.sheetRow, appliedDate));
      }
      followUpDate = plusDaysIso(date, followUpDaysFor(statusLabel));
      patches.push(cell(COLUMNS.followUpDate, row.sheetRow, followUpDate));
    } else if (target.key === "offer" || target.key === "rejected" || target.key === "passed" || target.key === "expired") {
      if (followUpDate) {
        patches.push(cell(COLUMNS.followUpDate, row.sheetRow, ""));
      } else if (target.key === "expired") {
        patches.push(cell(COLUMNS.followUpDate, row.sheetRow, ""));
      }
    } else if (target.key === "new") {
      if (appliedDate) patches.push(cell(COLUMNS.appliedDate, row.sheetRow, ""));
      if (followUpDate) patches.push(cell(COLUMNS.followUpDate, row.sheetRow, ""));
    }

    var noteText = note && String(note).trim() ? String(note).trim() : "";
    if (!noteText && target.key === "expired") noteText = "Marked Expired";
    if (noteText && target.key !== "applied") {
      patches.push(cell(COLUMNS.notes, row.sheetRow, appendNote(row.notes, noteText, date)));
    }

    return {
      ok: true,
      action: "move",
      patches: patches,
      rollback: {
        handle: "move:" + target.key + ":" + row.sheetRow + ":" + date,
        patches: snapshot(row, patches),
      },
    };
  }

  function planTransition(input) {
    var payload = input || {};
    var row = payload.row || {};
    if (!row.sheetRow) return fail("missing_row", "row.sheetRow is required.");
    var now = payload.now || new Date();
    var action = payload.action ? String(payload.action).trim().toLowerCase() : "";

    if (action === "dismiss") return planDismiss(row, now, payload.note);
    if (action === "restore") return planRestore(row, now, payload.note);
    if (action === "expire" || action === "expiry") {
      return planStatusMove(payload.fromStage, "expired", row, now, payload.confirmation, payload.note);
    }
    if (action === "undo") return fail("use_apply_undo", "Use applyUndo with a rollback handle.");

    return planStatusMove(
      payload.fromStage,
      payload.toStage,
      row,
      now,
      payload.confirmation,
      payload.note,
    );
  }

  async function applyTransition(input, patchApi) {
    var planned = planTransition(input);
    if (!planned.ok) return planned;
    if (!patchApi || typeof patchApi.applyCells !== "function") {
      return fail("missing_patch_api", "patchApi.applyCells is required.");
    }
    await patchApi.applyCells(planned.patches);
    return planned;
  }

  async function applyUndo(rollback, patchApi) {
    if (!rollback || !rollback.handle || !Array.isArray(rollback.patches)) {
      return fail("invalid_rollback", "rollback.handle and rollback.patches are required.");
    }
    if (!patchApi || typeof patchApi.applyCells !== "function") {
      return fail("missing_patch_api", "patchApi.applyCells is required.");
    }
    await patchApi.applyCells(rollback.patches);
    return { ok: true, action: "undo", patches: rollback.patches, rollback: rollback };
  }

  var api = Object.freeze({
    COLUMNS: COLUMNS,
    STAGES: STAGE_LIST,
    resolveStage: resolveStage,
    statusFor: statusFor,
    isClosed: isClosed,
    isActive: isActive,
    planTransition: planTransition,
    applyTransition: applyTransition,
    applyUndo: applyUndo,
  });

  root.JobBoredPipelineTransitions = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this);
