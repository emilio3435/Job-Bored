// UX01 design-system lens — static CSS measurement.
// Run from the worktree root:  node <this file> [--json out.json]
// Reads the stylesheets index.html links, in load order, and measures
// colours, font sizes, spacing, radii, shadows, z-index, !important, and
// custom-property definitions/uses per file and in total.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const html = readFileSync(join(ROOT, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");
const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);

const NAMED = {
  white: [255, 255, 255, 1], black: [0, 0, 0, 1], red: [255, 0, 0, 1], transparent: null,
  gray: [128, 128, 128, 1], grey: [128, 128, 128, 1], orange: [255, 165, 0, 1],
  green: [0, 128, 0, 1], blue: [0, 0, 255, 1], yellow: [255, 255, 0, 1],
};
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
function norm(r, g, b, a = 1) {
  const h = (x) => Math.round(x).toString(16).padStart(2, "0");
  const A = Math.round(a * 1000) / 1000;
  return A === 1 ? `#${h(r)}${h(g)}${h(b)}` : `#${h(r)}${h(g)}${h(b)}/${A}`;
}
const COLOR_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black|red|gray|grey|orange|green|blue|yellow)\b/g;
function parseColor(tok) {
  tok = tok.trim();
  if (tok[0] === "#") {
    let x = tok.slice(1);
    if (x.length <= 4) x = [...x].map((c) => c + c).join("");
    const r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16);
    const a = x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1;
    return norm(r, g, b, a);
  }
  const low = tok.toLowerCase();
  if (NAMED[low]) return norm(...NAMED[low]);
  const nums = (tok.match(/-?[\d.]+%?/g) || []);
  if (nums.some((n) => false)) return null;
  if (/var\(/.test(tok)) return null;
  const val = (n, pct255) => (n.endsWith("%") ? (parseFloat(n) / 100) * pct255 : parseFloat(n));
  if (low.startsWith("rgb")) {
    if (nums.length < 3) return null;
    const a = nums[3] != null ? (nums[3].endsWith("%") ? parseFloat(nums[3]) / 100 : parseFloat(nums[3])) : 1;
    return norm(val(nums[0], 255), val(nums[1], 255), val(nums[2], 255), a);
  }
  if (low.startsWith("hsl")) {
    if (nums.length < 3) return null;
    const [r, g, b] = hslToRgb(parseFloat(nums[0]), parseFloat(nums[1]), parseFloat(nums[2]));
    const a = nums[3] != null ? (nums[3].endsWith("%") ? parseFloat(nums[3]) / 100 : parseFloat(nums[3])) : 1;
    return norm(r, g, b, a);
  }
  return null;
}

