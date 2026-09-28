/* ============================================
   Beat "Your details" of the one-flow onboarding — right after the resume.

   The name and contact block every resume and cover letter prints comes
   from what the user confirms here, not from whatever resume text is
   attached to an application (a garbled resume once printed the name
   "Candidate" with only a phone number).

   The form (profile-identity.js) pre-fills from the resume B3 just read:
   POST /profile/contact/suggest parses it and returns each field with a
   confidence; nothing is saved until the user presses Confirm. Skipping
   is allowed — the beat records the skip and stays unchecked on the
   spine, so setup keeps showing it as unfinished.

   Where the confirmed details go: the fit profile does not exist yet (B4
   saves it next), so they ride the flow's persisted draft `contactDraft`
   and B4's save carries them into profile.json's `identity`. When a
   profile already exists (a re-entry), they are also saved straight away
   through POST /profile/contact.

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
    // "idle" → "running" → "done": the pre-fill runs once per page load.
    prefill: "idle",
    // Whether profile.json exists yet: before B4 saves it, there is
    // nothing for POST /profile/contact to write into.
    profileExists: false,
    note: "",
    prefilled: false,
    saving: false,
  };

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
   * Fill the form once per load: the user's own draft first (a refresh
   * mid-beat), then the saved profile (a re-entry), then the resume. Each
   * later source fills only what the earlier ones left empty, and nothing
   * overwrites a field the user has typed in.
   */
  async function prefill(ctx) {
    const lib = api();
    if (!lib || state.prefill !== "idle") return;
    state.prefill = "running";
    state.note = READING_MESSAGE;
    paintNote();
    const draft = contactDraft(ctx);
    let found = false;
    try {
      const saved = await lib.fetchSaved();
      state.profileExists = !!(saved && saved.exists);
      if (saved && saved.contact && Object.keys(saved.contact).length) {
        fillEmpty(lib.toValues(saved.contact));
        found = true;
      }
      const result = await lib.suggest(resumeText(ctx));
      const values = result && result.values ? result.values : null;
      if (values && Object.keys(values).length) {
        fillEmpty(lib.toValues(values), {
          provenance: true,
          confidence: lib.confidenceOf(result.suggestions),
        });
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
    if (!state.values) {
      const draft = contactDraft(ctx);
      if (draft) state.values = draft.values;
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
    persist(ctx, true);
    if (ctx.runtime) ctx.runtime.contactIdentity = contact;
    let serverSaved = false;
    let rejected = null;
    // Only a profile that exists can take them now; before B4 saves one,
    // the draft carries them there and B4's save writes them.
    if (state.profileExists) {
      try {
        ctx.setBusy(ACTION_CONFIRM, [{ label: "Saving your details…", state: "active" }]);
        const result = await lib.save(contact);
        if (result.ok) serverSaved = true;
        else if (result.reason === "rejected") rejected = result.errors;
      } finally {
        ctx.clearBusy();
      }
    }
    state.saving = false;
    if (rejected) {
      if (ctx.runtime) delete ctx.runtime.contactIdentity;
      persist(ctx, false);
      refuse(ctx, rejected, "JobBored couldn't save these. Fix the highlighted fields.");
      return;
    }
    ctx.setMessage("", "info");
    await ctx.completeBeat({
      prefilled: state.prefilled,
      fields: Object.keys(contact).length,
      serverSaved,
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
