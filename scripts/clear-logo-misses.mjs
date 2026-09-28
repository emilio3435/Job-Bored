#!/usr/bin/env node
/**
 * Clear recorded logo misses (<logos>/targets/.miss-<key>) so the next draft
 * looks those companies up again. Only `.miss-*` files are removed; logo
 * assets, uploads and logos.json are never touched.
 *
 *   node scripts/clear-logo-misses.mjs [--dry-run] [--before <ISO time>] [--logos-dir <abs path>]
 *
 * Default: clears misses in the old plain-timestamp format (recorded before
 * misses carried their domain hint). --before also clears any miss last
 * written before that time. The logos folder is JOBBORED_LOGOS_DIR, else
 * <JOBBORED_HOME>/logos, else ~/.jobbored/logos.
 */
import { clearStaleLogoMisses } from "../server/brand-logos.mjs";

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean, before: Date | null, templateRoot: string }} */
  const out = { dryRun: false, before: null, templateRoot: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--before") {
      const when = new Date(String(argv[i + 1] || ""));
      if (!Number.isFinite(when.getTime())) throw new Error("--before needs an ISO time, e.g. 2026-09-28T00:00:00Z");
      out.before = when;
      i += 1;
    } else if (arg === "--logos-dir") {
      out.templateRoot = String(argv[i + 1] || "");
      if (!out.templateRoot.startsWith("/")) throw new Error("--logos-dir needs an absolute path");
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/clear-logo-misses.mjs [--dry-run] [--before <ISO time>] [--logos-dir <abs path>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = await clearStaleLogoMisses({
    dryRun: args.dryRun,
    before: args.before,
    ...(args.templateRoot ? { templateRoot: args.templateRoot } : {}),
  });
  const verb = args.dryRun ? "would remove" : "removed";
  console.log(`${result.dir}: ${verb} ${result.removed.length} miss file(s), kept ${result.kept.length}`);
  for (const name of result.removed) console.log(`  ${verb} ${name}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
