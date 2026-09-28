// Shows that fs.cp with { force: false, errorOnExist: false } (scripts/setup.mjs:283-288, the
// setup:hermes default) silently keeps a stale runtime copy. Scratch dirs under .lane-evidence only.
// Run from the worktree root: node .lane-evidence/probes/h_setup_cp_force.mjs
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = join(process.cwd(), ".lane-evidence", "cp-probe");
await rm(base, { recursive: true, force: true });
await mkdir(join(base, "repo", "scripts"), { recursive: true });
await mkdir(join(base, "runtime", "scripts"), { recursive: true });
await writeFile(join(base, "runtime", "scripts", "gate2_telegram.py"), "THREAD_ID = 314  # stale runtime copy\n");
await writeFile(join(base, "repo", "scripts", "gate2_telegram.py"), "from approval_contract import GATE2_THREAD_ID  # repo fix\n");
await cp(join(base, "repo"), join(base, "runtime"), { recursive: true, force: false, errorOnExist: false });
console.log("runtime after setup-style cp:", (await readFile(join(base, "runtime", "scripts", "gate2_telegram.py"), "utf8")).trim());
await rm(base, { recursive: true, force: true });
