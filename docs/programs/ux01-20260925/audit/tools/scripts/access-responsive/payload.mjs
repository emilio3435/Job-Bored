// Cold signed-in load at 1440: requests/bytes by type, tag counts, coverage, paint timings.
import { openApp } from "/Users/emilionunezgarcia/Job-Bored.worktrees/ux01/docs/programs/ux01-20260925/audit/tools/audit-harness.mjs";
const app = await openApp({ mode: "signed-in", viewport: "desktop" });
const { page, context } = app;
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.clearBrowserCache");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
const reqs = new Map();
cdp.on("Network.responseReceived", (e) => { reqs.set(e.requestId, { url: e.response.url, mime: e.response.mimeType, type: e.type, status: e.response.status }); });
cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) r.enc = e.encodedDataLength; });
await page.addInitScript(() => {
  window.__fmc = {};
  const mark = () => { for (const [k, s] of [["today", ".today-item"], ["card", ".pipe-sticker"], ["brief", ".brief-lead, .brief-leads-section"]]) if (!window.__fmc[k] && document.querySelector(s)) window.__fmc[k] = performance.now(); };
  new MutationObserver(mark).observe(document, { childList: true, subtree: true });
  window.__lcp = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
});
await page.coverage.startJSCoverage({ resetOnNavigation: false });
await page.coverage.startCSSCoverage({ resetOnNavigation: false });
await page.reload({ waitUntil: "load" });
await page.waitForLoadState("networkidle").catch(() => {});
await page.waitForTimeout(2500);
const js = await page.coverage.stopJSCoverage();
const css = await page.coverage.stopCSSCoverage();
const perf = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; const p = Object.fromEntries(performance.getEntriesByType("paint").map((e) => [e.name, Math.round(e.startTime)])); return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), ...p, lcp: Math.round(window.__lcp), fmc: Object.fromEntries(Object.entries(window.__fmc).map(([k, v]) => [k, Math.round(v)])), scripts: document.querySelectorAll("script").length, scriptsSrc: document.querySelectorAll("script[src]").length, styles: document.querySelectorAll('link[rel="stylesheet"]').length, inlineStyles: document.querySelectorAll("style").length, domNodes: document.getElementsByTagName("*").length }; });
const bucket = (r) => { const u = r.url.split("?")[0]; if (/\.css$/.test(u) || r.mime === "text/css") return "css"; if (/\.m?js$/.test(u) || /javascript/.test(r.mime)) return "js"; if (/\.(woff2?|ttf|otf)$/.test(u) || /font/.test(r.mime)) return "font"; if (/^image\//.test(r.mime) || /\.(png|jpe?g|svg|webp|gif|ico)$/.test(u)) return "image"; if (r.type === "Document") return "html"; return "other"; };
const agg = {};
for (const r of reqs.values()) { const b = bucket(r); agg[b] ||= { n: 0, bytes: 0, sameOrigin: 0 }; agg[b].n++; agg[b].bytes += r.enc || 0; if (r.url.startsWith(app.baseUrl)) agg[b].sameOrigin++; }
console.log("REQUESTS by type (encodedDataLength, cache disabled):");
let tn = 0, tb = 0; for (const [k, v] of Object.entries(agg)) { tn += v.n; tb += v.bytes; console.log(`  ${k.padEnd(6)} n=${v.n} bytes=${v.bytes} (${(v.bytes / 1024).toFixed(0)} KiB)`); }
console.log(`  TOTAL n=${tn} bytes=${tb} (${(tb / 1024).toFixed(0)} KiB)`);
const cov = (entries, isCss) => { let total = 0, used = 0; const per = []; for (const e of entries) { if (!e.url.startsWith(app.baseUrl)) continue; const len = (isCss ? e.text : e.source)?.length || 0; let u = 0; if (isCss) for (const r of e.ranges) u += r.end - r.start; else { for (const f of e.functions) for (const r of f.ranges) if (r.count > 0 && f.isBlockCoverage === false) {} ; const ranges = []; for (const f of e.functions) for (const r of f.ranges) ranges.push(r); /* approximate: bytes in blocks with count>0 minus nested zero blocks */ const arr = new Uint8Array(len); for (const f of e.functions) for (const r of f.ranges) arr.fill(r.count > 0 ? 1 : 0, r.startOffset, r.endOffset); u = arr.reduce((a, b) => a + b, 0); } total += len; used += u; per.push([e.url.replace(app.baseUrl, ""), len, u]); } return { total, used, unusedPct: total ? (100 * (1 - used / total)).toFixed(1) : "n/a", per }; };
const jc = cov(js, false), cc = cov(css, true);
console.log(`JS coverage: files=${jc.per.length} total=${jc.total} used=${jc.used} unused=${jc.unusedPct}%`);
console.log(`CSS coverage: files=${cc.per.length} total=${cc.total} used=${cc.used} unused=${cc.unusedPct}%`);
console.log("Top unused JS:", jc.per.sort((a, b) => (b[1] - b[2]) - (a[1] - a[2])).slice(0, 8).map(([u, t, x]) => `${u} ${Math.round((t - x) / 1024)}KiB/${Math.round(t / 1024)}KiB`).join("; "));
console.log("Top unused CSS:", cc.per.sort((a, b) => (b[1] - b[2]) - (a[1] - a[2])).slice(0, 8).map(([u, t, x]) => `${u} ${Math.round((t - x) / 1024)}KiB/${Math.round(t / 1024)}KiB`).join("; "));
console.log("PERF+TAGS:", JSON.stringify(perf));
const cssCount = {}; for (const r of reqs.values()) if (bucket(r) === "css") { const u = r.url.replace(app.baseUrl, ""); cssCount[u] = (cssCount[u] || 0) + 1; } console.log("CSS dupes:", Object.entries(cssCount).filter(([, n]) => n > 1).length, "of", Object.keys(cssCount).length, Object.entries(cssCount).slice(0, 4)); const navs = [...reqs.values()].filter(r => r.type === "Document").map(r => r.url.replace(app.baseUrl, "")); console.log("documents:", navs);
console.log("unexpected external:", app.unexpectedExternal.length);
await app.close();
