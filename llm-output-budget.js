// Shared budget table. The root copy is canonical; server/ ships byte-identical code.
// Ceilings: https://ai.google.dev/gemini-api/docs/models
// https://platform.claude.com/docs/en/models/overview
// https://developers.openai.com/api/docs/models
/** @param {typeof globalThis} root */
(function (root) {
  /** @param {string} model */
  function bare(model) {
    return String(model || "").toLowerCase().replace(/^[^/]+\//, "");
  }

  /** Return undefined when the model's maximum is not documented here.
   * @param {string} provider @param {string} model */
  function outputBudget(provider, model) {
    const name = bare(model);
    const family = String(provider || "").toLowerCase();
    if (family === "gemini" || name.startsWith("gemini-")) {
      if (/^gemini-(?:3(?:[.\-]|$)|2\.5(?:[.\-]|$)|(?:flash|pro|flash-lite)-latest$)/.test(name)) return 65536;
      if (/^gemini-(?:2\.0|1\.5)(?:[.\-]|$)/.test(name)) return 8192;
      return undefined;
    }
    if (family === "anthropic" || name.startsWith("claude-")) {
      if (/^claude-(?:fable-5|mythos-5|opus-5|sonnet-5|opus-4-[678]|sonnet-4-6)/.test(name)) return 128000;
      if (/^claude-(?:opus-4-5|sonnet-4-5|haiku-4-5)/.test(name)) return 64000;
      if (/^claude-(?:3(?:[.\-]|$)|haiku-3-5)/.test(name)) return 8192;
      return undefined;
    }
    if (/^gpt-4-turbo(?:-|$)/.test(name)) return 4096;
    if (/^gpt-4o(?:-|$)/.test(name)) return 16384;
    if (/^gpt-4\.1(?:-|$)/.test(name)) return 32768;
    if (/^o[134](?:[.\-]|$)/.test(name)) return 100000;
    if (/^gpt-5(?:[.\-]|$)/.test(name)) return 128000;
    return undefined;
  }

  /** @param {string} model */
  function geminiThinkingConfig(model) {
    const name = bare(model);
    if (/^gemini-(?:3(?:[.\-]|$)|flash-latest$)/.test(name)) return { thinkingLevel: "low" };
    if (/^gemini-2\.5(?:[.\-]|$)/.test(name)) return { thinkingBudget: 512 };
    return {};
  }

  /** @param {string} provider @param {string} model @param {number} [requested] */
  function shortOutputBudget(provider, model, requested = 8192) {
    const ceiling = outputBudget(provider, model);
    return ceiling === undefined ? undefined : Math.min(ceiling, requested);
  }

  /** @param {string} model */
  function openAIUsesMaxCompletionTokens(model) {
    return /^(?:gpt-5|o[134])(?:[.\-]|$)/.test(bare(model));
  }

  /** @param {string} provider @param {string} model @param {number} [shortLimit] */
  function outputLimitField(provider, model, shortLimit) {
    const limit = shortLimit === undefined ? outputBudget(provider, model) : shortOutputBudget(provider, model, shortLimit);
    if (limit === undefined) return {};
    return { [openAIUsesMaxCompletionTokens(model) ? "max_completion_tokens" : "max_tokens"]: limit };
  }

  const api = { outputBudget, geminiThinkingConfig, shortOutputBudget, openAIUsesMaxCompletionTokens, outputLimitField };
  /** @type {any} */ (root).JobBoredLlmOutputBudget = api;
})(typeof window !== "undefined" ? window : globalThis);