function stripComments(s) { return s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")); }
// Declarations: property: value inside braces (not selectors). Walk braces.
function declarations(src) {
  const out = [];
  const s = stripComments(src);
  let depth = 0, buf = "", line = 1, bufLine = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") line++;
    if (c === "{") { depth++; buf = ""; bufLine = line; continue; }
    if (c === "}") { pushDecl(buf, bufLine); depth = Math.max(0, depth - 1); buf = ""; bufLine = line; continue; }
    if (c === ";" && depth > 0) { pushDecl(buf, bufLine); buf = ""; bufLine = line; continue; }
    if (!buf.trim()) bufLine = line;
    buf += c;
  }
  function pushDecl(b, ln) {
    const m = b.match(/^\s*(--[\w-]+|[a-z-]+)\s*:\s*([\s\S]+)$/i);
    if (m) out.push({ prop: m[1].toLowerCase(), value: m[2].trim(), line: ln });
  }
  return out;
}
function selectorsOf(src) {
  const s = stripComments(src);
  return (s.match(/[^{}]+(?=\{)/g) || []).map((x) => x.trim()).filter((x) => x && !x.startsWith("@") && !/^\d+%|^from|^to/.test(x));
}

const SPACING_PROPS = /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/;
const RADIUS_PROPS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
function splitTop(v) { // split by whitespace at top level (not in parens)
  const out = []; let d = 0, cur = "";
  for (const c of v) {
    if (c === "(") d++; if (c === ")") d--;
    if (/\s/.test(c) && d === 0) { if (cur) out.push(cur); cur = ""; } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
function splitComma(v) {
  const out = []; let d = 0, cur = "";
  for (const c of v) { if (c === "(") d++; if (c === ")") d--; if (c === "," && d === 0) { out.push(cur.trim()); cur = ""; } else cur += c; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const per = [];
const total = {
  colorLit: new Set(), colorLitCount: 0, colorVarUses: 0, fontSize: new Set(), fontSizeLit: new Set(), spacing: new Set(),
  spacingLit: new Set(), radius: new Set(), radiusLit: new Set(), shadow: new Set(), z: new Set(), important: 0,
  rules: 0, decls: 0,
};
const defs = new Map(); // name -> [{file,line,value,scope}]
const uses = new Map(); // name -> count
const usesByFile = new Map();
const COLOR_PROPS = /color|background|border|outline|fill|stroke|shadow|caret|accent|decoration|column-rule/;

for (const f of sheets) {
  const path = join(ROOT, f);
  if (!existsSync(path)) { per.push({ file: f, missing: true }); continue; }
  const src = readFileSync(path, "utf8");
  const decls = declarations(src);
  const sels = selectorsOf(src);
  const r = {
    file: f, bytes: src.length, lines: src.split("\n").length, rules: sels.length, decls: decls.length,
    colorLit: new Set(), colorLitCount: 0, colorVarUses: 0, fontSize: new Set(), fontSizeLit: new Set(), spacing: new Set(), spacingLit: new Set(),
    radius: new Set(), radiusLit: new Set(), shadow: new Set(), z: new Set(), important: 0, jbUses: 0, legacyUses: 0, defs: 0,
    v2Scoped: sels.filter((s) => /body\.jb-v2/.test(s)).length,
  };
  for (const d of decls) {
    const v = d.value.replace(/\s*!important\s*$/i, "");
    if (/!important/i.test(d.value)) r.important++;
    for (const m of v.matchAll(/var\(\s*(--[\w-]+)/g)) {
      uses.set(m[1], (uses.get(m[1]) || 0) + 1);
      if (!usesByFile.has(m[1])) usesByFile.set(m[1], new Set());
      usesByFile.get(m[1]).add(f);
      if (m[1].startsWith("--jb-")) r.jbUses++; else r.legacyUses++;
    }
    if (d.prop.startsWith("--")) {
      if (!defs.has(d.prop)) defs.set(d.prop, []);
      defs.get(d.prop).push({ file: f, line: d.line, value: v });
      r.defs++;
    }
    if (d.prop.startsWith("--") || COLOR_PROPS.test(d.prop)) {
      const vNoFn = v;
      for (const m of vNoFn.matchAll(COLOR_RE)) {
        if (m[0].startsWith("#") && d.prop.startsWith("--") === false && /url\(/.test(v)) continue;
        const c = parseColor(m[0]);
        if (c) { r.colorLit.add(c); r.colorLitCount++; }
      }
      if (!d.prop.startsWith("--")) r.colorVarUses += (v.match(/var\(/g) || []).length;
    }
    if (d.prop === "font-size" || (d.prop === "font" && /\d/.test(v))) {
      const key = d.prop === "font" ? (v.match(/[\d.]+(px|rem|em)|var\([^)]*\)|clamp\([^)]*\)/) || [v])[0] : v;
      r.fontSize.add(key); if (!/^var\(/.test(key)) r.fontSizeLit.add(key);
    }
    if (SPACING_PROPS.test(d.prop)) for (const t of splitTop(v)) { if (t === "0" || t === "auto" || t === "0px") continue; r.spacing.add(t); if (!/^var\(/.test(t) && !/^calc\(/.test(t)) r.spacingLit.add(t); }
    if (RADIUS_PROPS.test(d.prop)) for (const t of splitTop(v.replace(/\//g, " "))) { if (t === "0") continue; r.radius.add(t); if (!/^var\(/.test(t)) r.radiusLit.add(t); }
    if (d.prop === "box-shadow" && v !== "none") r.shadow.add(v.replace(/\s+/g, " "));
    if (d.prop === "z-index") r.z.add(v);
  }
  per.push(r);
  for (const k of ["colorLit", "fontSize", "fontSizeLit", "spacing", "spacingLit", "radius", "radiusLit", "shadow", "z"]) for (const x of r[k]) total[k].add(x);
  total.colorLitCount += r.colorLitCount; total.colorVarUses += r.colorVarUses; total.important += r.important; total.rules += r.rules; total.decls += r.decls;
}

// Custom properties set from JS / HTML (style.setProperty, inline style="--x: …")
const jsDefs = new Set();
const jsUses = new Set();
function scanText(t) {
  for (const m of t.matchAll(/setProperty\(\s*["'`](--[\w-]+)/g)) jsDefs.add(m[1]);
  for (const m of t.matchAll(/(?:^|[;"'`\s{])(--[a-zA-Z][\w-]*)\s*:/g)) jsDefs.add(m[1]);
  for (const m of t.matchAll(/var\(\s*(--[\w-]+)/g)) jsUses.add(m[1]);
  for (const m of t.matchAll(/getPropertyValue\(\s*["'`](--[\w-]+)/g)) jsUses.add(m[1]);
}
for (const f of readdirSync(ROOT).filter((x) => x.endsWith(".js") || x.endsWith(".html"))) scanText(readFileSync(join(ROOT, f), "utf8"));
for (const f of readdirSync(join(ROOT, "partials"))) scanText(readFileSync(join(ROOT, "partials", f), "utf8"));

const ns = (n) => (n.startsWith("--jb-") ? "jb" : "legacy");
const rootDefs = (file) => [...defs].filter(([, arr]) => arr.some((d) => d.file === file));
const styleRoot = new Set(rootDefs("style.css").map(([n]) => n));
const v2Root = new Set(rootDefs("tokens-v2.css").map(([n]) => n));
const defined = new Set([...defs.keys(), ...jsDefs]);
const referenced = new Set([...uses.keys(), ...jsUses]);
const neverUsed = [...defs.keys()].filter((n) => !referenced.has(n));
const undefinedRefs = [...uses.keys()].filter((n) => !defined.has(n));
const multiDef = [...defs].filter(([, arr]) => new Set(arr.map((d) => d.file)).size > 1);
const redefDiffVal = multiDef.filter(([, arr]) => new Set(arr.map((d) => d.value)).size > 1);
const aliases = [...defs].filter(([, arr]) => arr.some((d) => /^var\(--[\w-]+\)$/.test(d.value)));

// Duplicate values across the two systems: same normalised colour in style.css :root and tokens-v2
const colorOf = (arr) => { const v = arr[0].value; const m = v.match(COLOR_RE); return m && m[0] === v.trim() ? parseColor(v) : null; };
const v2Colors = new Map([...defs].filter(([n]) => v2Root.has(n) && n.startsWith("--jb-")).map(([n, a]) => [n, colorOf(a.filter((d) => d.file === "tokens-v2.css"))]).filter(([, c]) => c));
const v2ColorVals = new Map(); for (const [n, c] of v2Colors) { if (!v2ColorVals.has(c)) v2ColorVals.set(c, []); v2ColorVals.get(c).push(n); }
const v2SameValue = [...v2ColorVals].filter(([, ns]) => ns.length > 1);

// Uses of legacy tokens in files that are v2-era
const legacyTokenUsesByFile = {};
const jbTokenUsesByFile = {};
for (const [n, files] of usesByFile) for (const f of files) {
  const o = n.startsWith("--jb-") ? jbTokenUsesByFile : legacyTokenUsesByFile;
  o[f] = (o[f] || 0) + 1;
}

const fmt = (r) => [r.file, r.lines, r.rules, r.v2Scoped, r.colorLit.size, r.colorLitCount, r.colorVarUses, r.fontSize.size, r.fontSizeLit.size, r.spacing.size, r.spacingLit.size, r.radius.size, r.shadow.size, r.z.size, r.important, r.jbUses, r.legacyUses, r.defs];
const head = ["file", "lines", "rules", "v2-scoped rules", "distinct colour literals", "colour literal occurrences", "colour var() uses", "distinct font-sizes", "  of which literal", "distinct spacing", "  of which literal", "distinct radii", "distinct shadows", "distinct z-index", "!important", "var(--jb-*) uses", "var(--legacy) uses", "custom-prop defs"];
console.log("| " + head.join(" | ") + " |");
console.log("|" + head.map(() => "---").join("|") + "|");
for (const r of per) console.log(r.missing ? `| ${r.file} | MISSING |` : "| " + fmt(r).join(" | ") + " |");
console.log(`| **TOTAL (distinct across all 36)** | | ${total.rules} | | ${total.colorLit.size} | ${total.colorLitCount} | ${total.colorVarUses} | ${total.fontSize.size} | ${total.fontSizeLit.size} | ${total.spacing.size} | ${total.spacingLit.size} | ${total.radius.size} | ${total.shadow.size} | ${total.z.size} | ${total.important} | | | |`);
console.log();
console.log("sheets linked:", sheets.length);
console.log("custom props defined (CSS):", defs.size, " — jb:", [...defs.keys()].filter((n) => ns(n) === "jb").length, " legacy/other:", [...defs.keys()].filter((n) => ns(n) !== "jb").length);
console.log("style.css defines:", styleRoot.size, " tokens-v2.css defines:", v2Root.size);
console.log("defined in >1 file:", multiDef.length, " of those with differing values:", redefDiffVal.length);
console.log("aliases (value is a bare var(--x)):", aliases.length);
console.log("tokens-v2 colour tokens sharing an identical value with another tokens-v2 token:", v2SameValue.map(([c, n]) => `${c}=${n.join("|")}`).join("; "));
console.log("defined but never referenced (CSS+JS+HTML):", neverUsed.length);
console.log("   of which in style.css:", neverUsed.filter((n) => styleRoot.has(n)).length, " in tokens-v2.css:", neverUsed.filter((n) => v2Root.has(n)).length);
console.log("   style.css never-used:", neverUsed.filter((n) => styleRoot.has(n)).join(" "));
console.log("   tokens-v2 never-used:", neverUsed.filter((n) => v2Root.has(n)).join(" "));
console.log("referenced but never defined (no CSS def, no JS setProperty/inline):", undefinedRefs.length);
console.log("   ", undefinedRefs.map((n) => `${n}(${uses.get(n)}x in ${[...usesByFile.get(n)].join(",")})`).join("  "));
console.log("style.css token uses per file (distinct legacy tokens referenced):", JSON.stringify(legacyTokenUsesByFile));
console.log("jb token uses per file (distinct --jb- tokens referenced):", JSON.stringify(jbTokenUsesByFile));
console.log("multi-file defs w/ differing values (first 40):");
for (const [n, arr] of redefDiffVal.slice(0, 40)) console.log("   ", n, arr.map((d) => `${d.file}:${d.line}=${d.value.slice(0, 40)}`).join("  ||  "));
console.log("\nALL distinct font-size values:", [...total.fontSize].sort().join("  ‖  "));
console.log("\nALL distinct z-index:", [...total.z].sort((a, b) => parseFloat(a) - parseFloat(b)).join(", "));
console.log("\nALL distinct radii literals:", [...total.radiusLit].sort().join(", "));
if (process.argv.includes("--json")) writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify({ per: per.map((r) => ({ ...r, colorLit: [...(r.colorLit || [])] })), totalColors: [...total.colorLit] }, null, 1));

// Undefined refs: with vs without a fallback, with file:line
console.log("\nUNDEFINED REFS — occurrences without a fallback (these resolve to the property's initial/inherited value):");
let nofb = 0, withfb = 0;
for (const f of sheets) {
  const p = join(ROOT, f); if (!existsSync(p)) continue;
  const lines = stripComments(readFileSync(p, "utf8")).split("\n");
  lines.forEach((l, i) => {
    for (const m of l.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
      if (!undefinedRefs.includes(m[1])) continue;
      if (m[2]) withfb++; else { nofb++; console.log(`   ${f}:${i + 1}  ${l.trim().slice(0, 110)}`); }
    }
  });
}
console.log(`undefined-ref occurrences: ${withfb} with fallback, ${nofb} without`);
