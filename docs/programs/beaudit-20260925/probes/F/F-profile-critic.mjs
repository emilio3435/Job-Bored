// Lane F reproducer bundle (no server, no network). Run from worktree root:
//   node .lane-evidence/probes/F-profile-critic.mjs
// Sets HOME and every path override to a fresh dir under .lane-evidence/.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const home = join(process.cwd(), ".lane-evidence", `home-pc-${Date.now()}`);
mkdirSync(join(home, ".jobbored"), { recursive: true });
process.env.HOME = home;
const workerCfg = join(home, "worker-config.json");
process.env.BROWSER_USE_DISCOVERY_CONFIG_PATH = workerCfg;
process.env.JOBBORED_PROFILE_PATH = join(home, ".jobbored", "profile.json");

const critic = await import("../../server/materials-critic.mjs");
const up = await import("../../server/user-profile.mjs");
const pfr = await import("../../server/profile-from-resume.mjs");

console.log("== P1 critic on templates with a clean writer letter (F2) ==");
const letterTpl = readFileSync("integrations/hermes-job-hunt/cover-letter-template/cover-letter.html", "utf8");
const resumeTpl = readFileSync("integrations/hermes-job-hunt/resume-template/resume.html", "utf8");
const jd = "warehouse pipelines streaming ingestion observability reliability analytics platform engineers";
const s = await critic.critiqueMaterials({ letterHtml: letterTpl, resumeHtml: resumeTpl, jdText: jd, masterResumeHtml: resumeTpl, writerJson: { letter: { hook: "Clean prose." } } });
console.log("status:", s.status, "| issues:", s.issues.map((i) => `${i.code}:${i.severity}`).join(", "));
console.log("banned phrase source: template line", letterTpl.split("\n").findIndex((l) => /proven track record/i.test(l)) + 1, "(an HTML comment)");

console.log("== P2 resume source shadowing (F5) ==");
writeFileSync(workerCfg, JSON.stringify({ sheetId: "x", candidateProfile: { resumeText: "OLD resume from worker-config" } }));
const staged = await pfr.resolveResumeTextForAnalysis({ resumeText: "NEW resume uploaded in browser" });
console.log("from-resume with body ->", staged.source, "| cached to", staged.path?.replace(home, "$HOME"));
const later = await pfr.getStoredResumeText();
console.log("next stored-resume reader ->", later.source, JSON.stringify(later.text));

console.log("== P3 writingSamples cannot be saved, so the drafter's profile voice branch is dead (F10) ==");
const tpl = up.buildStarterTemplate(up.listStarterTemplateIds()[0]);
const v = up.validateProfile({ ...tpl, writingSamples: ["my voice"] });
console.log("validateProfile(+writingSamples).ok =", v.ok, "|", v.errors?.[0]?.message, JSON.stringify(v.errors?.[0]?.params));

console.log("== P4 profile write window + unbounded backups (F6) ==");
await up.writeProfileAtomic(tpl);
let missingSeen = 0, reads = 0, done = false;
const reader = (async () => { while (!done) { reads += 1; const r = await up.readProfile(); if (!r.ok && r.reason === "no_profile") missingSeen += 1; await new Promise((r) => setImmediate(r)); } })();
for (let i = 0; i < 40; i += 1) { await up.writeProfileAtomic({ ...tpl }); await new Promise((r) => setTimeout(r, 2)); }
done = true; await reader;
console.log(`concurrent reads=${reads}, reads that saw no_profile during saves=${missingSeen}`);
console.log("backup files after 41 saves:", readdirSync(join(home, ".jobbored")).filter((n) => n.includes(".bak.")).length);
console.log("done; sandbox", home.replace(process.cwd() + "/", ""), "exists:", existsSync(home));
