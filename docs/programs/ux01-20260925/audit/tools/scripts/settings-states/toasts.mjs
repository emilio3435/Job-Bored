// Extract showToast( call sites: file:line, message expression (first ~220 chars), type.
import { readFileSync, readdirSync } from "node:fs";
const root = process.argv[2];
const files = readdirSync(root).filter(f => f.endsWith(".js") && !f.endsWith(".min.js"));
for (const f of files) {
  const src = readFileSync(`${root}/${f}`, "utf8");
  const re = /showToast\(/g; let m;
  while ((m = re.exec(src))) {
    const before = src.slice(0, m.index);
    if (/function\s+$/.test(before.slice(-20)) ) continue;
    const line = before.split("\n").length;
    // grab balanced parens
    let depth = 0, i = m.index + "showToast".length, out = "";
    for (; i < src.length; i++) { const c = src[i]; if (c === "(") depth++; if (c === ")") { depth--; if (depth === 0) break; } out += c; }
    const args = out.slice(1).replace(/\s+/g, " ").trim();
    if (args.startsWith("...args")) continue;
    const t = (args.match(/,\s*"(error|warning|info|success)"/) || [])[1] || "(default)";
    console.log(`${f}:${line}\t${t}\t${args.slice(0, 260)}`);
  }
}
