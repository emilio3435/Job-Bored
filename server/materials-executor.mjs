/**
 * Materials v3 — executor boundary (plan slice 6, mechanism §8).
 *
 * A stage runs through a named executor. local-inprocess runs it here;
 * hermes-cli and webhook are named extension points that return
 * unsupported today, and the caller falls back to local-inprocess.
 * Stages own their prompts and schemas either way: an executor never
 * invents output, it only runs the stage it is given.
 */

/** @type {Record<string, { name: string, supported: boolean }>} */
const EXECUTORS = {
  "local-inprocess": { name: "local-inprocess", supported: true },
  "hermes-cli": { name: "hermes-cli", supported: false },
  webhook: { name: "webhook", supported: false },
};

export function listExecutors() {
  return Object.keys(EXECUTORS);
}

/**
 * @param {string} name
 */
export function resolveExecutor(name) {
  const executor = EXECUTORS[name];
  if (!executor) {
    throw new Error(`unknown executor: ${name}`);
  }
  return { ...executor };
}

/**
 * @param {object} input
 * @param {string} input.executor
 * @param {string} input.stage stage name, for logs
 * @param {() => Promise<unknown>} input.run the stage, as a thunk
 */
export async function runStageWithExecutor({ executor, stage, run }) {
  const resolved = resolveExecutor(executor);
  if (!resolved.supported) {
    return { ok: false, error: "executor_unsupported", stage, executor };
  }
  return { ok: true, result: await run() };
}
