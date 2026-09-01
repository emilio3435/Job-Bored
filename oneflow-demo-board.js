/* ============================================
   Screen S0 — the demo board (ONE-FLOW-ONBOARDING-SPEC §4).

   Principle 1 is "give before you ask": the first screen a keyless
   install shows is the PRODUCT, seeded with curated demo rows, with one
   invitation card over it. The credential-first "no-oauth" opening this
   replaces asked for a Google client id before showing anything at all.

   Two locked decisions shape this file:

     · SUBSTRATE — S0 is a SELF-CONTAINED overlay. It renders its own
       board rather than driving pipeline-render.js, so the real renderer
       never grows a demo mode it has to carry forever.
     · Spec §11.4 — the data is a BUNDLED FIXTURE
       (fixtures/demo-pipeline.json), not a generated sample: cold start
       costs zero AI calls and looks identical for every reader of the
       README.

   Nothing mounts this yet. L6 calls mount() at boot when !getSheetId();
   until then the module is inert (SUBSTRATE locked decision 1).

   Classic-global IIFE under window.JobBoredOneFlowDemoBoard.
   ============================================ */
(function () {
  const root =
    window.JobBoredOneFlowDemoBoard ||
    (window.JobBoredOneFlowDemoBoard = {});

  /** Fixture path L4 seeds the board from (spec §4, locked decision 4). */
  const FIXTURE_PATH = "fixtures/demo-pipeline.json";
  const ROOT_ID = "oneFlowDemoBoard";

  /**
   * "Poke around first" is a session escape, not a permanent one: the
   * pill comes back on the next load so the deal is never silently
   * dropped, but it never nags twice in one sitting (spec §4).
   */
  const PILL_SESSION_KEY = "jobbored_oneflow_demo_pill_collapsed";

  /** Normative copy — spec §4. Ship these strings verbatim (§8). */
  const INVITATION = Object.freeze({
    headline: "This is your job hunt on autopilot.",
    // Rendered as three runs so *your* can be emphasized without the
    // emphasis leaking into the string the spec pins.
    bodyLead: "Set it up once — about fifteen focused minutes — and roles scored against ",
    bodyEmphasis: "your",
    bodyTail: " fit land here every morning.",
    privacy:
      "Your resume and pipeline stay in your Google Sheet and on this machine.",
    primary: "Make it mine — 15 min, once",
    secondary: "Poke around first",
    pill: "Set up JobBored — 15 min ▸",
  });

  /** Board column order — the fixture's stages, in pipeline order. */
  const STAGE_ORDER = Object.freeze([
    ["new", "New"],
    ["researching", "Researching"],
    ["applied", "Applied"],
    ["phone-screen", "Phone Screen"],
    ["interviewing", "Interviewing"],
    ["offer", "Offer"],
  ]);

  let mountEl = null;
  let rows = [];
  let collapsed = false;
  let pipelineListener = null;

  // ---------------------------------------------------------------
  // Tiny DOM helpers — same createEl shape as the wizard shell so the
  // board reads like the rest of the codebase.
  // ---------------------------------------------------------------

  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function session() {
    try {
      return window.sessionStorage || null;
    } catch (_) {
      // Private mode / blocked storage: the invitation is not gated on it.
      return null;
    }
  }

  function readCollapsed() {
    const s = session();
    if (!s) return false;
    try {
      return s.getItem(PILL_SESSION_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function writeCollapsed(value) {
    const s = session();
    if (!s) return;
    try {
      if (value) s.setItem(PILL_SESSION_KEY, "1");
      else s.removeItem(PILL_SESSION_KEY);
    } catch (_) {
      /* storage is a convenience, never a gate */
    }
  }

  function flow() {
    const ns = window.JobBoredOneFlow;
    return ns && typeof ns.open === "function" ? ns : null;
  }

  function openFlow() {
    const f = flow();
    if (f) f.open();
  }

  // ---------------------------------------------------------------
  // The fixture
  // ---------------------------------------------------------------

  /**
   * Load the bundled rows. A failed fetch (file:// open, 404, offline)
   * resolves to [] rather than throwing: the board is the sweetener,
   * the invitation is the point, and losing one must not lose the other.
   */
  async function loadFixture() {
    try {
      const res = await fetch(FIXTURE_PATH, { cache: "no-store" });
      if (!res || !res.ok) return [];
      const data = await res.json();
      const list = data && Array.isArray(data.rows) ? data.rows : [];
      return list.filter((row) => row && typeof row === "object");
    } catch (e) {
      console.warn("[JobBored] S0: could not load the demo fixture:", e);
      return [];
    }
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  function buildCard(row) {
    const card = createEl("article", "oneflow-demo__card");
    card.setAttribute("data-oneflow-demo-key", String(row.jobKey || ""));
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const head = createEl("div", "oneflow-demo__card-head");
    head.appendChild(createEl("span", "oneflow-demo__chip", "DEMO"));
    const score = createEl(
      "span",
      "oneflow-demo__score",
      `${row.fitScore} fit`,
    );
    score.setAttribute("aria-label", `Fit score ${row.fitScore} out of 100`);
    head.appendChild(score);
    card.appendChild(head);

    card.appendChild(createEl("h4", "oneflow-demo__role", row.role));
    card.appendChild(
      createEl(
        "p",
        "oneflow-demo__meta",
        [row.company, row.location].filter(Boolean).join(" · "),
      ),
    );
    card.appendChild(createEl("p", "oneflow-demo__why", row.whyItFits));

    const open = () => renderDetail(row);
    card.addEventListener("click", (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      open();
    });
    card.addEventListener("keydown", (event) => {
      const key = event && event.key;
      if (key !== "Enter" && key !== " ") return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      open();
    });
    return card;
  }

  function buildBoard() {
    const board = createEl("div", "oneflow-demo__board");
    for (const [key, label] of STAGE_ORDER) {
      const inStage = rows.filter((row) => row.stage === key);
      if (!inStage.length) continue;
      const column = createEl("section", "oneflow-demo__column");
      const heading = createEl("h3", "oneflow-demo__column-title", label);
      const count = createEl(
        "span",
        "oneflow-demo__column-count",
        String(inStage.length),
      );
      heading.appendChild(count);
      column.appendChild(heading);
      for (const row of inStage) column.appendChild(buildCard(row));
      board.appendChild(column);
    }
    return board;
  }

  /**
   * Read-only detail (spec §4: "Demo cards open read-only detail views").
   * Deliberately renders no control: a demo card that offers Save or Move
   * would promise a write the fixture cannot keep.
   */
  function renderDetail(row) {
    if (!mountEl) return null;
    const slot = mountEl.querySelector(".oneflow-demo__detail-slot");
    if (!slot) return null;
    const detail = createEl("aside", "oneflow-demo__detail");
    detail.setAttribute("aria-readonly", "true");
    detail.setAttribute("aria-label", `${row.role} at ${row.company} — demo detail`);
    detail.appendChild(createEl("span", "oneflow-demo__chip", "DEMO"));
    detail.appendChild(createEl("h4", "oneflow-demo__detail-role", row.role));
    detail.appendChild(
      createEl(
        "p",
        "oneflow-demo__detail-meta",
        [row.company, row.location, row.postedAgo].filter(Boolean).join(" · "),
      ),
    );
    detail.appendChild(
      createEl("p", "oneflow-demo__detail-score", `Fit ${row.fitScore} / 100`),
    );
    detail.appendChild(createEl("p", "oneflow-demo__detail-why", row.whyItFits));
    detail.appendChild(
      createEl(
        "p",
        "oneflow-demo__detail-note",
        "Sample data — your own roles land here once you're set up.",
      ),
    );
    // One slot, replaced rather than stacked: clicking a second card shows
    // that card, never two panels fighting for the same corner.
    slot.replaceChildren(detail);
    return detail;
  }

  function buildAction(className, label, onClick) {
    const btn = createEl("button", className, label);
    btn.type = "button";
    btn.setAttribute("data-oneflow-demo-action", "1");
    btn.addEventListener("click", (event) => {
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      onClick();
    });
    return btn;
  }

  function buildInvitation() {
    const card = createEl("div", "oneflow-demo__invite");
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", "Set up JobBored");
    card.appendChild(
      createEl("h2", "oneflow-demo__invite-headline", INVITATION.headline),
    );
    const body = createEl("p", "oneflow-demo__invite-body");
    body.append(
      createEl("span", "", INVITATION.bodyLead),
      createEl("em", "", INVITATION.bodyEmphasis),
      createEl("span", "", INVITATION.bodyTail),
    );
    card.appendChild(body);
    card.appendChild(
      createEl("p", "oneflow-demo__invite-privacy", INVITATION.privacy),
    );
    const actions = createEl("div", "oneflow-demo__invite-actions");
    actions.appendChild(
      buildAction(
        "oneflow-demo__invite-action oneflow-demo__invite-action--primary",
        INVITATION.primary,
        openFlow,
      ),
    );
    actions.appendChild(
      buildAction(
        "oneflow-demo__invite-action oneflow-demo__invite-action--ghost",
        INVITATION.secondary,
        collapseToPill,
      ),
    );
    card.appendChild(actions);
    return card;
  }

  function buildPill() {
    return buildAction("oneflow-demo__pill", INVITATION.pill, openFlow);
  }

  /** Re-render the ask half only — the board underneath never reflows. */
  function renderAsk() {
    if (!mountEl) return;
    const ask = mountEl.querySelector(".oneflow-demo__ask");
    if (!ask) return;
    ask.replaceChildren(collapsed ? buildPill() : buildInvitation());
    ask.classList.toggle("oneflow-demo__ask--collapsed", collapsed);
  }

  function collapseToPill() {
    collapsed = true;
    writeCollapsed(true);
    renderAsk();
  }

  // ---------------------------------------------------------------
  // Exit (spec §4): the first real Sheet row replaces the fixture.
  // ---------------------------------------------------------------

  /**
   * Call-only read of the pipeline's own row list — the demo board asks
   * the controller whether real data has landed rather than inspecting
   * the renderer's DOM, so nothing here breaks when the board changes.
   */
  function hasRealRows() {
    try {
      const controller =
        window.JobBoredApp && window.JobBoredApp.pipelineController;
      if (!controller || typeof controller.getPipelineData !== "function") {
        return false;
      }
      const data = controller.getPipelineData();
      return Array.isArray(data) && data.length > 0;
    } catch (_) {
      return false;
    }
  }

  function onPipelineRendered() {
    if (!mountEl) return;
    if (hasRealRows()) unmount();
  }

  // ---------------------------------------------------------------
  // Mount / unmount
  // ---------------------------------------------------------------

  /**
   * Render S0 over the dashboard. Async because the fixture is fetched;
   * resolves to the overlay root (or null when the page has no body to
   * mount into).
   */
  async function mount() {
    if (mountEl) return mountEl;
    rows = await loadFixture();
    collapsed = readCollapsed();
    const body = document.body;
    if (!body) return null;

    const el = createEl("div", "oneflow-demo oneflow-demo--watermarked");
    el.id = ROOT_ID;
    el.setAttribute("data-oneflow-demo", "1");
    if (rows.length) {
      const note = createEl(
        "p",
        "oneflow-demo__note",
        "Sample pipeline — this is what a set-up JobBored looks like.",
      );
      el.appendChild(note);
      el.appendChild(buildBoard());
    }
    el.appendChild(createEl("div", "oneflow-demo__detail-slot"));
    const ask = createEl("div", "oneflow-demo__ask");
    el.appendChild(ask);
    body.appendChild(el);
    mountEl = el;
    renderAsk();

    if (typeof document.addEventListener === "function") {
      pipelineListener = onPipelineRendered;
      document.addEventListener("jb:pipeline:rendered", pipelineListener);
    }
    return mountEl;
  }

  function unmount() {
    if (pipelineListener && typeof document.removeEventListener === "function") {
      document.removeEventListener("jb:pipeline:rendered", pipelineListener);
    }
    pipelineListener = null;
    const el = mountEl;
    mountEl = null;
    if (el) el.remove();
  }

  /** True while the fixture board is the live board (spec §4 "Exit"). */
  function isActive() {
    return !!mountEl;
  }

  Object.assign(root, {
    FIXTURE_PATH,
    ROOT_ID,
    PILL_SESSION_KEY,
    INVITATION,
    STAGE_ORDER,
    loadFixture,
    mount,
    unmount,
    isActive,
    // Test seam: the pipeline listener, callable without a real DOM event.
    _onPipelineRendered: onPipelineRendered,
  });
})();
