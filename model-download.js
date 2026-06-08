/* ============================================
   COMMAND CENTER v2 — Download model control

   Reusable control that pulls an Ollama model from the browser. Surfaced in
   the Settings `local` provider panel; reused by the first-run wizard's local
   step. Detects Ollama via GET /api/tags and streams a pull via POST /api/pull
   (NDJSON progress), so a local-provider user can fetch gemma4:e2b without a
   terminal.

   Classic-global IIFE under window.CommandCenterModelDownload — NOT an ES
   module. The browser at localhost:8080 reaches Ollama cross-origin by default
   (no OLLAMA_ORIGINS needed for localhost).
   ============================================ */
(function () {
  const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
  const DEFAULT_ROOT = "http://127.0.0.1:11434";

  function getFetch(opts) {
    if (opts && typeof opts.fetch === "function") return opts.fetch;
    return fetch;
  }

  /**
   * Ollama's native API (/api/tags, /api/pull) lives at the host root, while
   * the resume provider talks to the OpenAI-compatible `/v1` path. Derive the
   * root origin from the configured base URL.
   */
  function getOllamaRoot(baseUrl) {
    const raw = String(baseUrl || DEFAULT_BASE_URL).trim();
    try {
      return new URL(raw).origin;
    } catch (_) {
      return DEFAULT_ROOT;
    }
  }

  function ollamaHostHint(baseUrl) {
    try {
      return new URL(getOllamaRoot(baseUrl)).host || "127.0.0.1:11434";
    } catch (_) {
      return "127.0.0.1:11434";
    }
  }

  /** GET /api/tags → { reachable, models: string[] }. Never throws. */
  async function detectOllama(baseUrl, opts) {
    const root = getOllamaRoot(baseUrl);
    const doFetch = getFetch(opts);
    try {
      const resp = await doFetch(`${root}/api/tags`, {
        method: "GET",
        cache: "no-store",
      });
      if (!resp || !resp.ok) {
        return { reachable: false, models: [], status: resp ? resp.status : 0 };
      }
      const data = await resp.json().catch(() => ({}));
      const models = Array.isArray(data && data.models)
        ? data.models
            .map((m) => (m && typeof m.name === "string" ? m.name : ""))
            .filter(Boolean)
        : [];
      return { reachable: true, models };
    } catch (_) {
      return { reachable: false, models: [] };
    }
  }

  function hasModelInstalled(models, model) {
    if (!Array.isArray(models) || !model) return false;
    const want = String(model).trim().toLowerCase();
    return models.some((m) => {
      const got = String(m).trim().toLowerCase();
      return got === want || got === `${want}:latest`;
    });
  }

  function parsePullLine(line) {
    const s = String(line || "").trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch (_) {
      return null;
    }
  }

  /** Translate a raw pull event into a label + clamped integer percent. */
  function describePullEvent(evt) {
    if (!evt || typeof evt !== "object") return { label: "", percent: null };
    const label = typeof evt.status === "string" ? evt.status : "";
    const completed = Number(evt.completed);
    const total = Number(evt.total);
    let percent = null;
    if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
      percent = Math.max(
        0,
        Math.min(100, Math.round((completed / total) * 100)),
      );
    }
    return { label, percent };
  }

  /** Read a fetch Response body as NDJSON, invoking onEvent per parsed line. */
  async function consumeNdjsonStream(resp, onEvent) {
    const events = [];
    const handle = (line) => {
      const evt = parsePullLine(line);
      if (!evt) return;
      events.push(evt);
      try {
        onEvent(evt);
      } catch (_) {
        /* progress callbacks must not abort the stream */
      }
    };
    const body = resp && resp.body;
    if (body && typeof body.getReader === "function") {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          handle(buffer.slice(0, nl));
          buffer = buffer.slice(nl + 1);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handle(buffer);
      return events;
    }
    if (resp && typeof resp.text === "function") {
      const text = await resp.text();
      text.split(/\r?\n/).forEach(handle);
    }
    return events;
  }

  /**
   * POST /api/pull with { model, stream: true } and stream NDJSON progress.
   * onProgress receives { status, completed, total, percent, label, raw } per
   * event. Resolves { ok, events, last } on terminal success; rejects with an
   * actionable message when Ollama is unreachable or the pull fails.
   */
  async function pullModel(baseUrl, model, opts) {
    const options = opts || {};
    const root = getOllamaRoot(baseUrl);
    const doFetch = getFetch(options);
    const onProgress =
      typeof options.onProgress === "function" ? options.onProgress : () => {};
    const hostHint = ollamaHostHint(baseUrl);
    if (!model) throw new Error("Pick a model to download.");

    let resp;
    try {
      resp = await doFetch(`${root}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
        signal: options.signal,
      });
    } catch (_) {
      throw new Error(
        `Could not reach Ollama at ${root}. Start Ollama (open the Ollama app, or run \`ollama serve\`) on ${hostHint}, then try again.`,
      );
    }

    if (!resp || !resp.ok) {
      let detail = "";
      try {
        const data = await resp.json();
        detail = data && data.error ? String(data.error) : "";
      } catch (_) {
        /* no JSON body */
      }
      throw new Error(
        detail
          ? `Ollama could not pull "${model}": ${detail}`
          : `Ollama could not pull "${model}" (HTTP ${resp ? resp.status : 0}).`,
      );
    }

    const events = await consumeNdjsonStream(resp, (evt) => {
      const d = describePullEvent(evt);
      onProgress({
        status: d.label,
        completed: Number(evt.completed),
        total: Number(evt.total),
        percent: d.percent,
        label: d.label,
        raw: evt,
      });
    });

    const errored = events.find((e) => e && e.error);
    if (errored) {
      throw new Error(`Ollama pull failed: ${errored.error}`);
    }
    const succeeded = events.some(
      (e) =>
        e &&
        typeof e.status === "string" &&
        e.status.toLowerCase() === "success",
    );
    if (!succeeded) {
      throw new Error(
        `Ollama did not confirm "${model}" finished downloading. Try again.`,
      );
    }
    return { ok: true, events, last: events[events.length - 1] };
  }

  /**
   * Mount the Download-model control into `container`. Builds a button +
   * status line + progress bar (once, idempotently) and wires the click to
   * detectOllama → pullModel. The base URL and model are read lazily via the
   * provided getters so the live Settings/wizard field values are always used.
   *
   * @param {object} cfg
   * @param {HTMLElement} cfg.container
   * @param {() => string} [cfg.getBaseUrl]
   * @param {() => string} [cfg.getModel]
   * @param {(model:string)=>void} [cfg.onSuccess]
   * @param {typeof fetch} [cfg.fetch]
   */
  function mountDownloadModelControl(cfg) {
    const c = cfg || {};
    const container = c.container;
    if (!container || typeof container.appendChild !== "function") return null;
    const getBaseUrl =
      typeof c.getBaseUrl === "function"
        ? c.getBaseUrl
        : () => DEFAULT_BASE_URL;
    const getModel =
      typeof c.getModel === "function" ? c.getModel : () => "gemma4:e2b";

    if (container.dataset && container.dataset.downloadControlBound === "true") {
      return container.__downloadModelControl || null;
    }

    const doc = container.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;

    const wrap = doc.createElement("div");
    wrap.className = "model-download-control";

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "btn-modal-secondary model-download-control__btn";
    btn.setAttribute("data-role", "download-model-btn");
    btn.textContent = "Download model";

    const progress = doc.createElement("progress");
    progress.className = "model-download-control__progress";
    progress.setAttribute("data-role", "download-model-progress");
    progress.max = 100;
    progress.hidden = true;

    const status = doc.createElement("p");
    status.className =
      "settings-field-hint settings-field-hint--compact model-download-control__status";
    status.setAttribute("data-role", "download-model-status");
    status.setAttribute("role", "status");
    status.hidden = true;

    wrap.appendChild(btn);
    wrap.appendChild(progress);
    wrap.appendChild(status);
    container.appendChild(wrap);

    const setStatus = (text, tone) => {
      status.hidden = !text;
      status.textContent = text || "";
      status.dataset.tone = tone || "";
    };
    const setProgress = (percent) => {
      if (percent == null || Number.isNaN(percent)) {
        progress.removeAttribute("value");
      } else {
        progress.value = percent;
      }
    };

    let running = false;
    btn.addEventListener("click", async () => {
      if (running) return;
      const baseUrl = getBaseUrl() || DEFAULT_BASE_URL;
      const model = getModel() || "gemma4:e2b";
      running = true;
      btn.disabled = true;
      const originalLabel = btn.textContent;
      btn.textContent = "Checking Ollama…";
      progress.hidden = true;
      setProgress(null);
      setStatus("", "");

      const detected = await detectOllama(baseUrl, { fetch: c.fetch });
      if (!detected.reachable) {
        running = false;
        btn.disabled = false;
        btn.textContent = originalLabel;
        setStatus(
          `Ollama isn't reachable at ${ollamaHostHint(baseUrl)}. Open the Ollama app (or run \`ollama serve\`), then try again.`,
          "error",
        );
        return;
      }
      const alreadyInstalled = hasModelInstalled(detected.models, model);

      btn.textContent = "Downloading…";
      progress.hidden = false;
      setProgress(null);
      setStatus(`Starting download of "${model}"…`, "");
      try {
        await pullModel(baseUrl, model, {
          fetch: c.fetch,
          onProgress: (p) => {
            setProgress(p.percent);
            const pct = p.percent != null ? ` ${p.percent}%` : "";
            setStatus(`${p.label || "Downloading"}${pct}`, "");
          },
        });
        setProgress(100);
        setStatus(
          alreadyInstalled
            ? `"${model}" is verified and ready to use locally.`
            : `"${model}" downloaded — ready to use locally.`,
          "success",
        );
        if (typeof c.onSuccess === "function") c.onSuccess(model);
      } catch (err) {
        progress.hidden = true;
        setStatus((err && err.message) || "Download failed.", "error");
      } finally {
        running = false;
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });

    if (container.dataset) container.dataset.downloadControlBound = "true";
    const api = { button: btn, status, progress };
    container.__downloadModelControl = api;
    return api;
  }

  window.CommandCenterModelDownload = {
    getOllamaRoot,
    ollamaHostHint,
    detectOllama,
    hasModelInstalled,
    parsePullLine,
    describePullEvent,
    consumeNdjsonStream,
    pullModel,
    mountDownloadModelControl,
  };
})();
