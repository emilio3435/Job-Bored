// Server-only image builds copy server/ alone. This packaged copy is kept
// byte-identical to the browser source by the output-budget contract test.
import "./llm-output-budget.js";
const budget = /** @type {any} */ (globalThis).JobBoredLlmOutputBudget;

/** @type {(provider: string, model: string) => number | undefined} */
export const outputBudget = budget.outputBudget;
/** @type {(model: string) => { thinkingLevel?: string, thinkingBudget?: number }} */
export const geminiThinkingConfig = budget.geminiThinkingConfig;
/** @type {(provider: string, model: string, requested?: number) => number | undefined} */
export const shortOutputBudget = budget.shortOutputBudget;
/** @type {(model: unknown) => boolean} */
export const openAIUsesMaxCompletionTokens = budget.openAIUsesMaxCompletionTokens;
/** @type {(provider: string, model: string, shortLimit?: number) => Record<string, number>} */
export const outputLimitField = budget.outputLimitField;
