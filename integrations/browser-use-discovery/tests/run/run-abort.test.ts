import assert from "node:assert/strict";
import test from "node:test";

import {
  TimeoutError,
  withAbortableTimeout,
} from "../../src/run/run-abort.ts";

test("F4B-RUN11-CANCEL: withAbortableTimeout aborts the work signal when the timer fires", async () => {
  let received: AbortSignal | undefined;
  let sawAbort = false;

  await assert.rejects(
    () =>
      withAbortableTimeout("browser_extract", "grounded_web", 20, async (signal) => {
        received = signal;
        signal.addEventListener(
          "abort",
          () => {
            sawAbort = true;
          },
          { once: true },
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "done";
      }),
    (error: unknown) => error instanceof TimeoutError,
  );

  assert.ok(received, "work must receive a signal");
  assert.equal(received.aborted, true);
  assert.equal(sawAbort, true);
});

test("F4B-RUN11-CANCEL: parent AbortSignal cancels underlying work", async () => {
  const parent = new AbortController();
  let sawAbort = false;

  const pending = withAbortableTimeout(
    "browser_extract",
    "grounded_web",
    5_000,
    async (signal) => {
      await new Promise((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            sawAbort = true;
            reject(signal.reason ?? new Error("aborted"));
          },
          { once: true },
        );
      });
      return "done";
    },
    parent.signal,
  );

  parent.abort(new Error("outer-cancel"));
  await assert.rejects(() => pending);

  assert.equal(sawAbort, true);
});
