/* global module */
/* HOLES HUNT-FE: the discovery drawer's Hunts sub-tab, i.e. the hitlist of
   past searches and the saved hunts, plus the schedule picker and the Runs-row
   "Save as hunt" toggle. Data comes from JobBoredHuntsStore (hunts-store.js),
   which talks to the worker's /hunts routes (docs/INTERFACE-HUNTS.md).

   The renderers are pure string builders, exported for node:test (the repo's
   DOM fakes do not parse HTML). The DOM wiring runs only in a browser and
   leans on JobBoredA11y for the dialog, confirm and announcements. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JobBoredHuntsUI = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var DEFAULT_SHARE = 0.3;
  var DEFAULT_PICKER_SCHEDULE = { kind: "daily", hour: 8, minute: 0 };
  var DEFAULT_EVERY_HOURS = 6;
  var SCHEDULE_KINDS = [
    { value: "off", label: "Off — only when I run it" },
    { value: "daily", label: "Daily" },
    { value: "weekdays", label: "Weekdays" },
    { value: "every_n_hours", label: "Every few hours" },
  ];
  var TERM_FIELDS = [
    { key: "targetRoles", label: "Roles" },
    { key: "keywordsInclude", label: "Keywords" },
    { key: "locations", label: "Locations" },
    { key: "seniority", label: "Seniority" },
    { key: "keywordsExclude", label: "Exclude" },
  ];
  var TREND_TEXT = {
    up: { arrow: "↑", label: "Rising" },
    down: { arrow: "↓", label: "Falling" },
    flat: { arrow: "→", label: "Steady" },
    new: { arrow: "•", label: "New" },
  };

  /* ---- small helpers ---- */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function clean(value) {
    return String(value == null ? "" : value)
      .replace(/\s+/g, " ")
      .trim();
  }

  function count(value) {
    var n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  }

  function hitlistApi() {
    return (root && root.JobBoredHuntsHitlist) || null;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function formatClock(hour, minute) {
    var h = Number(hour);
    var m = Number(minute);
    if (!Number.isInteger(h) || !Number.isInteger(m)) return "";
    var suffix = h < 12 ? "AM" : "PM";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + pad2(m) + " " + suffix;
  }

  function scheduleLabel(schedule) {
    var s = asObject(schedule);
    var at = formatClock(s.hour, s.minute);
    if (s.kind === "daily") return "Daily at " + at;
    if (s.kind === "weekdays") return "Weekdays at " + at;
    if (s.kind === "every_n_hours") {
      return "Every " + count(s.everyHours) + " h from " + at;
    }
    return "Not scheduled";
  }

  function shareLabel(share) {
    var n = Number(share);
    if (!Number.isFinite(n)) n = DEFAULT_SHARE;
    return Math.round(Math.min(1, Math.max(0, n)) * 100) + "%";
  }

  function relativeTime(iso, nowMs) {
    var ms = Date.parse(String(iso || ""));
    if (!Number.isFinite(ms)) return "";
    var diff = ms - nowMs;
    var abs = Math.abs(diff);
    var future = diff > 0;
    var text;
    if (abs < 60000) return future ? "in under a minute" : "just now";
    if (abs < 3600000) text = Math.round(abs / 60000) + " min";
    else if (abs < 86400000) text = Math.round(abs / 3600000) + " h";
    else {
      var days = Math.round(abs / 86400000);
      text = days + (days === 1 ? " day" : " days");
    }
    return future ? "in " + text : text + " ago";
  }

  /** "08:30" + kind + every → a HuntSchedule, or an error message. */
  function scheduleFromValues(values) {
    var v = asObject(values);
    var kind = clean(v.scheduleKind) || "off";
    if (!SCHEDULE_KINDS.some(function (k) {
      return k.value === kind;
    })) {
      return { ok: false, message: "Pick a schedule." };
    }
    var match = /^(\d{1,2}):(\d{2})$/.exec(clean(v.scheduleTime) || "08:00");
    var hour = match ? Number(match[1]) : NaN;
    var minute = match ? Number(match[2]) : NaN;
    if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)) {
      return { ok: false, message: "Enter a time like 08:00." };
    }
    var schedule = { kind: kind, hour: hour, minute: minute };
    if (kind === "every_n_hours") {
      var every = Number(v.everyHours);
      if (!Number.isInteger(every) || every < 1 || every > 24) {
        return { ok: false, message: "Run every 1 to 24 hours." };
      }
      schedule.everyHours = every;
    }
    return { ok: true, schedule: schedule };
  }

  function shareFromValues(values) {
    var pct = Number(asObject(values).explorationShare);
    if (!Number.isFinite(pct)) return DEFAULT_SHARE;
    return Math.round(Math.min(100, Math.max(0, pct))) / 100;
  }

  function sameSchedule(a, b) {
    var x = asObject(a);
    var y = asObject(b);
    return (
      x.kind === y.kind &&
      Number(x.hour) === Number(y.hour) &&
      Number(x.minute) === Number(y.minute) &&
      (x.kind !== "every_n_hours" || Number(x.everyHours) === Number(y.everyHours))
    );
  }

  /* ---- search terms (the user-facing half of a plan) ---- */

  function splitTerms(value) {
    var seen = {};
    return String(value || "")
      .split(/[,;\n]/)
      .map(clean)
      .filter(function (term) {
        var key = term.toLowerCase();
        if (!term || seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  function listOrQuery(list, value) {
    var fromList = Array.isArray(list) ? list.map(clean).filter(Boolean) : [];
    return fromList.length ? fromList.join(", ") : splitTerms(value).join(", ");
  }

  /** What the user searched, without the run's own rotation picks (§7). */
  function searchTerms(plan) {
    var p = asObject(plan);
    var query = asObject(p.query);
    var facets = asObject(p.facets);
    var selected = asObject(p.selected);
    var rotation = [selected.skill, selected.industry, selected.companyType]
      .map(function (value) {
        return clean(value).toLowerCase();
      })
      .filter(Boolean);
    return {
      targetRoles: listOrQuery(facets.roles, query.targetRoles),
      keywordsInclude: splitTerms(query.keywordsInclude)
        .filter(function (term) {
          return rotation.indexOf(term.toLowerCase()) === -1;
        })
        .join(", "),
      locations: listOrQuery(facets.locations, query.locations),
      seniority: listOrQuery(facets.seniority, query.seniority),
      keywordsExclude: splitTerms(query.keywordsExclude).join(", "),
    };
  }

  function termKey(value) {
    return splitTerms(value)
      .map(function (term) {
        return term.toLowerCase();
      })
      .sort()
      .join("|");
  }

  /**
   * Editor values → POST /hunts/:id body. Term fields that match the saved
   * plan drop out of `tweaks` (which the worker replaces wholesale); only
   * changed schedule/timezone fields are sent, since either one moves
   * nextRunAt.
   */
  function huntPatchFromValues(hunt, values, timezone) {
    var h = asObject(hunt);
    var v = asObject(values);
    var base = searchTerms(h.searchPlan);
    var tweaks = {};
    var existing = asObject(h.tweaks);
    if (typeof existing.remotePolicy === "string") tweaks.remotePolicy = existing.remotePolicy;
    TERM_FIELDS.forEach(function (field) {
      var next = clean(v[field.key]);
      if (termKey(next) !== termKey(base[field.key])) tweaks[field.key] = next;
    });
    var schedule = scheduleFromValues(v);
    if (!schedule.ok) return { ok: false, message: schedule.message };
    var patch = { tweaks: tweaks };
    var name = clean(v.name).slice(0, 120);
    if (name && name !== h.name) patch.name = name;
    var share = shareFromValues(v);
    if (share !== Number(h.explorationShare)) patch.explorationShare = share;
    if (!sameSchedule(schedule.schedule, h.schedule)) patch.schedule = schedule.schedule;
    if (timezone && patch.schedule && timezone !== h.timezone) patch.timezone = timezone;
    if (sameTweaks(tweaks, existing)) delete patch.tweaks;
    return { ok: true, patch: patch };
  }

  function sameTweaks(a, b) {
    var keys = Object.keys(a).concat(Object.keys(b));
    return keys.every(function (key) {
      return (
        typeof a[key] === "string" &&
        typeof b[key] === "string" &&
        termKey(a[key]) === termKey(b[key])
      );
    });
  }

  /** Picker values → POST /hunts body ("Save as hunt"). */
  function saveRequestFromValues(source, values, timezone) {
    var s = asObject(source);
    var schedule = scheduleFromValues(values);
    if (!schedule.ok) return { ok: false, message: schedule.message };
    var body = {
      schedule: schedule.schedule,
      explorationShare: shareFromValues(values),
      status: "active",
    };
    if (s.fromRunId) body.fromRunId = String(s.fromRunId);
    if (s.searchPlan && typeof s.searchPlan === "object") body.searchPlan = s.searchPlan;
    var name = clean(asObject(values).name).slice(0, 120);
    if (name) body.name = name;
    if (timezone) body.timezone = timezone;
    return { ok: true, body: body };
  }

  /* ---- renderers ---- */

  function trendHtml(points, idBase) {
    var list = Array.isArray(points) ? points : [];
    var api = hitlistApi();
    var direction = api ? api.trendDirection(list) : "new";
    var text = TREND_TEXT[direction] || TREND_TEXT.new;
    var oldestFirst = list.slice(0, 10).reverse();
    var max = oldestFirst.reduce(function (m, point) {
      return Math.max(m, count(asObject(point).written));
    }, 0);
    var bars = oldestFirst
      .map(function (point) {
        var pct = max ? Math.round((count(asObject(point).written) / max) * 100) : 0;
        return (
          '<span class="hunts-spark__bar" style="--hunts-bar-h: ' + Math.max(pct, 6) + '%"></span>'
        );
      })
      .join("");
    var spoken = oldestFirst
      .map(function (point) {
        return count(asObject(point).written);
      })
      .join(", ");
    return (
      '<span class="hunts-trend hunts-trend--' + esc(direction) + '" id="' + esc(idBase) + '-trend">' +
      '<span aria-hidden="true">' + text.arrow + "</span> " + text.label +
      "</span>" +
      (bars ? '<span class="hunts-spark" aria-hidden="true">' + bars + "</span>" : "") +
      (spoken
        ? '<span class="sr-only">New leads per run, oldest to newest: ' + esc(spoken) + ".</span>"
        : "")
    );
  }

  function countsHtml(written, updated) {
    return (
      '<span class="hunts-count hunts-count--new">' + count(written) + " new</span>" +
      '<span class="hunts-count">' + count(updated) + " seen</span>"
    );
  }

  function lockedAttr(ctx) {
    return ctx.locked ? " disabled" : "";
  }

  function renderClusterHtml(cluster, index, ctx) {
    var c = asObject(cluster);
    var id = "hunts-c-" + index;
    var saved = Boolean(c.huntId);
    var fit =
      c.meanFit == null ? "" : '<span class="hunts-fit">Fit ' + Number(c.meanFit).toFixed(1) + "</span>";
    var last = relativeTime(c.lastRunAt, ctx.now);
    return (
      '<li class="hunts-item" data-cluster-key="' + esc(c.key) + '">' +
      '<div class="hunts-item__main">' +
      '<h4 class="hunts-item__title" id="' + id + '-title">' + esc(c.label || "Untitled search") + "</h4>" +
      '<p class="hunts-item__meta">' +
      (last ? "Last run " + esc(last) : "No runs yet") +
      " · " + count(c.runCount) + (count(c.runCount) === 1 ? " run" : " runs") +
      "</p>" +
      '<p class="hunts-item__yield">' + countsHtml(c.leadsWritten, c.leadsUpdated) + fit +
      trendHtml(c.trend, id) + "</p>" +
      "</div>" +
      '<div class="hunts-item__actions">' +
      '<button type="button" class="btn-modal-secondary hunts-btn" data-hunts-action="run-search"' +
      ' data-cluster-key="' + esc(c.key) + '" aria-describedby="' + id + '-title"' + lockedAttr(ctx) +
      ">Run again</button>" +
      '<button type="button" class="hunts-switch" role="switch" aria-checked="' + (saved ? "true" : "false") + '"' +
      ' data-hunts-action="toggle-save" data-cluster-key="' + esc(c.key) + '"' +
      ' aria-describedby="' + id + '-title"' + lockedAttr(ctx) + ">" +
      '<span class="hunts-switch__track" aria-hidden="true"><span class="hunts-switch__thumb"></span></span>' +
      '<span class="hunts-switch__label">Save as hunt</span>' +
      "</button>" +
      "</div>" +
      "</li>"
    );
  }

  function scheduleFieldsHtml(schedule, prefix) {
    var s = asObject(schedule);
    var kind = s.kind || "off";
    var time = pad2(Number.isInteger(s.hour) ? s.hour : 8) + ":" + pad2(Number.isInteger(s.minute) ? s.minute : 0);
    var every = count(s.everyHours) || DEFAULT_EVERY_HOURS;
    return (
      '<fieldset class="hunts-schedule">' +
      "<legend>Schedule</legend>" +
      '<div class="hunts-schedule__kinds">' +
      SCHEDULE_KINDS.map(function (k) {
        return (
          '<label class="hunts-radio"><input type="radio" name="scheduleKind" value="' + k.value + '"' +
          (k.value === kind ? " checked" : "") + "> " + esc(k.label) + "</label>"
        );
      }).join("") +
      "</div>" +
      '<div class="hunts-schedule__when">' +
      '<label class="hunts-inline-field" for="' + prefix + '-time">At ' +
      '<input type="time" id="' + prefix + '-time" name="scheduleTime" value="' + time + '" step="300"></label>' +
      '<label class="hunts-inline-field" for="' + prefix + '-every" data-hunts-every' +
      (kind === "every_n_hours" ? "" : " hidden") + ">Every " +
      '<input type="number" id="' + prefix + '-every" name="everyHours" min="1" max="24" step="1"' +
      ' inputmode="numeric" value="' + every + '"> hours</label>' +
      "</div>" +
      "</fieldset>"
    );
  }

  function explorationFieldHtml(share, prefix) {
    var pct = Math.round(
      (Number.isFinite(Number(share)) ? Number(share) : DEFAULT_SHARE) * 100,
    );
    return (
      '<div class="hunts-field hunts-field--range">' +
      '<label for="' + prefix + '-share">Exploration</label>' +
      '<div class="hunts-range">' +
      '<input type="range" id="' + prefix + '-share" name="explorationShare" min="0" max="100" step="5"' +
      ' value="' + pct + '" aria-valuetext="' + pct + '% exploring"' +
      ' aria-describedby="' + prefix + '-share-hint">' +
      '<output class="hunts-range__value" for="' + prefix + '-share">' + pct + "%</output>" +
      "</div>" +
      '<p class="hunts-field__hint" id="' + prefix + '-share-hint">Share of each run spent on companies,' +
      " job boards and search terms no run has tried. At least one slot always explores.</p>" +
      "</div>"
    );
  }

  function textFieldHtml(name, label, value, prefix) {
    return (
      '<div class="hunts-field">' +
      '<label for="' + prefix + "-" + name + '">' + esc(label) + "</label>" +
      '<input type="text" id="' + prefix + "-" + name + '" name="' + name + '" value="' + esc(value) + '"' +
      (name === "name" ? ' maxlength="120"' : ' maxlength="1000"') +
      ' autocomplete="off">' +
      "</div>"
    );
  }

  function renderHuntEditorHtml(hunt, index) {
    var h = asObject(hunt);
    var prefix = "hunts-edit-" + index;
    var terms = searchTerms(h.effectivePlan || h.searchPlan);
    return (
      '<form class="hunts-editor" id="' + prefix + '" data-hunt-id="' + esc(h.id) + '"' +
      ' aria-labelledby="hunts-h-' + index + '-title" novalidate>' +
      textFieldHtml("name", "Name", h.name || "", prefix) +
      TERM_FIELDS.map(function (field) {
        return textFieldHtml(field.key, field.label, terms[field.key], prefix);
      }).join("") +
      scheduleFieldsHtml(h.schedule, prefix) +
      explorationFieldHtml(h.explorationShare, prefix) +
      '<p class="hunts-form-error" role="alert" data-hunts-error hidden></p>' +
      '<div class="hunts-editor__actions">' +
      '<button type="submit" class="btn-modal-primary">Save changes</button>' +
      '<button type="button" class="btn-modal-secondary" data-hunts-action="cancel-edit"' +
      ' data-hunt-id="' + esc(h.id) + '">Cancel</button>' +
      "</div>" +
      "</form>"
    );
  }

  function renderHuntHtml(hunt, index, ctx) {
    var h = asObject(hunt);
    var id = "hunts-h-" + index;
    var paused = h.status === "paused";
    var runs = Array.isArray(h.runs) ? h.runs : [];
    var latest = asObject(runs[0]);
    var editing = ctx.editing === h.id;
    var busy = ctx.busy && ctx.busy[h.id];
    var next = h.nextRunAt ? relativeTime(h.nextRunAt, ctx.now) : "";
    var last = h.lastRunAt ? relativeTime(h.lastRunAt, ctx.now) : "";
    var meta = [scheduleLabel(h.schedule)];
    if (!paused && next) meta.push("next " + next);
    meta.push("exploring " + shareLabel(h.explorationShare));
    var disabled = ctx.locked || busy ? " disabled" : "";
    var described = ' aria-describedby="' + id + '-title"';
    return (
      '<li class="hunts-item hunts-item--saved' + (paused ? " hunts-item--paused" : "") + '"' +
      ' data-hunt-id="' + esc(h.id) + '"' + (busy ? ' aria-busy="true"' : "") + ">" +
      '<div class="hunts-item__main">' +
      '<div class="hunts-item__head">' +
      '<h4 class="hunts-item__title" id="' + id + '-title">' + esc(h.name || "Saved hunt") + "</h4>" +
      '<span class="hunts-badge hunts-badge--' + (paused ? "paused" : "active") + '">' +
      (paused ? "Paused" : "Active") + "</span>" +
      "</div>" +
      '<p class="hunts-item__meta">' + esc(meta.join(" · ")) + "</p>" +
      '<p class="hunts-item__meta">' +
      (last ? "Last run " + esc(last) : "Not run yet") +
      "</p>" +
      (runs.length
        ? '<p class="hunts-item__yield">' + countsHtml(latest.written, latest.updated) +
          (latest.fitAvg != null ? '<span class="hunts-fit">Fit ' + Number(latest.fitAvg).toFixed(1) + "</span>" : "") +
          trendHtml(runs, id) + "</p>"
        : "") +
      (count(latest.awaitingSheetWrite)
        ? '<p class="hunts-item__note">' + count(latest.awaitingSheetWrite) +
          " leads wait for your Sheet; they are written the next time you open JobBored signed in.</p>"
        : "") +
      (h.queuedAt
        ? '<p class="hunts-item__note">Queued: it runs when the current run finishes.</p>'
        : "") +
      (h.lastError
        ? '<p class="hunts-item__error">Last run refused: ' + esc(h.lastError) + "</p>"
        : "") +
      "</div>" +
      '<div class="hunts-item__actions">' +
      '<button type="button" class="btn-modal-primary hunts-btn" data-hunts-action="run"' +
      ' data-hunt-id="' + esc(h.id) + '"' + described + disabled + ">Run now</button>" +
      '<button type="button" class="btn-modal-secondary hunts-btn" data-hunts-action="' +
      (paused ? "resume" : "pause") + '" data-hunt-id="' + esc(h.id) + '"' + described + disabled + ">" +
      (paused ? "Resume" : "Pause") + "</button>" +
      '<button type="button" class="btn-modal-secondary hunts-btn" data-hunts-action="edit"' +
      ' data-hunt-id="' + esc(h.id) + '" aria-expanded="' + (editing ? "true" : "false") + '"' +
      ' aria-controls="hunts-edit-' + index + '"' + described + disabled + ">Edit</button>" +
      '<button type="button" class="btn-modal-secondary hunts-btn hunts-btn--danger" data-hunts-action="delete"' +
      ' data-hunt-id="' + esc(h.id) + '"' + described + disabled + ">Delete</button>" +
      "</div>" +
      (editing ? renderHuntEditorHtml(h, index) : "") +
      "</li>"
    );
  }

  function renderStatusHtml(snapshot, ctx) {
    var s = asObject(snapshot);
    if (s.offline) {
      var when = s.cachedAt ? relativeTime(s.cachedAt, ctx.now) : "";
      return (
        '<div class="hunts-banner hunts-banner--offline" data-hunts-offline>' +
        '<p class="hunts-banner__title">Worker offline</p>' +
        '<p class="hunts-banner__body">' +
        (s.cachedAt
          ? "Showing your last saved copy (" + esc(when) + "). "
          : "Nothing saved on this device yet. ") +
        "Start the discovery worker to run or change hunts.</p>" +
        '<button type="button" class="btn-modal-secondary hunts-btn" data-hunts-action="refresh">Try again</button>' +
        "</div>"
      );
    }
    if (s.unsupported) {
      return (
        '<div class="hunts-banner hunts-banner--warn">' +
        '<p class="hunts-banner__title">Hunts aren’t available on this connection</p>' +
        '<p class="hunts-banner__body">Update the discovery worker, or connect to it directly or' +
        " through a tunnel: the Cloudflare relay doesn’t forward hunts yet. The hitlist below" +
        " comes from your run history.</p>" +
        "</div>"
      );
    }
    if (s.reason === "unauthorized") {
      return (
        '<div class="hunts-banner hunts-banner--warn">' +
        '<p class="hunts-banner__title">The worker refused the webhook secret</p>' +
        '<p class="hunts-banner__body">Check the secret on the Connection tab.</p>' +
        "</div>"
      );
    }
    return "";
  }

  function renderPanelParts(snapshot, ctx) {
    var s = asObject(snapshot);
    var c = Object.assign({ now: Date.now(), editing: "", busy: {} }, ctx || {});
    c.locked = Boolean(s.offline || s.unsupported);
    var clusters = Array.isArray(s.clusters) ? s.clusters : [];
    var repeating = clusters.filter(function (cluster) {
      return cluster && cluster.repeating;
    });
    var oneOffs = clusters.filter(function (cluster) {
      return cluster && !cluster.repeating;
    });
    var hunts = Array.isArray(s.hunts) ? s.hunts : [];
    var loading = !s.loaded && !s.cachedAt;
    return {
      status: renderStatusHtml(s, c),
      hitlist: repeating.length
        ? repeating.map(function (cluster, i) {
            return renderClusterHtml(cluster, "r" + i, c);
          }).join("")
        : '<li class="hunts-empty">' +
          (loading
            ? "Loading your past searches…"
            : "No search has repeated yet. Searches you run more than once show up here, best first.") +
          "</li>",
      oneOffs: oneOffs
        .map(function (cluster, i) {
          return renderClusterHtml(cluster, "o" + i, c);
        })
        .join(""),
      oneOffCount: oneOffs.length,
      saved: hunts.length
        ? hunts.map(function (hunt, i) {
            return renderHuntHtml(hunt, i, c);
          }).join("")
        : '<li class="hunts-empty">' +
          (loading
            ? "Loading saved hunts…"
            : "No saved hunts. Turn on “Save as hunt” for a search to run it on a schedule.") +
          "</li>",
    };
  }

  function renderPickerHtml(opts) {
    var o = asObject(opts);
    var prefix = "hunts-pick";
    return (
      '<div class="jb-a11y-dialog__panel hunts-dialog__panel">' +
      '<h2 class="jb-a11y-dialog__title" id="' + prefix + '-title">Save as hunt</h2>' +
      '<p class="jb-a11y-dialog__body">' +
      (o.label ? "<strong>" + esc(o.label) + "</strong>. " : "") +
      "A saved hunt re-runs this search on its schedule. Searches you don’t save never repeat on their own.</p>" +
      '<form class="hunts-picker" data-hunts-picker novalidate>' +
      textFieldHtml("name", "Name", o.label || "", prefix) +
      scheduleFieldsHtml(o.schedule || DEFAULT_PICKER_SCHEDULE, prefix) +
      explorationFieldHtml(o.explorationShare != null ? o.explorationShare : DEFAULT_SHARE, prefix) +
      '<p class="hunts-form-error" role="alert" data-hunts-error hidden></p>' +
      '<div class="jb-a11y-dialog__actions">' +
      '<button type="button" class="jb-a11y-dialog__btn jb-btn jb-btn--secondary jb-a11y-touch-target"' +
      ' data-hunts-dialog="cancel">Cancel</button>' +
      '<button type="submit" class="jb-a11y-dialog__btn jb-a11y-dialog__btn--confirm jb-btn jb-btn--primary' +
      ' jb-a11y-touch-target">Save hunt</button>' +
      "</div>" +
      "</form>" +
      "</div>"
    );
  }

  /* ---- Runs-row toggle (runs-tab.js) ---- */

  function defaultStore() {
    return (root && root.JobBoredHuntsStore) || null;
  }

  /** The "Save as hunt" switch for one run row; "" when the row cannot save. */
  function runToggleHtml(run, store) {
    var r = asObject(run);
    var runId = clean(r.runId);
    var s = store || defaultStore();
    if (!runId || !s || typeof s.huntForRun !== "function") return "";
    var saved = Boolean(s.huntForRun(runId));
    return (
      ' <button type="button" class="hunts-switch hunts-switch--row" role="switch"' +
      ' aria-checked="' + (saved ? "true" : "false") + '" data-runs-save-hunt="' + esc(runId) + '">' +
      '<span class="hunts-switch__track" aria-hidden="true"><span class="hunts-switch__thumb"></span></span>' +
      '<span class="hunts-switch__label">Save as hunt</span>' +
      "</button>"
    );
  }

  /* ---- DOM wiring (browser only) ---- */

  function a11y() {
    return (root && root.JobBoredA11y) || null;
  }

  function appHost() {
    var app = root && root.JobBoredApp;
    return (app && app.core && app.core.host) || null;
  }

  function announce(message, assertive) {
    var api = a11y();
    if (api && api.live && typeof api.live.announce === "function") {
      api.live.announce(message, assertive ? { assertive: true } : undefined);
    }
  }

  function timezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_) {
      return "";
    }
  }

  function formValues(form) {
    var values = {};
    Array.prototype.forEach.call(form.elements || [], function (el) {
      if (!el.name) return;
      if (el.type === "radio") {
        if (el.checked) values[el.name] = el.value;
        return;
      }
      values[el.name] = el.value;
    });
    return values;
  }

  function showFormError(form, message) {
    var slot = form.querySelector("[data-hunts-error]");
    if (!slot) return;
    slot.textContent = message || "";
    slot.hidden = !message;
  }

  /** Live helpers inside a form: the range readout and the every-N field. */
  function syncFormControls(form, target) {
    if (!form || !target) return;
    if (target.name === "explorationShare") {
      var out = form.querySelector(".hunts-range__value");
      var text = target.value + "%";
      if (out) out.textContent = text;
      target.setAttribute("aria-valuetext", text + " exploring");
    }
    if (target.name === "scheduleKind") {
      var every = form.querySelector("[data-hunts-every]");
      if (every) every.hidden = target.value !== "every_n_hours";
    }
  }

  // The discovery drawer closes itself on any Escape that reaches the
  // document, so a dialog stacked on it keeps Escape to itself and closes
  // only itself.
  function shieldEscape(el, onEscape) {
    if (!el || typeof el.addEventListener !== "function") return;
    el.addEventListener("keydown", function (event) {
      if (!event || event.key !== "Escape") return;
      event.stopPropagation();
      if (typeof event.preventDefault === "function") event.preventDefault();
      onEscape();
    });
  }

  function confirmRemove(name) {
    var api = a11y();
    if (api && api.dialog && typeof api.dialog.confirm === "function") {
      var pending = api.dialog.confirm({
        title: "Stop saving this hunt?",
        body:
          (name ? "“" + name + "” " : "This search ") +
          "will no longer run on its own. Its past runs stay in the Runs log.",
        confirmLabel: "Remove hunt",
        cancelLabel: "Keep it",
      });
      var doc = root.document;
      var shown =
        doc && typeof doc.querySelectorAll === "function"
          ? doc.querySelectorAll(".jb-a11y-dialog--confirm")
          : [];
      var dialogEl = shown.length ? shown[shown.length - 1] : null;
      shieldEscape(dialogEl, function () {
        var cancel = dialogEl.querySelector(".jb-a11y-dialog__btn--cancel");
        if (cancel) cancel.click();
      });
      return pending.then(function (result) {
        return Boolean(result && result.confirmed);
      });
    }
    return Promise.resolve(
      typeof root.confirm === "function" ? root.confirm("Remove this saved hunt?") : false,
    );
  }

  /** Open the schedule picker; resolves the saved hunt, or null on cancel. */
  function openSavePicker(source, opts) {
    var s = asObject(source);
    var o = asObject(opts);
    var store = o.store || defaultStore();
    var doc = root && root.document;
    if (!doc || !store) return Promise.resolve(null);
    var host = doc.createElement("div");
    host.className = "jb-a11y-dialog hunts-dialog";
    host.setAttribute("aria-labelledby", "hunts-pick-title");
    host.innerHTML = renderPickerHtml({ label: s.label });
    (doc.body || doc.documentElement).appendChild(host);
    var form = host.querySelector("[data-hunts-picker]");
    return new Promise(function (resolve) {
      var settled = false;
      var handle = null;
      function finish(result) {
        if (settled) return;
        settled = true;
        if (handle) handle.close();
        if (host.parentNode) host.parentNode.removeChild(host);
        resolve(result);
      }
      var api = a11y();
      if (api && api.dialog && typeof api.dialog.open === "function") {
        handle = api.dialog.open(host, {
          opener: o.opener,
          initialFocus: "input[name=scheduleKind]:checked",
          onClose: function () {
            finish(null);
          },
        });
      }
      shieldEscape(host, function () {
        finish(null);
      });
      host.addEventListener("click", function (event) {
        var target = event.target;
        if (target && target.closest && target.closest("[data-hunts-dialog=cancel]")) finish(null);
      });
      host.addEventListener("input", function (event) {
        syncFormControls(form, event.target);
      });
      host.addEventListener("change", function (event) {
        syncFormControls(form, event.target);
      });
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var built = saveRequestFromValues(s, formValues(form), timezone());
        if (!built.ok) {
          showFormError(form, built.message);
          return;
        }
        var submit = form.querySelector("[type=submit]");
        if (submit) submit.disabled = true;
        store.saveHunt(built.body).then(function (res) {
          if (submit) submit.disabled = false;
          if (res.ok) {
            announce("Saved hunt “" + clean(res.hunt && res.hunt.name) + "”.");
            finish(res.hunt);
            return;
          }
          if (res.code === "hunt_exists") {
            announce("That search is already a saved hunt.");
            finish({ id: res.huntId, existing: true });
            return;
          }
          showFormError(
            form,
            res.offline
              ? "The discovery worker is offline, so the hunt was not saved."
              : res.code === "run_has_no_search_plan"
                ? "That run didn’t record its search, so it can’t be saved as a hunt."
                : res.message || "The hunt was not saved.",
          );
        });
      });
    });
  }

  function toggleRunHunt(runId, button, opts) {
    var o = asObject(opts);
    var store = o.store || defaultStore();
    var id = clean(runId);
    if (!store || !id) return Promise.resolve(false);
    var hunt = store.huntForRun(id);
    var setChecked = function (on) {
      if (button && typeof button.setAttribute === "function") {
        button.setAttribute("aria-checked", on ? "true" : "false");
      }
    };
    if (hunt) {
      return confirmRemove(hunt.name).then(function (yes) {
        if (!yes) return false;
        return store.deleteHunt(hunt.id).then(function (res) {
          if (res.ok) {
            setChecked(false);
            announce("Hunt removed.");
            return true;
          }
          announce(res.message || "The hunt was not removed.", true);
          return false;
        });
      });
    }
    return openSavePicker({ fromRunId: id, label: o.label || "" }, { store: store, opener: button }).then(
      function (saved) {
        if (saved) setChecked(true);
        return Boolean(saved);
      },
    );
  }

  function mount(panel, opts) {
    var o = asObject(opts);
    var store = o.store || defaultStore();
    var doc = root && root.document;
    if (!panel || !store || !doc || panel.getAttribute("data-hunts-mounted") === "true") return null;
    panel.setAttribute("data-hunts-mounted", "true");
    var drawer = o.drawer || doc.getElementById("discoveryDrawer");
    var els = {
      status: panel.querySelector("[data-hunts-status]"),
      hitlist: panel.querySelector("[data-hunts-hitlist]"),
      oneOffs: panel.querySelector("[data-hunts-oneoffs]"),
      oneOffsWrap: panel.querySelector("[data-hunts-oneoffs-wrap]"),
      oneOffCount: panel.querySelector("[data-hunts-oneoff-count]"),
      saved: panel.querySelector("[data-hunts-saved]"),
    };
    var ui = { editing: "", busy: {} };

    function render() {
      var parts = renderPanelParts(store.snapshot(), {
        now: Date.now(),
        editing: ui.editing,
        busy: ui.busy,
      });
      if (els.status) els.status.innerHTML = parts.status;
      if (els.hitlist) els.hitlist.innerHTML = parts.hitlist;
      if (els.oneOffs) els.oneOffs.innerHTML = parts.oneOffs;
      if (els.oneOffsWrap) els.oneOffsWrap.hidden = parts.oneOffCount === 0;
      if (els.oneOffCount) els.oneOffCount.textContent = String(parts.oneOffCount);
      if (els.saved) els.saved.innerHTML = parts.saved;
      panel.setAttribute("aria-busy", store.snapshot().refreshing ? "true" : "false");
    }

    function visible() {
      return !panel.hidden && !(drawer && drawer.hidden);
    }

    function refresh() {
      return store.refresh().then(render);
    }

    function huntById(id) {
      return store.snapshot().hunts.filter(function (hunt) {
        return hunt.id === id;
      })[0];
    }

    function clusterByKey(key) {
      return store.snapshot().clusters.filter(function (cluster) {
        return cluster.key === key;
      })[0];
    }

    function withBusy(id, work) {
      ui.busy[id] = true;
      render();
      return work().then(function (res) {
        delete ui.busy[id];
        render();
        if (!res.ok) announce(res.message || "That didn’t work.", true);
        return res;
      });
    }

    function focusAfterRender(selector) {
      var el = panel.querySelector(selector);
      if (el && typeof el.focus === "function") el.focus();
    }

    // A re-render replaces the row's controls, so put focus back on the
    // re-created one (attribute values are matched, never put in a selector).
    function focusControl(actions, attr, value) {
      var all = panel.querySelectorAll("[data-hunts-action]");
      for (var i = 0; i < all.length; i += 1) {
        var el = all[i];
        if (
          actions.indexOf(el.getAttribute("data-hunts-action")) !== -1 &&
          el.getAttribute(attr) === value &&
          typeof el.focus === "function"
        ) {
          el.focus();
          return;
        }
      }
    }

    function onClick(event) {
      var target = event.target;
      var btn = target && target.closest ? target.closest("[data-hunts-action]") : null;
      if (!btn || btn.disabled) return;
      var action = btn.getAttribute("data-hunts-action");
      var id = btn.getAttribute("data-hunt-id") || "";
      if (action === "refresh") {
        refresh();
      } else if (action === "toggle-save") {
        var key = btn.getAttribute("data-cluster-key") || "";
        var cluster = clusterByKey(key);
        var refocusSwitch = function () {
          focusControl(["toggle-save"], "data-cluster-key", key);
        };
        if (!cluster) return;
        if (cluster.huntId) {
          var saved = huntById(cluster.huntId);
          confirmRemove(saved ? saved.name : cluster.label).then(function (yes) {
            if (!yes) return refocusSwitch();
            withBusy(cluster.huntId, function () {
              return store.deleteHunt(cluster.huntId);
            }).then(refocusSwitch);
          });
        } else {
          openSavePicker(
            { searchPlan: cluster.searchPlan, fromRunId: cluster.lastRunId, label: cluster.label },
            { store: store, opener: btn },
          ).then(function () {
            render();
            refocusSwitch();
          });
        }
      } else if (action === "run-search") {
        // Spec §0.5: re-run a productive past search once, unsaved. It goes
        // through the normal dispatch as trigger "hunt" with the cluster's
        // plan as searchPlanOverride (INTERFACE-HUNTS §4.3).
        var past = clusterByKey(btn.getAttribute("data-cluster-key") || "");
        var host = appHost();
        if (!past) return;
        if (!host || typeof host.triggerDiscoveryRun !== "function") {
          announce("Discovery isn’t ready yet.", true);
          return;
        }
        btn.disabled = true;
        Promise.resolve(
          host.triggerDiscoveryRun({
            trigger: "hunt",
            hunt: { searchPlanOverride: past.searchPlan },
          }),
        ).then(
          function (res) {
            btn.disabled = false;
            announce(
              res && res.ok === false
                ? "The search didn’t start. Check the Runs log."
                : "Search started. Follow it in the Runs log.",
              Boolean(res && res.ok === false),
            );
          },
          function () {
            btn.disabled = false;
            announce("The search didn’t start.", true);
          },
        );
      } else if (action === "run") {
        var refocusRun = function () {
          focusControl(["run"], "data-hunt-id", id);
        };
        withBusy(id, function () {
          return store.runHunt(id);
        }).then(function (res) {
          refocusRun();
          if (!res.ok) return;
          announce(
            res.kind === "queued"
              ? "Queued: the hunt runs when the current run finishes."
              : "Hunt started. Follow it in the Runs log.",
          );
          refresh().then(refocusRun);
        });
      } else if (action === "pause" || action === "resume") {
        withBusy(id, function () {
          return store.updateHunt(id, { status: action === "pause" ? "paused" : "active" });
        }).then(function (res) {
          focusControl(["pause", "resume"], "data-hunt-id", id);
          if (res.ok) announce(action === "pause" ? "Hunt paused." : "Hunt resumed.");
        });
      } else if (action === "edit") {
        ui.editing = ui.editing === id ? "" : id;
        render();
        if (ui.editing) focusAfterRender('form[data-hunt-id="' + id + '"] input[name="name"]');
      } else if (action === "cancel-edit") {
        ui.editing = "";
        render();
        focusAfterRender('[data-hunts-action="edit"][data-hunt-id="' + id + '"]');
      } else if (action === "delete") {
        var hunt = huntById(id);
        confirmRemove(hunt ? hunt.name : "").then(function (yes) {
          if (!yes) return;
          withBusy(id, function () {
            return store.deleteHunt(id);
          }).then(function (res) {
            if (!res.ok) return focusControl(["delete"], "data-hunt-id", id);
            announce("Hunt deleted.");
            var next =
              panel.querySelector("[data-hunts-saved] [data-hunts-action]") ||
              panel.querySelector('[data-hunts-action="refresh"]');
            if (next && typeof next.focus === "function") next.focus();
          });
        });
      }
    }

    function onSubmit(event) {
      var form = event.target;
      if (!form || !form.classList || !form.classList.contains("hunts-editor")) return;
      event.preventDefault();
      var id = form.getAttribute("data-hunt-id") || "";
      var hunt = huntById(id);
      if (!hunt) return;
      var built = huntPatchFromValues(hunt, formValues(form), timezone());
      if (!built.ok) {
        showFormError(form, built.message);
        return;
      }
      if (!Object.keys(built.patch).length) {
        ui.editing = "";
        render();
        return;
      }
      withBusy(id, function () {
        return store.updateHunt(id, built.patch);
      }).then(function (res) {
        if (!res.ok) return;
        ui.editing = "";
        render();
        announce("Hunt updated. Changes apply to its next run.");
        focusAfterRender('[data-hunts-action="edit"][data-hunt-id="' + id + '"]');
      });
    }

    function onInput(event) {
      var target = event.target;
      if (!target || !target.form) return;
      syncFormControls(target.form, target);
    }

    panel.addEventListener("click", onClick);
    panel.addEventListener("submit", onSubmit);
    panel.addEventListener("input", onInput);
    panel.addEventListener("change", onInput);
    root.addEventListener(store.CHANGED_EVENT || "jb:hunts:changed", render);

    var wasVisible = visible();
    if (typeof root.MutationObserver === "function") {
      var observer = new root.MutationObserver(function () {
        var now = visible();
        if (now && !wasVisible) refresh();
        wasVisible = now;
      });
      observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
      if (drawer) observer.observe(drawer, { attributes: true, attributeFilter: ["hidden"] });
    }
    render();
    if (wasVisible) refresh();
    return { render: render, refresh: refresh };
  }

  function autoMount() {
    var doc = root && root.document;
    if (!doc) return;
    var start = function () {
      mount(doc.getElementById("dd-panel-hunts"));
    };
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
    else start();
  }

  if (root && root.document && typeof root.addEventListener === "function") {
    autoMount();
  }

  return {
    DEFAULT_SHARE: DEFAULT_SHARE,
    formatClock: formatClock,
    huntPatchFromValues: huntPatchFromValues,
    mount: mount,
    openSavePicker: openSavePicker,
    relativeTime: relativeTime,
    renderClusterHtml: renderClusterHtml,
    renderHuntHtml: renderHuntHtml,
    renderPanelParts: renderPanelParts,
    renderPickerHtml: renderPickerHtml,
    renderStatusHtml: renderStatusHtml,
    runToggleHtml: runToggleHtml,
    saveRequestFromValues: saveRequestFromValues,
    scheduleFromValues: scheduleFromValues,
    scheduleLabel: scheduleLabel,
    searchTerms: searchTerms,
    shieldEscape: shieldEscape,
    shareLabel: shareLabel,
    toggleRunHunt: toggleRunHunt,
  };
});
