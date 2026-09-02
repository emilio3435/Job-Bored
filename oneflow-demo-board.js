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

   SIXBEATS V1 (claim U1) rebuilt the surface this renders: a page header
   strip carrying the wordmark and the sample-pipeline kicker, a FRAMED
   board whose cards speak the product's card language (paper, stage
   rail, DEMO chip, fit pill, "why it fits"), and the invitation as the
   visual centre of gravity — on the board, never opened collapsed.

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
   * "Poke around first" is an escape for THIS visit only. It used to be
   * remembered in sessionStorage, which is how the founder's cold start
   * (SIXBEATS claim U1) opened on a corner pill over an empty viewport:
   * the whole deal had been silently reduced to a 200 px button by a
   * click from a previous page load. A fresh load now always opens on
   * the invitation; the pill is only ever a state the visitor chose in
   * the session they are looking at.
   */

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

  /**
   * The framed board's own head, from the approved prototype's screen S0
   * ("Pipeline" · "8 roles · demo data"). It names what the frame holds so
   * the demo reads as the product's board rather than as loose cards.
   */
  const BOARD = Object.freeze({
    title: "Pipeline",
    /** @param {number} count */
    count: (count) => `${count} roles · demo data`,
    kicker: "Sample pipeline — this is what a set-up JobBored looks like.",
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

  /**
   * Which fit band a score reads in — the same three-band split the
   * product's own --jb-fit-high / -mid / -low tokens encode, so a demo
   * card and a real card never disagree about what "strong" looks like.
   */
  function fitBand(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return "low";
    if (value >= 85) return "high";
    if (value >= 70) return "mid";
    return "low";
  }

  /**
   * The stage a row belongs to, as a class suffix. Unknown stages fall
   * back to "new" so a hand-edited fixture never renders a railless card.
   */
  function stageKey(row) {
    const key = String((row && row.stage) || "");
    return STAGE_ORDER.some(([id]) => id === key) ? key : "new";
  }

  function buildCard(row) {
    const stage = stageKey(row);
    const card = createEl(
      "article",
      `oneflow-demo__card oneflow-demo__card--stage-${stage}`,
    );
    card.setAttribute("data-oneflow-demo-key", String(row.jobKey || ""));
    card.setAttribute("data-oneflow-demo-stage", stage);
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");

    const head = createEl("div", "oneflow-demo__card-head");
    head.appendChild(createEl("span", "oneflow-demo__chip", "DEMO"));
    // The fit pill, in the prototype's shape ("92% fit") — the number is
    // the whole reason a stranger reads the card, so it gets the pill.
    const score = createEl(
      "span",
      `oneflow-demo__score oneflow-demo__score--${fitBand(row.fitScore)}`,
      `${row.fitScore}% fit`,
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
      const inStage = rows.filter((row) => stageKey(row) === key);
      if (!inStage.length) continue;
      const column = createEl(
        "section",
        `oneflow-demo__column oneflow-demo__column--${key}`,
      );
      column.setAttribute("data-oneflow-demo-stage", key);
      const heading = createEl("h3", "oneflow-demo__column-title");
      // The stage dot repeats the card's rail colour at the column head,
      // which is how the real board tells stages apart at a glance.
      heading.appendChild(createEl("span", "oneflow-demo__column-dot"));
      heading.appendChild(createEl("span", "oneflow-demo__column-label", label));
      heading.appendChild(
        createEl(
          "span",
          "oneflow-demo__column-count",
          String(inStage.length),
        ),
      );
      column.appendChild(heading);
      for (const row of inStage) column.appendChild(buildCard(row));
      board.appendChild(column);
    }
    return board;
  }

  /**
   * The wordmark, as markup rather than as the top bar's 200-line inline
   * SVG: a mint mark plus the two-weight "Job|Bored" lockup. Same lockup,
   * one element, and it scales down to the collapsed pill unchanged.
   */
  function buildWordmark() {
    const lockup = createEl("span", "oneflow-demo__wordmark");
    const text = createEl("span", "oneflow-demo__wordmark-text");
    lockup.appendChild(buildMark("oneflow-demo__wordmark-mark"));
    text.append(
      createEl("span", "oneflow-demo__wordmark-job", "Job"),
      createEl("span", "oneflow-demo__wordmark-bored", "Bored"),
    );
    lockup.appendChild(text);
    return lockup;
  }

  /** The mark alone — CSS-drawn, and deliberately textless so a control
      that carries it keeps its own label as its accessible name. */
  function buildMark(className) {
    const glyph = createEl("span", `oneflow-demo__mark ${className || ""}`.trim());
    glyph.setAttribute("aria-hidden", "true");
    return glyph;
  }

  /**
   * The page header strip. The shipped S0 opened on a bare kanban with
   * no chrome at all (SIXBEATS claim U1); this is the one line of chrome
   * that tells a stranger whose product they are looking at, and that
   * what is under it is a sample.
   */
  function buildHeader() {
    const header = createEl("header", "oneflow-demo__header");
    const inner = createEl("div", "oneflow-demo__header-inner");
    inner.appendChild(buildWordmark());
    if (rows.length) {
      inner.appendChild(createEl("p", "oneflow-demo__note", BOARD.kicker));
    }
    header.appendChild(inner);
    return header;
  }

  /**
   * The framed board: the product's own board, in a frame, with the ask
   * on top of it. The frame is what turns "some cards on a page" into
   * "this is the screen you are buying".
   */
  function buildFrame() {
    const frame = createEl("div", "oneflow-demo__frame");
    const head = createEl("div", "oneflow-demo__frame-head");
    head.appendChild(createEl("h2", "oneflow-demo__frame-title", BOARD.title));
    head.appendChild(
      createEl("span", "oneflow-demo__frame-count", BOARD.count(rows.length)),
    );
    frame.appendChild(head);
    frame.appendChild(buildBoard());
    frame.appendChild(createEl("div", "oneflow-demo__ask"));
    return frame;
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

  /**
   * The collapsed ask. It is a designed re-entry, not a leftover button:
   * the mark keeps the product present on a board the visitor is only
   * browsing, and the label still names the deal and its price. Clicking
   * it opens the flow (spec §4 "reopens the flow").
   */
  function buildPill() {
    const pill = buildAction("oneflow-demo__pill", null, openFlow);
    pill.appendChild(buildMark("oneflow-demo__pill-mark"));
    pill.appendChild(createEl("span", "oneflow-demo__pill-label", INVITATION.pill));
    return pill;
  }

  /** The frame with nothing to frame: the ask, still centred and framed. */
  function buildAskOnly() {
    const frame = createEl(
      "div",
      "oneflow-demo__frame oneflow-demo__frame--bare",
    );
    frame.appendChild(createEl("div", "oneflow-demo__ask"));
    return frame;
  }

  /** Re-render the ask half only — the board underneath never reflows. */
  function renderAsk() {
    if (!mountEl) return;
    const ask = mountEl.querySelector(".oneflow-demo__ask");
    if (!ask) return;
    ask.replaceChildren(collapsed ? buildPill() : buildInvitation());
    ask.classList.toggle("oneflow-demo__ask--collapsed", collapsed);
    ask.classList.toggle("oneflow-demo__ask--open", !collapsed);
  }

  function collapseToPill() {
    collapsed = true;
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
    // Always open on the invitation: a remembered collapse is what made
    // the founder's cold start a corner pill over an empty page (U1).
    collapsed = false;
    const body = document.body;
    if (!body) return null;

    const el = createEl("div", "oneflow-demo oneflow-demo--watermarked");
    el.id = ROOT_ID;
    el.setAttribute("data-oneflow-demo", "1");
    el.appendChild(buildHeader());
    // No fixture (file:// open, 404) means no board — but the frame still
    // holds the ask, so the screen degrades to an invitation, not a void.
    el.appendChild(rows.length ? buildFrame() : buildAskOnly());
    el.appendChild(createEl("div", "oneflow-demo__detail-slot"));
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
    INVITATION,
    BOARD,
    STAGE_ORDER,
    loadFixture,
    mount,
    unmount,
    isActive,
    // Test seam: the pipeline listener, callable without a real DOM event.
    _onPipelineRendered: onPipelineRendered,
  });
})();
