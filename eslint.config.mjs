// ESLint flat config for the JobBored repo.
//
// Scope is correctness-only: no-undef, no-unused-vars, no-dupe-keys,
// no-unreachable. NO stylistic rules — formatting stays hand-managed.
//
// The browser bundle is classic-global scripts (NOT ES modules) loaded by
// index.html. Two publish mechanisms coexist:
//   1. IIFE modules that attach namespaces to window.* (window.JobBoredApp…)
//   2. top-level declarations in sloppy classic scripts, which the browser
//      itself promotes to window globals (app.js, app-compat.js, the
//      discovery-* cuts, …) and which other scripts reference bare.
// ESLint has no concept of a cross-file shared script scope, so the top-level
// declarations of all root scripts are scanned at config-load time and
// declared as shared globals. This keeps no-undef strong: a typo'd reference
// to a name no script declares is still an error.
import { readdirSync, readFileSync } from "node:fs";
import globals from "globals";

const correctnessRules = {
  "no-undef": "error",
  // caughtErrors "none" restores the pre-ESLint-9 default: the repo idiom is
  // `catch (e) {}` / `catch (_) {}` for deliberately ignored errors (~500
  // sites), and flagging those would drown real findings. varsIgnorePattern
  // extends the same underscore convention to deliberately parked bindings
  // (e.g. _UNUSED_renderBriefCharts in daily-brief.js).
  "no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
  ],
  "no-dupe-keys": "error",
  "no-unreachable": "error",
};

// window.* namespaces published by the repo's IIFE modules, plus globals from
// the vendored libraries (vendor/ itself is not linted) and the GIS loader.
const windowNamespaces = {
  COMMAND_CENTER_CONFIG: "writable",
  CommandCenterBrowserAiProvider: "writable",
  CommandCenterDocumentTemplates: "writable",
  CommandCenterJobPostingInsights: "writable",
  CommandCenterModelDownload: "writable",
  CommandCenterResumeBundle: "writable",
  CommandCenterResumeGenerate: "writable",
  CommandCenterResumeIngest: "writable",
  CommandCenterResumeModelOptions: "writable",
  CommandCenterUserContent: "writable",
  CommandCenterVisualThemes: "writable",
  FitProfileForm: "writable",
  JB_LATTICE: "writable",
  JB_SCRIBE: "writable",
  JobBored: "writable",
  JobBoredApp: "writable",
  JobBoredAts: "writable",
  JobBoredCompaniesTab: "writable",
  JobBoredCompanyCap: "writable",
  JobBoredDiscovery: "writable",
  JobBoredDiscoveryAutodetect: "writable",
  JobBoredDiscoveryDrawerSubtabs: "writable",
  JobBoredDiscoveryHelpers: "writable",
  JobBoredDiscoveryWizard: "writable",
  JobBoredDossierWorkshop: "writable",
  JobBoredEnhancements: "writable",
  JobBoredFlowing: "writable",
  JobBoredGoLive: "writable",
  JobBoredJbV2Tab: "writable",
  JobBoredModelCatalog: "writable",
  JobBoredOnboardingTelemetry: "writable",
  JobBoredRunsLog: "writable",
  JobBoredSettingsDiscoveryAdapters: "writable",
  JobBoredSettingsProfileTab: "writable",
  JobBoredSettingsTabs: "writable",
  JobBoredSettingsTabSchema: "writable",
  JobBoredWelcome: "writable",
  google: "readonly",
  mammoth: "readonly",
  pdfjsLib: "readonly",
};

// Top-level declarations in root classic scripts become window globals at
// runtime (sloppy-mode script semantics); collect them so bare cross-file
// references don't trip no-undef. Column-0 anchoring matches the repo's
// two-space-indent style: only true top-level declarations sit at column 0.
function collectClassicScriptGlobals() {
  const names = {};
  const declaration =
    /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
  for (const entry of readdirSync(".")) {
    if (!entry.endsWith(".js")) continue;
    for (const line of readFileSync(entry, "utf8").split("\n")) {
      const match = declaration.exec(line);
      if (match) names[match[1] || match[2]] = "writable";
    }
  }
  return names;
}

export default [
  {
    ignores: [
      "vendor/**",
      "node_modules/**",
      "server/node_modules/**",
      "integrations/**/dist/**",
      "coverage/**",
      // Local-only, gitignored runtime config (baked credentials) — absent in CI.
      "config.js",
    ],
  },
  {
    // Unused eslint-disable directives target rules outside this minimal set
    // (no-console, no-await-in-loop, …); reporting them here would be noise.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  {
    // Classic-global browser scripts loaded by index.html / injected pages.
    files: ["*.js", "lib/**/*.js", "integrations/hermes-job-hunt/scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...windowNamespaces,
        ...collectClassicScriptGlobals(),
      },
    },
    rules: correctnessRules,
  },
  {
    // app-compat.js exists ONLY to publish legacy forwarders: every top-level
    // function is consumed cross-file via implicit window globals, which
    // no-unused-vars cannot see.
    files: ["app-compat.js"],
    rules: {
      "no-unused-vars": "off",
    },
  },
  {
    // Dual-environment scripts: browser classic-global plus a typeof-guarded
    // CommonJS export for Node consumers in scripts/.
    files: ["discovery-payload.js", "discovery-shared-helpers.js", "setup-doctor.js"],
    languageOptions: {
      globals: { module: "readonly" },
    },
  },
  {
    // Cloudflare Workers (ES modules, service-worker runtime globals).
    files: [
      "templates/cloudflare-worker/worker.js",
      "integrations/cloudflare-relay-template/src/worker.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.serviceworker },
    },
    rules: correctnessRules,
  },
  {
    // Node ES modules: dev server, scripts/, server/, tests/, tools/, probes/.
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: correctnessRules,
  },
];
