import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPdfIfPossible } from "../server/materials-pdf.mjs";

describe("renderPdfIfPossible", () => {
  it("returns pdf_skipped when playwright is unavailable or injected skip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-pdf-"));
    const result = await renderPdfIfPossible("<html><body>Hi</body></html>", join(dir, "out.pdf"), {
      playwrightImport: async () => {
        throw new Error("not installed");
      },
    });
    assert.equal(result.skipped, true);
    assert.equal(result.note, "pdf_skipped");
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the output path when an injected playwright renders", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-pdf-"));
    const outPath = join(dir, "out.pdf");
    const result = await renderPdfIfPossible("<html><body>Hi</body></html>", outPath, {
      playwrightImport: async () => ({
        chromium: {
          launch: async () => ({
            newPage: async () => ({
              setContent: async () => {},
              pdf: async ({ path }) => {
                const { writeFile } = await import("node:fs/promises");
                await writeFile(path, "%PDF-1.4\n");
              },
            }),
            close: async () => {},
          }),
        },
      }),
    });
    assert.equal(result.skipped, false);
    assert.equal(result.path, outPath);
    await rm(dir, { recursive: true, force: true });
  });
});
