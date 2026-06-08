/* ============================================
   JobBored — Shared Wizard DOM helpers
   Pure body-builder helpers usable by ANY wizard rendered through
   discovery-wizard-shell.js (the original discovery wizard, plus
   the new go-live wizard). Copied + generalized from
   discovery-wizard-ui.js's inline helpers — the discovery file's
   own helpers stay untouched (no regression surface).

   Classic-global IIFE under window.JobBoredWizardDom. Loaded as a
   plain <script> tag before any wizard module that consumes it.
   No host bridge required; clipboard support is best-effort via
   navigator.clipboard or a caller-provided onCopy handler.

   The class names match the discovery wizard so the shared CSS
   (.discovery-setup-wizard__*) styles every wizard identically.
   ============================================ */
(() => {
  const w = typeof window !== "undefined" ? window : globalThis;
  const dom = w.JobBoredWizardDom || (w.JobBoredWizardDom = {});

  function createWizardNode(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function appendWizardParagraph(
    parent,
    text,
    className = "discovery-setup-wizard__copy",
  ) {
    if (!text) return null;
    const p = createWizardNode("p", className, text);
    parent.appendChild(p);
    return p;
  }

  function appendWizardList(parent, items) {
    const list = createWizardNode("ul", "discovery-setup-wizard__list");
    (Array.isArray(items) ? items : [])
      .filter(Boolean)
      .forEach((item) => {
        const li = document.createElement("li");
        li.textContent = String(item);
        list.appendChild(li);
      });
    parent.appendChild(list);
    return list;
  }

  function defaultCopyToClipboard(text) {
    try {
      if (
        w.navigator &&
        w.navigator.clipboard &&
        typeof w.navigator.clipboard.writeText === "function"
      ) {
        w.navigator.clipboard.writeText(String(text));
      }
    } catch (_) {
      /* best-effort; callers can pass onCopy for a richer flow */
    }
  }

  function appendWizardCodeBlock(parent, text, copyLabel = "Copy", onCopy) {
    if (!text) return null;
    const row = createWizardNode("div", "scraper-setup-copyrow");
    const code = createWizardNode("pre", "scraper-setup-code", text);
    const button = createWizardNode("button", "btn-copy-scraper", copyLabel);
    button.type = "button";
    button.addEventListener("click", () => {
      if (typeof onCopy === "function") {
        onCopy(text);
      } else {
        defaultCopyToClipboard(text);
      }
    });
    row.append(code, button);
    parent.appendChild(row);
    return row;
  }

  function appendWizardCallout(parent, text) {
    if (!text) return null;
    const card = createWizardNode("div", "discovery-setup-wizard__callout");
    appendWizardParagraph(card, text, "discovery-setup-wizard__callout-text");
    parent.appendChild(card);
    return card;
  }

  function appendWizardInput(parent, options) {
    const o = options && typeof options === "object" ? options : {};
    const wrap = createWizardNode("div", "discovery-wizard-field");
    const label = createWizardNode("label", "field-label", o.label || "");
    if (o.id) label.htmlFor = o.id;
    const input =
      o.multiline === true
        ? createWizardNode("textarea", "modal-input modal-textarea")
        : createWizardNode("input", "modal-input");
    if (o.id) input.id = o.id;
    if (o.multiline !== true) {
      input.type = o.type || "text";
    } else if (Number.isFinite(o.rows)) {
      input.rows = o.rows;
    } else {
      input.rows = 3;
    }
    input.placeholder = o.placeholder || "";
    input.value = o.value || "";
    input.addEventListener("input", (event) => {
      if (typeof o.onInput === "function") {
        o.onInput(String((event.target && event.target.value) || ""));
      }
    });
    wrap.append(label, input);
    if (o.hint) {
      appendWizardParagraph(
        wrap,
        o.hint,
        "settings-field-hint settings-field-hint--compact",
      );
    }
    parent.appendChild(wrap);
    return input;
  }

  function appendWizardResultCard(parent, result, titleOverride) {
    if (!result || typeof result !== "object") return null;
    const tone =
      result.ok === true
        ? result.kind === "stub_only"
          ? "warning"
          : "success"
        : "warning";
    const card = createWizardNode(
      "div",
      `discovery-setup-wizard__summary-card discovery-setup-wizard__summary-card--${tone}`,
    );
    appendWizardParagraph(
      card,
      titleOverride || result.message || "Latest result",
      "discovery-setup-wizard__card-title",
    );
    if (result.detail) {
      appendWizardParagraph(card, result.detail, "discovery-setup-wizard__copy");
    }
    if (result.remediation) {
      const lines = String(result.remediation)
        .split("\n")
        .filter((l) => l.trim());
      if (lines.length > 1) {
        const intro = lines[0];
        const steps = lines.slice(1);
        appendWizardParagraph(
          card,
          intro,
          "discovery-setup-wizard__copy discovery-setup-wizard__copy--bold",
        );
        const ol = createWizardNode(
          "ol",
          "discovery-setup-wizard__list discovery-setup-wizard__list--ordered",
        );
        steps.forEach((step) => {
          const li = document.createElement("li");
          li.textContent = String(step).replace(/^\d+\.\s*/, "");
          ol.appendChild(li);
        });
        card.appendChild(ol);
      } else {
        appendWizardParagraph(
          card,
          `Next step: ${result.remediation}`,
          "discovery-setup-wizard__copy",
        );
      }
    }
    parent.appendChild(card);
    return card;
  }

  Object.assign(dom, {
    createWizardNode,
    appendWizardParagraph,
    appendWizardList,
    appendWizardCodeBlock,
    appendWizardCallout,
    appendWizardInput,
    appendWizardResultCard,
  });
})();
