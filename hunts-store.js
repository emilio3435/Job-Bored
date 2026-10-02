/* global module */
/* HOLES HUNT-FE: client for the discovery worker's /hunts routes
   (docs/INTERFACE-HUNTS.md) plus a local cache, so the Hunts panel shows the
   last copy and a "worker offline" state when the worker is unreachable.

   Also:
   - noveltyContext(): the past plans buildSearchPlan steers its exploration
     share away from (discovery-payload.js reads it at payload time);
   - flushAwaitingSheetWrites(): spec §0.9 — on the next open, hand the
     dashboard's Google token to POST /runs/:id/retry-write for every run the
     worker holds as "awaiting sheet write".

   Spec §0.7: the Google token is read per call from window.JobBored and is
   never cached; the cache writer also strips token- and secret-named keys.
   Classic UMD global, like discovery-payload.js. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.JobBoredHuntsStore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var CACHE_KEY = "command_center_hunts_cache_v1";
  var CHANGED_EVENT = "jb:hunts:changed";
  var RUN_HISTORY_LIMIT = 100;
  var HITLIST_LIMIT = 20;
  var NOVELTY_LIMIT = 200;
  var REQUEST_TIMEOUT_MS = 8000;
  // §0.11: a dispatch POST may take 60 s; a retry-write flush, two minutes.
  var RUN_NOW_TIMEOUT_MS = 60000;
  var FLUSH_TIMEOUT_MS = 120000;
  var FLUSH_RETRY_DELAYS_MS = [2000, 8000, 20000, 45000, 90000];
  var SENSITIVE_KEY = /token|secret|password|authorization|credential/i;

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function clean(value, limit) {
    var s = String(value == null ? "" : value).trim();
    return limit && s.length > limit ? s.slice(0, limit) : s;
  }

  /** Deep copy without token-, secret- or credential-named keys (§0.7). */
  function scrub(value, depth) {
    if (depth > 12) return undefined;
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return scrub(item, depth + 1);
      });
    }
    if (!value || typeof value !== "object") return value;
    var out = {};
    Object.keys(value).forEach(function (key) {
      if (SENSITIVE_KEY.test(key)) return;
      var next = scrub(value[key], depth + 1);
      if (next !== undefined) out[key] = next;
    });
    return out;
  }

  function trimRun(run) {
    var r = asObject(run);
    var out = {
      runId: clean(r.runId, 200),
      status: clean(r.status, 40),
      trigger: clean(r.trigger, 40),
      startedAt: clean(r.startedAt, 80),
      completedAt: clean(r.completedAt, 80),
      headline: asObject(r.headline),
    };
    if (r.searchPlan && typeof r.searchPlan === "object") out.searchPlan = r.searchPlan;
    if (r.searchKey) out.searchKey = clean(r.searchKey, 80);
    if (r.yield && typeof r.yield === "object") out.yield = r.yield;
    if (r.awaitingSheetWrite && typeof r.awaitingSheetWrite === "object") {
      out.awaitingSheetWrite = r.awaitingSheetWrite;
    }
    return out;
  }

  function emptyCache() {
    return { v: 1, savedAt: "", hunts: [], clusters: [], runs: [] };
  }

  /* ---- browser defaults (lazy: the discovery modules load after this) ---- */

  function defaultStorage() {
    try {
      return root && root.localStorage ? root.localStorage : null;
    } catch (_) {
      return null;
    }
  }

  function defaultResolveWorker() {
    var discovery = root && root.JobBoredDiscovery;
    var status = discovery && discovery.status;
    var host = status && status.host;
    if (!host || typeof host.getDiscoveryWebhookUrl !== "function") return null;
    var configured = clean(host.getDiscoveryWebhookUrl());
    if (!configured) return null;
    var webhookUrl =
      typeof status.getDiscoveryStatusPollingWebhookUrl === "function"
        ? status.getDiscoveryStatusPollingWebhookUrl(configured) || ""
        : configured;
    if (!webhookUrl || typeof status.buildRunStatusUrl !== "function") return null;
    var core = typeof host.getConfigCore === "function" ? host.getConfigCore() : null;
    var secret =
      core && typeof core.getDiscoveryWebhookSecret === "function"
        ? clean(core.getDiscoveryWebhookSecret())
        : "";
    return {
      url: function (path) {
        return status.buildRunStatusUrl(path, webhookUrl);
      },
      headers: function (url) {
        return typeof status.buildDiscoveryStatusPollHeaders === "function"
          ? status.buildDiscoveryStatusPollHeaders(url)
          : { Accept: "application/json" };
      },
      secret: secret,
    };
  }

  function defaultFetch() {
    var relay = root && root.JobBoredRelayAuth;
    if (relay && typeof relay.fetch === "function") {
      return relay.fetch.apply(relay, arguments);
    }
    return root.fetch.apply(root, arguments);
  }

  function defaultAccessToken() {
    var app = root && root.JobBored;
    if (app && typeof app.getAccessToken === "function") {
      var token = app.getAccessToken();
      if (typeof token === "string" && token) return token;
    }
    return "";
  }

  function defaultEmit(detail) {
    if (!root || typeof root.dispatchEvent !== "function") return;
    try {
      root.dispatchEvent(new root.CustomEvent(CHANGED_EVENT, { detail: detail }));
    } catch (_) {
      /* no CustomEvent: nothing listens */
    }
  }

  /* ---- the store ---- */

  function createHuntsStore(deps) {
    var d = deps || {};
    var storage = d.storage !== undefined ? d.storage : defaultStorage();
    var resolveWorker = d.resolveWorker || defaultResolveWorker;
    var fetchImpl = d.fetch || defaultFetch;
    var readAccessToken = d.getAccessToken || defaultAccessToken;
    var emit = d.emit || defaultEmit;
    var hitlistApi = d.hitlist || (root && root.JobBoredHuntsHitlist) || null;
    var now =
      typeof d.now === "function"
        ? d.now
        : function () {
            return Date.now();
          };

    var cache = readCache();
    var status = {
      offline: false,
      reason: "",
      unsupported: false,
      loaded: false,
      refreshing: false,
    };
    var flushPromise = null;

    function readCache() {
      try {
        var raw = storage && storage.getItem(CACHE_KEY);
        var parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || parsed.v !== 1) return emptyCache();
        return {
          v: 1,
          savedAt: clean(parsed.savedAt, 80),
          hunts: Array.isArray(parsed.hunts) ? parsed.hunts : [],
          clusters: Array.isArray(parsed.clusters) ? parsed.clusters : [],
          runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        };
      } catch (_) {
        return emptyCache();
      }
    }

    function writeCache() {
      cache.savedAt = new Date(now()).toISOString();
      try {
        if (storage) storage.setItem(CACHE_KEY, JSON.stringify(scrub(cache, 0)));
      } catch (_) {
        /* quota or private mode: the in-memory copy still serves */
      }
    }

    function snapshot() {
      return {
        hunts: cache.hunts.slice(),
        clusters: cache.clusters.slice(),
        offline: status.offline,
        reason: status.reason,
        unsupported: status.unsupported,
        loaded: status.loaded,
        refreshing: status.refreshing,
        cachedAt: cache.savedAt,
      };
    }

    function changed() {
      emit(snapshot());
    }

    function request(method, path, body, timeoutMs) {
      var worker = resolveWorker();
      if (!worker) {
        return Promise.resolve({ ok: false, offline: true, reason: "no_worker" });
      }
      var url = worker.url(path);
      if (!url) {
        return Promise.resolve({ ok: false, offline: true, reason: "no_worker" });
      }
      var headers = Object.assign({}, worker.headers(url));
      if (worker.secret) headers["x-discovery-secret"] = worker.secret;
      if (body) headers["Content-Type"] = "application/json";
      var controller =
        typeof AbortController === "function" ? new AbortController() : null;
      var timedOut = false;
      var timer = setTimeout(function () {
        timedOut = true;
        if (controller) controller.abort();
      }, timeoutMs || REQUEST_TIMEOUT_MS);
      return Promise.resolve()
        .then(function () {
          return fetchImpl(url, {
            method: method,
            mode: "cors",
            headers: headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller ? controller.signal : undefined,
          });
        })
        .then(
          function (response) {
            clearTimeout(timer);
            return Promise.resolve()
              .then(function () {
                return response.json();
              })
              .catch(function () {
                return null;
              })
              .then(function (parsed) {
                var payload = asObject(parsed);
                if (response.ok) {
                  return { ok: true, status: response.status, body: payload };
                }
                return {
                  ok: false,
                  offline: false,
                  status: response.status,
                  code: clean(payload.code, 80),
                  message: clean(payload.message, 400),
                  body: payload,
                  reason:
                    response.status === 401 || response.status === 403
                      ? "unauthorized"
                      : "http_" + response.status,
                };
              });
          },
          function () {
            clearTimeout(timer);
            return {
              ok: false,
              offline: true,
              reason: timedOut ? "timeout" : "unreachable",
            };
          },
        );
    }

    // An older worker answers /hunts with a plain 404: hunts are unsupported
    // there, but its run history still feeds the offline hitlist.
    function isMissingRoute(res) {
      return (
        !res.ok &&
        res.status === 404 &&
        res.code !== "hunt_not_found" &&
        res.code !== "run_not_found"
      );
    }

    function deriveLocalHitlist() {
      if (!hitlistApi || typeof hitlistApi.deriveHitlist !== "function") {
        return Promise.resolve(cache.clusters);
      }
      return hitlistApi
        .deriveHitlist(cache.runs, { now: now(), limit: HITLIST_LIMIT, hunts: cache.hunts })
        .then(function (result) {
          return result.clusters;
        })
        .catch(function () {
          return cache.clusters;
        });
    }

    function refresh() {
      status.refreshing = true;
      changed();
      return Promise.all([
        request("GET", "/hunts"),
        request("GET", "/hunts/hitlist?limit=" + HITLIST_LIMIT),
        request("GET", "/runs?limit=" + RUN_HISTORY_LIMIT),
      ]).then(function (results) {
        var huntsRes = results[0];
        var hitlistRes = results[1];
        var runsRes = results[2];
        status.offline = Boolean(huntsRes.offline && hitlistRes.offline && runsRes.offline);
        status.reason = status.offline
          ? huntsRes.reason
          : !huntsRes.ok
            ? huntsRes.reason
            : "";
        status.unsupported = isMissingRoute(huntsRes);
        if (huntsRes.ok && Array.isArray(huntsRes.body.hunts)) {
          cache.hunts = huntsRes.body.hunts;
        }
        if (runsRes.ok && Array.isArray(runsRes.body.runs)) {
          cache.runs = runsRes.body.runs.map(trimRun).filter(function (run) {
            return run.runId;
          });
        }
        var clusters =
          hitlistRes.ok && Array.isArray(hitlistRes.body.clusters)
            ? Promise.resolve(hitlistRes.body.clusters)
            : deriveLocalHitlist();
        return clusters.then(function (list) {
          cache.clusters = list;
          if (!status.offline) writeCache();
          status.loaded = true;
          status.refreshing = false;
          changed();
          return snapshot();
        });
      });
    }

    /** GET /hunts only: enough for the Runs rows' "Save as hunt" state. */
    function loadHunts() {
      return request("GET", "/hunts").then(function (res) {
        if (!res.ok || !Array.isArray(res.body.hunts)) return false;
        cache.hunts = res.body.hunts;
        writeCache();
        changed();
        return true;
      });
    }

    function mutation(res, apply) {
      if (res.offline) {
        status.offline = true;
        status.reason = res.reason;
        changed();
        return {
          ok: false,
          offline: true,
          reason: res.reason,
          message: "The discovery worker is offline.",
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          code: res.code,
          message: res.message || "The worker refused the change (" + res.reason + ").",
          huntId: clean(res.body && res.body.huntId, 80),
        };
      }
      status.offline = false;
      var out = apply(res.body);
      writeCache();
      changed();
      return out;
    }

    function upsertHunt(hunt) {
      if (!hunt || !hunt.id) return;
      var replaced = false;
      cache.hunts = cache.hunts.map(function (existing) {
        if (existing.id !== hunt.id) return existing;
        replaced = true;
        return hunt;
      });
      if (!replaced) cache.hunts.unshift(hunt);
      cache.clusters = cache.clusters.map(function (cluster) {
        return cluster.key === hunt.searchKey
          ? Object.assign({}, cluster, { huntId: hunt.id })
          : cluster;
      });
    }

    function saveHunt(input) {
      var source = asObject(input);
      var body = {};
      ["fromRunId", "name", "timezone", "sheetId", "status"].forEach(function (key) {
        if (source[key]) body[key] = clean(source[key], key === "name" ? 120 : 200);
      });
      if (source.searchPlan && typeof source.searchPlan === "object") {
        body.searchPlan = source.searchPlan;
      }
      if (source.tweaks && typeof source.tweaks === "object") body.tweaks = source.tweaks;
      if (source.schedule && typeof source.schedule === "object") {
        body.schedule = source.schedule;
      }
      if (source.explorationShare != null) {
        body.explorationShare = Number(source.explorationShare);
      }
      return request("POST", "/hunts", body).then(function (res) {
        return mutation(res, function (payload) {
          upsertHunt(payload.hunt);
          return { ok: true, hunt: payload.hunt };
        });
      });
    }

    function updateHunt(id, patch) {
      var huntId = clean(id, 80);
      return request("POST", "/hunts/" + encodeURIComponent(huntId), asObject(patch)).then(
        function (res) {
          return mutation(res, function (payload) {
            upsertHunt(payload.hunt);
            return { ok: true, hunt: payload.hunt };
          });
        },
      );
    }

    function deleteHunt(id) {
      var huntId = clean(id, 80);
      return request("POST", "/hunts/" + encodeURIComponent(huntId) + "/delete", {}).then(
        function (res) {
          return mutation(res, function () {
            cache.hunts = cache.hunts.filter(function (hunt) {
              return hunt.id !== huntId;
            });
            cache.clusters = cache.clusters.map(function (cluster) {
              return cluster.huntId === huntId
                ? Object.assign({}, cluster, { huntId: null })
                : cluster;
            });
            return { ok: true, id: huntId };
          });
        },
      );
    }

    function runHunt(id) {
      var huntId = clean(id, 80);
      var token = readAccessToken();
      return request(
        "POST",
        "/hunts/" + encodeURIComponent(huntId) + "/run",
        token ? { googleAccessToken: token } : {},
        RUN_NOW_TIMEOUT_MS,
      ).then(function (res) {
        return mutation(res, function (payload) {
          return {
            ok: true,
            kind: clean(payload.kind, 40),
            runId: clean(payload.runId, 200),
            statusPath: clean(payload.statusPath, 400),
            queuedAt: clean(payload.queuedAt, 80),
            message: clean(payload.message, 400),
          };
        });
      });
    }

    function runSearchKey(runId) {
      var id = clean(runId, 200);
      var run = cache.runs.filter(function (entry) {
        return entry.runId === id;
      })[0];
      return run && run.searchKey ? run.searchKey : "";
    }

    /** INTERFACE-HUNTS §8: a run is saved when a hunt came from it or keys like it. */
    function huntForRun(runId, searchKey) {
      var id = clean(runId, 200);
      var key = clean(searchKey, 80) || runSearchKey(id);
      return (
        cache.hunts.filter(function (hunt) {
          return (id && hunt.sourceRunId === id) || (key && hunt.searchKey === key);
        })[0] || null
      );
    }

    function noveltyContext() {
      return {
        history: cache.runs
          .filter(function (run) {
            return run.searchPlan && typeof run.searchPlan === "object";
          })
          .slice(0, NOVELTY_LIMIT)
          .map(function (run) {
            return { selected: asObject(run.searchPlan.selected) };
          }),
      };
    }

    function awaitingLeads(run) {
      var leads = Number(asObject(asObject(run).awaitingSheetWrite).leads);
      return Number.isFinite(leads) && leads > 0 ? leads : 0;
    }

    /**
     * §0.9 / INTERFACE-HUNTS §5: flush every run held as "awaiting sheet
     * write" with the dashboard's token. Single-flight; a 409
     * write_retry_running means another tab is already flushing that run.
     */
    function flushAwaitingSheetWrites() {
      if (flushPromise) return flushPromise;
      var token = readAccessToken();
      if (!token) {
        return Promise.resolve({ ok: false, reason: "signed_out", attempted: 0 });
      }
      flushPromise = request("GET", "/runs?limit=" + RUN_HISTORY_LIMIT)
        .then(function (res) {
          if (!res.ok) return { ok: false, reason: res.reason, attempted: 0 };
          var runs = Array.isArray(res.body.runs) ? res.body.runs : [];
          cache.runs = runs.map(trimRun).filter(function (run) {
            return run.runId;
          });
          writeCache();
          var pending = runs.filter(function (run) {
            return run && run.runId && awaitingLeads(run) > 0;
          });
          var report = { ok: true, attempted: pending.length, flushed: [], skipped: [], failed: [] };
          return pending
            .reduce(function (chain, run) {
              return chain.then(function () {
                var path = "/runs/" + encodeURIComponent(run.runId) + "/retry-write";
                return request(
                  "POST",
                  path,
                  { googleAccessToken: readAccessToken() || token },
                  FLUSH_TIMEOUT_MS,
                ).then(function (write) {
                  if (write.ok) report.flushed.push(run.runId);
                  else if (write.status === 409) report.skipped.push(run.runId);
                  else report.failed.push(run.runId);
                });
              });
            }, Promise.resolve())
            .then(function () {
              return report;
            });
        })
        .then(
          function (report) {
            flushPromise = null;
            if (report.flushed && report.flushed.length) changed();
            return report;
          },
          function () {
            flushPromise = null;
            return { ok: false, reason: "error", attempted: 0 };
          },
        );
      return flushPromise;
    }

    return {
      CHANGED_EVENT: CHANGED_EVENT,
      refresh: refresh,
      loadHunts: loadHunts,
      snapshot: snapshot,
      saveHunt: saveHunt,
      updateHunt: updateHunt,
      deleteHunt: deleteHunt,
      runHunt: runHunt,
      huntForRun: huntForRun,
      noveltyContext: noveltyContext,
      flushAwaitingSheetWrites: flushAwaitingSheetWrites,
    };
  }

  /* ---- the page's store: on open, load the saved hunts and flush (§0.9) ---- */

  var store = createHuntsStore();

  // The worker config and the Google token arrive after boot, so retry on a
  // short backoff (and on the Sheet load event); each step runs once per page.
  function bootOnOpen() {
    var loaded = false;
    var loading = false;
    var flushed = false;
    var attempt = function () {
      if (!defaultResolveWorker()) return;
      if (!loaded && !loading) {
        loading = true;
        store.loadHunts().then(function (ok) {
          loading = false;
          loaded = ok;
        });
      }
      if (!flushed && defaultAccessToken()) {
        store.flushAwaitingSheetWrites().then(function (report) {
          if (report && report.ok) flushed = true;
        });
      }
    };
    FLUSH_RETRY_DELAYS_MS.forEach(function (delay) {
      setTimeout(attempt, delay);
    });
    root.addEventListener("jb:data:loaded", attempt);
  }

  if (root && root.document && typeof root.addEventListener === "function") {
    bootOnOpen();
  }

  return Object.assign({ createHuntsStore: createHuntsStore, CACHE_KEY: CACHE_KEY }, store);
});
