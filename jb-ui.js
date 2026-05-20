// jb-ui.js — JobBored v2 UI primitives (Forge / Phase 2)
// ------------------------------------------------------------
// Vanilla custom elements registered on import:
//   <jb-fit-ring percent size? label?>
//   <jb-spark data width? height? color? fill? label?>
//   <jb-stage-dot stage label?>
//   <jb-ai-chip variant? icon?>...slot...</jb-ai-chip>
//   <jb-kbd keys>
//
// Plus a CSS-only .jb-sticker primitive (see jb-ui.css).
//
// Self-registers on load. ESM module. No deps. Light DOM only so
// `body.jb-v2` cascade reaches contents and downstream agents can
// style without piercing shadow DOM. Outside `body.jb-v2` every
// element is hidden via display:none in jb-ui.css.

const SVG_NS = "http://www.w3.org/2000/svg";

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
   <jb-spark>
   ============================================================ */

class JbSpark extends HTMLElement {
  static get observedAttributes() {
    return ["data", "width", "height", "color", "fill", "label"];
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
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "jb-spark__svg");
    svg.setAttribute("preserveAspectRatio", "none");
    const area = document.createElementNS(SVG_NS, "polygon");
    area.setAttribute("class", "jb-spark__area");
    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("class", "jb-spark__line");
    line.setAttribute("fill", "none");
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("class", "jb-spark__dot");
    svg.appendChild(area);
    svg.appendChild(line);
    svg.appendChild(dot);
    this.appendChild(svg);
    this._svg = svg;
    this._area = area;
    this._line = line;
    this._dot = dot;
    this._built = true;
  }

  _parseData(raw) {
    if (!raw) return [];
    const trimmed = String(raw).trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          return arr.map((v) => Number(v)).filter((v) => Number.isFinite(v));
        }
      } catch {
        /* fall through to CSV */
      }
    }
    return trimmed
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((v) => Number.isFinite(v));
  }

  _render() {
    const width = Math.max(1, Number(this.getAttribute("width")) || 60);
    const height = Math.max(1, Number(this.getAttribute("height")) || 16);
    const data = this._parseData(this.getAttribute("data"));
    const colorName = (this.getAttribute("color") || "mint").replace(
      /[^a-z0-9-]/gi,
      "",
    );
    const colorVar = `var(--jb-${colorName || "mint"})`;
    const fillAttr = this.getAttribute("fill");
    const fillOn = fillAttr === null ? true : fillAttr !== "false";
    const labelAttr = this.getAttribute("label");

    this._svg.setAttribute("width", String(width));
    this._svg.setAttribute("height", String(height));
    this._svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this._line.setAttribute("stroke", colorVar);
    this._line.setAttribute("stroke-width", "1.5");
    this._line.setAttribute("stroke-linecap", "round");
    this._line.setAttribute("stroke-linejoin", "round");
    this._dot.setAttribute("r", "2");
    this._dot.setAttribute("fill", colorVar);

    if (labelAttr) {
      this.setAttribute("role", "img");
      this.setAttribute("aria-label", labelAttr);
      this.removeAttribute("aria-hidden");
    } else {
      this.setAttribute("aria-hidden", "true");
      this.removeAttribute("role");
      this.removeAttribute("aria-label");
    }

    const pad = 1.5;
    const innerW = Math.max(0.0001, width - pad * 2);
    const innerH = Math.max(0.0001, height - pad * 2);

    let points;
    let dotX;
    let dotY;

    if (data.length === 0) {
      const y = height / 2;
      points = `${pad},${y} ${width - pad},${y}`;
      dotX = width - pad;
      dotY = y;
    } else if (data.length === 1) {
      const y = height / 2;
      const x = width / 2;
      points = `${x},${y}`;
      dotX = x;
      dotY = y;
    } else {
      let min = Infinity;
      let max = -Infinity;
      for (const v of data) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const range = max - min;
      const step = innerW / (data.length - 1);
      const coords = data.map((v, i) => {
        const x = pad + step * i;
        const norm = range === 0 ? 0.5 : (v - min) / range;
        const y = pad + (1 - norm) * innerH;
        return [x, y];
      });
      points = coords.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
      const last = coords[coords.length - 1];
      dotX = last[0];
      dotY = last[1];
    }

    this._line.setAttribute("points", points);
    this._dot.setAttribute("cx", dotX.toFixed(2));
    this._dot.setAttribute("cy", dotY.toFixed(2));

    if (fillOn && data.length >= 2) {
      const baseY = height - pad;
      const firstX = pad;
      const lastX = width - pad;
      const areaPoints = `${firstX},${baseY} ${points} ${lastX},${baseY}`;
      this._area.setAttribute("points", areaPoints);
      this._area.setAttribute(
        "fill",
        `color-mix(in srgb, ${colorVar} 18%, transparent)`,
      );
      this._area.setAttribute("stroke", "none");
      this._area.style.display = "";
    } else {
      this._area.style.display = "none";
    }
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
   <jb-kbd>
   ============================================================ */

const KEY_PRETTY = {
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  shift: "⇧",
  alt: "⌥",
  option: "⌥",
  ctrl: "⌃",
  control: "⌃",
  esc: "Esc",
  escape: "Esc",
  enter: "Enter",
  return: "Enter",
  tab: "Tab",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

function prettyKey(raw) {
  const k = raw.trim();
  if (!k) return "";
  const lower = k.toLowerCase();
  if (KEY_PRETTY[lower]) return KEY_PRETTY[lower];
  if (k.length === 1) return k.toUpperCase();
  return k;
}

class JbKbd extends HTMLElement {
  static get observedAttributes() {
    return ["keys"];
  }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    const raw = this.getAttribute("keys") || "";
    const parts = raw
      .split("+")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    this.textContent = "";
    parts.forEach((part, i) => {
      const chip = document.createElement("span");
      chip.className = "jb-kbd__key";
      chip.textContent = prettyKey(part);
      this.appendChild(chip);
      if (i < parts.length - 1) {
        const sep = document.createElement("span");
        sep.className = "jb-kbd__sep";
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "·";
        this.appendChild(sep);
      }
    });
    this.setAttribute("role", "group");
    this.setAttribute("aria-label", parts.join(" plus "));
  }
}

/* ============================================================
   Self-register
   ============================================================ */

if (!customElements.get("jb-fit-ring")) customElements.define("jb-fit-ring", JbFitRing);
if (!customElements.get("jb-spark")) customElements.define("jb-spark", JbSpark);
if (!customElements.get("jb-stage-dot")) customElements.define("jb-stage-dot", JbStageDot);
if (!customElements.get("jb-ai-chip")) customElements.define("jb-ai-chip", JbAiChip);
if (!customElements.get("jb-kbd")) customElements.define("jb-kbd", JbKbd);

export { JbFitRing, JbSpark, JbStageDot, JbAiChip, JbKbd };
