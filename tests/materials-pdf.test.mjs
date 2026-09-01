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

  it("returns pdf_skipped when launch/setContent/pdf exceeds the timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-pdf-"));
    let closed = false;
    const result = await renderPdfIfPossible("<html><body>Hi</body></html>", join(dir, "out.pdf"), {
      timeoutMs: 30,
      playwrightImport: async () => ({
        chromium: {
          launch: async () => ({
            newPage: async () => ({
              setContent: () => new Promise(() => {}),
              pdf: async () => {},
            }),
            close: async () => {
              closed = true;
            },
          }),
        },
      }),
    });
    assert.equal(result.skipped, true);
    assert.equal(result.note, "pdf_skipped");
    assert.equal(closed, true);
    await rm(dir, { recursive: true, force: true });
  });

  it("returns pdf_skipped when setContent rejects after the timeout without unhandledRejection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jb-pdf-"));
    let closed = false;
    /** @type {unknown[]} */
    const unhandled = [];
    const onUnhandled = (reason) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const result = await renderPdfIfPossible("<html><body>Hi</body></html>", join(dir, "out.pdf"), {
        timeoutMs: 30,
        playwrightImport: async () => ({
          chromium: {
            launch: async () => ({
              newPage: async () => ({
                setContent: () =>
                  new Promise((_, reject) => {
                    setTimeout(() => reject(new Error("late setContent")), 80);
                  }),
                pdf: async () => {},
              }),
              close: async () => {
                closed = true;
              },
            }),
          },
        }),
      });
      assert.equal(result.skipped, true);
      assert.equal(result.note, "pdf_skipped");
      assert.equal(closed, true);
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(unhandled.length, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
