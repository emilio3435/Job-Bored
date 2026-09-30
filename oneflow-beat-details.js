/* ============================================
   Beat "Your details" of the one-flow onboarding — right after the resume.

   The name and contact block every resume and cover letter prints comes
   from what the user confirms here, not from whatever resume text is
   attached to an application (a garbled resume once printed the name
   "Candidate" with only a phone number).

   The form (profile-identity.js) pre-fills from the resume B3 just read,
   and from nothing else (JOBQA): POST /profile/contact/suggest parses the
   STAGED resume text only and returns each field with a confidence. It
   never reads the saved profile or the saved resume, which on a shared
   machine may be another person's. Skipping is allowed — the beat records
   the skip and stays unchecked on the spine, so setup keeps showing it as
   unfinished.

   Where the confirmed details go: Confirm keeps them in the flow's
   persisted draft `contactDraft`; nothing is saved here. B4's one commit
   (POST /profile/commit) writes them into profile.json's `identity`
   together with the resume and the profile.

   Classic-global IIFE, registered against window.JobBoredOneFlow.
   ============================================ */
(function () {
  const flow = window.JobBoredOneFlow;
  if (!flow || typeof flow.registerBeat !== "function") return;

  const HEADLINE = "Is this you? Check your name and contact details.";
  const SUB =
    "They go at the top of every resume and cover letter JobBored drafts. " +
    "We filled in what we found on your resume — fix anything that's off, " +
    "then confirm.";

  const ACTION_CONFIRM = "details_confirm";
  const ACTION_SKIP = "details_skip";

  const READING_MESSAGE = "Reading your resume for your details…";
  const EMPTY_MESSAGE =
    "We couldn't find your details on your resume. Fill in what you'd like on it.";

  /**
   * The beat's state. The shell re-renders the whole step on every
   * setMessage / setBusy, so the FORM is disposable and everything worth
   * keeping lives here: the values, which fields came from the resume, the
   * errors on show and how far the pre-fill got. The persisted copy is the
   * flow draft `contactDraft`.
   */
  const state = {
    form: null,
    values: null,
    provenance: {},
    errors: [],
    // "idle" → "running" → "done": the pre-fill runs once per staged resume.
    prefill: "idle",
    // The staged resume text the pre-fill last read, and what it suggested:
    // a different resume re-reads, clearing only fields still holding the
    // old suggestions (what the user typed stays).
    prefillText: null,
    suggested: {},
    note: "",
    prefilled: false,
    saving: false,
    // JOBQA: the account scope this state was built under, and the pre-fill
    // run that owns the screen; an answer from an older one is dropped.
    scope: null,
    prefillRun: 0,
  };

  /** A different account's setup: nothing typed or suggested before carries over. */
  function resetState() {
    state.form = null;
    state.values = null;
    state.provenance = {};
    state.errors = [];
    state.prefill = "idle";
    state.prefillText = null;
    state.suggested = {};
    state.note = "";
    state.prefilled = false;
    state.saving = false;
    state.prefillRun += 1;
  }

  function api() {
    return window.JobBoredProfileIdentity || null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function drafts(ctx) {
    const runtime = (ctx && ctx.runtime) || {};
    return runtime.drafts && typeof runtime.drafts === "object" ? runtime.drafts : {};
  }

  /** The draft this beat owns, or null. */
  function contactDraft(ctx) {
    const d = drafts(ctx).contactDraft;
    return d && typeof d === "object" && d.values && typeof d.values === "object" ? d : null;
  }

  function resumeText(ctx) {
    const d = drafts(ctx);
    return typeof d.resumeText === "string" ? d.resumeText : "";
  }

  /** Pull the live form into state (the form may be replaced any time). */
  function capture() {
    if (!state.form) return;
    state.values = state.form.getValues();
    state.provenance = state.form.getProvenance();
  }

  function persist(ctx, confirmed) {
    const lib = api();
    if (!lib || !state.values || !ctx || typeof ctx.saveDraft !== "function") return;
    try {
      ctx.saveDraft("contactDraft", {
        values: state.values,
        contact: lib.toContact(state.values),
        confirmed: !!confirmed,
        prefilled: state.prefilled,
      });
    } catch (err) {
      console.warn("[JobBored] one-flow details saveDraft:", err);
    }
  }

  function paintNote() {
    const form = state.form;
    if (!form || !form.root) return;
    form.root.dataset.prefill = state.prefill === "done" ? "done" : "pending";
    const note = form.root.parentNode && form.root.parentNode.querySelector(".oneflow-details__status");
    if (note) {
      note.textContent = state.note;
      note.hidden = !state.note;
    }
  }

  /** Lay `values` over the live form and state, filling only empty fields. */
  function fillEmpty(values, options) {
    if (!state.form || !values) return;
    state.form.setValues(values, Object.assign({ onlyEmpty: true }, options || {}));
    capture();
  }

  /**
   * A different staged resume than the pre-fill last read: clear the fields
   * that still hold its suggestions, so the new resume fills them.
   */
  function forgetStaleSuggestions() {
    if (!state.values || typeof state.values !== "object") return;
    const next = Object.assign({}, state.values);
    for (const [key, value] of Object.entries(state.suggested || {})) {
      if (JSON.stringify(next[key]) === JSON.stringify(value)) delete next[key];
    }
    state.values = next;
    state.provenance = {};
    state.suggested = {};
    state.prefilled = false;
    if (state.form) state.form = null;
  }

  /**
   * Fill the form from what this setup was given: the user's own draft
   * first (a refresh mid-beat), then suggestions parsed from the staged
   * resume. The saved profile and the saved resume are never read here
   * (JOBQA). Suggestions fill only empty fields, so nothing overwrites a
   * field the user has typed in.
   */
  async function prefill(ctx) {
    const lib = api();
    if (!lib || state.prefill !== "idle") return;
    state.prefill = "running";
    state.note = READING_MESSAGE;
    paintNote();
    const draft = contactDraft(ctx);
    const text = resumeText(ctx);
    const run = (state.prefillRun += 1);
    const scope = ctx.scope;
    state.prefillText = text;
    let found = false;
    try {
      const result = text ? await lib.suggest(text) : null;
      // A newer pre-fill, or another account's setup, owns the screen now.
      if (run !== state.prefillRun || (typeof ctx.isCurrentScope === "function" && !ctx.isCurrentScope(scope))) return;
      const values = result && result.values ? result.values : null;
      if (values && Object.keys(values).length) {
        const suggested = lib.toValues(values);
        fillEmpty(suggested, {
          provenance: true,
          confidence: lib.confidenceOf(result.suggestions),
        });
        state.suggested = suggested;
        state.prefilled = true;
        found = true;
      }
    } catch (err) {
      console.warn("[JobBored] one-flow details prefill:", err);
    }
    state.prefill = "done";
    state.note = found || draft ? "" : EMPTY_MESSAGE;
    if (state.values) persist(ctx, false);
    paintNote();
  }

  function render(container, ctx) {
    const lib = api();
    const root = el("div", "oneflow-details");
    if (!lib) {
      root.appendChild(
        el("p", "oneflow-details__note", "This step didn't load. Skip it for now and add your details in Settings."),
      );
      container.appendChild(root);
      return;
    }
    if (state.scope !== null && state.scope !== ctx.scope) resetState();
    state.scope = ctx.scope;
    if (!state.values) {
      const draft = contactDraft(ctx);
      if (draft) state.values = draft.values;
    }
    if (state.prefill === "done" && state.prefillText !== null && state.prefillText !== resumeText(ctx)) {
      forgetStaleSuggestions();
      state.prefill = "idle";
    }
    const status = el("p", "oneflow-details__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.appendChild(status);
    state.form = lib.renderForm(root, {
      headingLevel: "h3",
      values: state.values,
      onChange() {
        capture();
        state.errors = [];
        persist(ctx, false);
      },
    });
    state.form.restoreProvenance(state.provenance);
    if (state.errors.length) state.form.showErrors(state.errors);
    root.appendChild(
      el(
        "p",
        "oneflow-details__privacy",
        "Your details stay on this computer, in your JobBored profile. They're " +
          "printed on your materials and never sent to job discovery.",
      ),
    );
    container.appendChild(root);
    paintNote();
    if (state.prefill === "idle") prefill(ctx);
  }

  /** Show errors in a way that survives the shell's re-render. */
  function refuse(ctx, errors, message) {
    state.errors = errors;
    ctx.setMessage(message, "error");
    if (state.form) {
      state.form.showErrors(errors);
      state.form.focusFirstInvalid();
    }
  }

  async function confirm(ctx) {
    const lib = api();
    if (!lib || !state.form || state.saving) return;
    capture();
    const problems = lib.validate(lib.toContact(state.values));
    if (problems.length) {
      refuse(ctx, problems, "Fix the highlighted fields, or skip this step for now.");
      return;
    }
    state.errors = [];
    state.saving = true;
    const contact = lib.toContact(state.values);
    // JOBQA: confirmed into the draft only; B4's commit saves them.
    persist(ctx, true);
    if (ctx.runtime) ctx.runtime.contactIdentity = contact;
    state.saving = false;
    ctx.setMessage("", "info");
    await ctx.completeBeat({
      prefilled: state.prefilled,
      fields: Object.keys(contact).length,
    });
  }

  function skip(ctx) {
    capture();
    persist(ctx, false);
    return ctx.skipBeat({ beat: "details" });
  }

  flow.registerBeat({
    id: "details",
    // Between the resume (3) and the fit review (4): the other beats keep
    // the orders their tests pin.
    order: 3.5,
    label: "Your details",
    timeLabel: "about 10 min left",
    headline: HEADLINE,
    sub: SUB,
    actions: [
      { id: ACTION_CONFIRM, label: "Confirm my details →", variant: "primary" },
      { id: ACTION_SKIP, label: "Skip for now", variant: "ghost" },
    ],
    render,
    onAction(actionId, ctx) {
      if (actionId === ACTION_CONFIRM) return confirm(ctx);
      if (actionId === ACTION_SKIP) return skip(ctx);
      return undefined;
    },
  });

  window.JobBoredOneFlowBeatDetails = {
    HEADLINE,
    SUB,
    ACTION_CONFIRM,
    ACTION_SKIP,
    getForm() {
      return state.form;
    },
  };
})();
