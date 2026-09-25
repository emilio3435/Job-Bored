// jb-ui.js — JobBored v2 UI primitives (Forge / Phase 2)
// ------------------------------------------------------------
// Vanilla custom elements registered on import:
//   <jb-fit-ring percent size? label?>
//   <jb-stage-dot stage label?>
//   <jb-ai-chip variant? icon?>...slot...</jb-ai-chip>
//
// Plus a CSS-only .jb-sticker primitive (see jb-ui.css).
//
// Self-registers on load. ESM module. No deps. Light DOM only so
// `body.jb-v2` cascade reaches contents and downstream agents can
// style without piercing shadow DOM. Outside `body.jb-v2` every
// element is hidden via display:none in jb-ui.css.


/* ============================================================
   <jb-fit-ring>
   ============================================================ */

const RING_SIZES = { sm: 24, md: 36, lg: 56 };

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function tierVar(percent) {
  if (percent >= 75) return "var(--jb-fit-high)";
  if (percent >= 50) return "var(--jb-fit-mid)";
  return "var(--jb-fit-low)";
}

class JbFitRing extends HTMLElement {
  static get observedAttributes() {
    return ["percent", "size", "label"];
  }

  constructor() {
    super();
    this._built = false;
  }

  connectedCallback() {
    if (!this._built) this._build();
    this._render();
  }

  attributeChangedCallback() {
    if (!this._built) return;
    this._render();
  }

  _build() {
    this.textContent = "";
    const ring = document.createElement("span");
    ring.className = "jb-fit-ring__ring";
    const inner = document.createElement("span");
    inner.className = "jb-fit-ring__inner";
    const text = document.createElement("span");
    text.className = "jb-fit-ring__text";
    text.textContent = `${clampPercent(this.getAttribute("percent"))}%`;
    inner.appendChild(text);
    ring.appendChild(inner);
    this.appendChild(ring);
    this._ring = ring;
    this._text = text;
    this._built = true;
  }

  _render() {
    const percent = clampPercent(this.getAttribute("percent"));
    const sizeKey = this.getAttribute("size") || "md";
    const px = RING_SIZES[sizeKey] || RING_SIZES.md;
    const inset = Math.max(2, Math.round(px * 0.12));
    const color = tierVar(percent);
    const labelAttr = this.getAttribute("label");
    const label = labelAttr || `Fit ${percent}%`;

    this.setAttribute("role", "meter");
    this.setAttribute("aria-valuemin", "0");
    this.setAttribute("aria-valuemax", "100");
    this.setAttribute("aria-valuenow", String(percent));
    this.setAttribute("aria-label", label);
    this.dataset.size = sizeKey in RING_SIZES ? sizeKey : "md";

    this.style.setProperty("--jb-ring-size", `${px}px`);
    this.style.setProperty("--jb-ring-inset", `${inset}px`);
    this.style.setProperty("--jb-ring-color", color);
    this.style.setProperty("--jb-ring-angle", `${(percent / 100) * 360}deg`);

    this._text.textContent = labelAttr ? labelAttr : `${Math.round(percent)}%`;
  }
}

/* ============================================================
   <jb-stage-dot>
   ============================================================ */

const STAGES = new Set([
  "new",
  "researching",
  "applied",
  "phone",
  "interviewing",
  "offer",
  "rejected",
  "passed",
]);

class JbStageDot extends HTMLElement {
  static get observedAttributes() {
    return ["stage", "label"];
  }

  connectedCallback() {
    if (!this._built) {
      this._slottedText = this.textContent.trim();
      this.textContent = "";
      this._dot = document.createElement("span");
      this._dot.className = "jb-stage-dot__dot";
      this._dot.setAttribute("aria-hidden", "true");
      this._labelEl = document.createElement("span");
      this._labelEl.className = "jb-stage-dot__label";
      this.appendChild(this._dot);
      this.appendChild(this._labelEl);
      this._built = true;
    }
    this._render();
  }

  attributeChangedCallback() {
    if (this._built) this._render();
  }

  _render() {
    const stageRaw = (this.getAttribute("stage") || "").trim().toLowerCase();
    const stage = STAGES.has(stageRaw) ? stageRaw : "";
    this.setAttribute("data-stage", stage || "unknown");

    const labelAttr = this.getAttribute("label");
    const labelText =
      labelAttr != null && labelAttr !== ""
        ? labelAttr
        : this._slottedText || "";

    if (labelText) {
      this._labelEl.textContent = labelText;
      this._labelEl.hidden = false;
      this.setAttribute("role", "status");
    } else {
      this._labelEl.textContent = "";
      this._labelEl.hidden = true;
      this.setAttribute("role", "img");
    }
    this.setAttribute("aria-label", `Stage: ${stage || "unknown"}`);
  }
}

/* ============================================================
   <jb-ai-chip>
   ============================================================ */

const AI_VARIANTS = new Set(["default", "summary", "tip", "warn"]);
const AI_ICON_DEFAULTS = {
  default: "✦",
  summary: "❝",
  tip: "☼",
  warn: "⚠",
};

class JbAiChip extends HTMLElement {
  static get observedAttributes() {
    return ["variant", "icon"];
  }

  connectedCallback() {
    if (!this._built) {
      const frag = document.createDocumentFragment();
      while (this.firstChild) frag.appendChild(this.firstChild);
      this._iconEl = document.createElement("span");
      this._iconEl.className = "jb-ai-chip__icon";
      this._iconEl.setAttribute("aria-hidden", "true");
      this._textEl = document.createElement("span");
      this._textEl.className = "jb-ai-chip__text";
      this._textEl.appendChild(frag);
      this.appendChild(this._iconEl);
      this.appendChild(this._textEl);
      this._built = true;
    }
    this._render();
    this._updateAria();
  }

  attributeChangedCallback() {
    if (this._built) {
      this._render();
      this._updateAria();
    }
  }

  _render() {
    const variantRaw = (this.getAttribute("variant") || "default")
      .trim()
      .toLowerCase();
    const variant = AI_VARIANTS.has(variantRaw) ? variantRaw : "default";
    this.setAttribute("data-variant", variant);
    const iconOverride = this.getAttribute("icon");
    const icon =
      iconOverride && iconOverride.length > 0
        ? iconOverride
        : AI_ICON_DEFAULTS[variant];
    this._iconEl.textContent = icon;
  }

  _updateAria() {
    this.setAttribute("role", "note");
    const text = (this._textEl?.textContent || "").trim();
    this.setAttribute("aria-label", `AI: ${text}`);
  }
}

/* ============================================================
   Self-register
   ============================================================ */

if (!customElements.get("jb-fit-ring")) customElements.define("jb-fit-ring", JbFitRing);
if (!customElements.get("jb-stage-dot")) customElements.define("jb-stage-dot", JbStageDot);
if (!customElements.get("jb-ai-chip")) customElements.define("jb-ai-chip", JbAiChip);

// Loaded as a classic <script defer> (see index.html), NOT a module — an ES
// `export` here is a SyntaxError that aborts the entire file and unregisters
// every component above. Components are exposed globally via customElements.
