/*
  Env-file parsing and merging for the local discovery worker starter.

  Extracted so the merge rule is testable on its own: the starter layers the
  repo's integrations/browser-use-discovery/.env, server/.env, and the user's
  ~/.jobbored/browser-use-discovery/.env, and a bug in that layering is
  invisible until the worker refuses a run for a credential the user believes
  they configured (2026-09-02).
*/

/** Parse KEY=value lines. Comments, blanks, and keyless lines are skipped. */
export function parseEnvFileText(text) {
  const out = {};
  if (typeof text !== "string" || !text) return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Layer parsed env files, later files winning — EXCEPT that a present-but-
 * empty value never erases a configured one. Env files acquire bare `KEY=`
 * lines by being copied from .env.example, and a plain Object.assign let
 * such a placeholder blank a real credential set in an earlier file. An
 * empty value still lands when no earlier file set the key at all, so
 * "explicitly empty" survives where it is the only answer.
 *
 * Returns { values, sources }: sources[key] is the winning layer index, so
 * launchers can say WHICH file supplied a key (BEAUDIT G11).
 */
export function mergeEnvFileValuesWithSources(sources) {
  const merged = {};
  const provenance = {};
  for (const [index, source] of (sources || []).entries()) {
    if (!source || typeof source !== "object") continue;
    for (const [key, value] of Object.entries(source)) {
      const next = typeof value === "string" ? value : String(value ?? "");
      if (!next.trim() && String(merged[key] ?? "").trim()) continue;
      merged[key] = next;
      provenance[key] = index;
    }
  }
  return { values: merged, sources: provenance };
}

export function mergeEnvFileValues(sources) {
  return mergeEnvFileValuesWithSources(sources).values;
}

/**
 * BEAUDIT G11: per-key provenance for layered env files. `layers` are the
 * parsed objects in precedence order, `paths[i]` is layers[i]'s file, and
 * `processEnv` overlays exactly like the starter's
 * `{...fromFiles, ...process.env}` spread (any present key wins, even when
 * empty). Returns { values, sources } with sources[key] set to the winning
 * file path, "process", or "" when the layer is unknown. Paths and the word
 * "process" — never values.
 */
export function resolveLayeredEnvSources(
  layers,
  { paths = [], processEnv = {} } = {},
) {
  const { values, sources } = mergeEnvFileValuesWithSources(layers);
  const out = {};
  for (const key of Object.keys(values)) {
    if (Object.prototype.hasOwnProperty.call(processEnv, key)) {
      out[key] = "process";
    } else {
      const index = sources[key];
      out[key] =
        typeof index === "number" && paths[index] ? String(paths[index]) : "";
    }
  }
  return { values, sources: out };
}
