import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pickStableGeminiFlash,
  isGeminiFlashFamily,
  isWeakMaterialsModel,
  GEMINI_FLASH_FALLBACK,
} from "../server/model-family.mjs";

describe("pickStableGeminiFlash", () => {
  it("picks newest stable flash and skips lite/preview/image/live", () => {
    const picked = pickStableGeminiFlash([
      "gemini-3.5-flash",
      "gemini-3.6-flash",
      "gemini-3.7-flash",
      "gemini-3.7-flash-preview",
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-live",
      "gemini-3.7-pro",
    ]);
    assert.equal(picked, "gemini-3.7-flash");
  });

  it("returns null on an empty list so callers can use GEMINI_FLASH_FALLBACK", () => {
    assert.equal(pickStableGeminiFlash([]), null);
    assert.equal(GEMINI_FLASH_FALLBACK, "gemini-3.7-flash");
  });
});

describe("isGeminiFlashFamily", () => {
  it("treats the alias as a family, not a snapshot", () => {
    assert.equal(isGeminiFlashFamily("gemini-flash"), true);
    assert.equal(isGeminiFlashFamily("gemini-3.7-flash"), false);
  });
});

describe("isWeakMaterialsModel", () => {
  it("flags OpenRouter free OSS ids", () => {
    assert.equal(isWeakMaterialsModel("openai/gpt-oss-120b:free"), true);
    assert.equal(isWeakMaterialsModel("openai/gpt-oss-20b:free"), true);
    assert.equal(isWeakMaterialsModel("gemini-flash"), false);
    assert.equal(isWeakMaterialsModel("gemini-3.7-flash"), false);
  });
});
