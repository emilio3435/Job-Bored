/**
 * HOLES PROV · P8: a provider's 429 or 5xx is usually a blip, so chat()
 * retries it at most twice, with jittered backoff, honouring Retry-After —
 * but never past the call's deadline, never for a final answer such as
 * OpenAI's insufficient_quota, and never after the caller gave up.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chat } from "../server/ai/provider.mjs";
import { structureResumeWithModel } from "../server/materials-resume-structure-model.mjs";

const PIN = { provider: "openai", model: "gpt-4o-mini", apiKey: "fictional-key" };
const MESSAGES = [{ role: "user", content: "hi" }];
const OK = { choices: [{ finish_reason: "stop", message: { content: "ok" } }] };

describe("P8 · resume structure owns its three-attempt retry budget", () => {
  for (const status of [429, 503]) {
    it(`makes only three transport calls for a persistent ${status}, then fails visibly`, async () => {
      const { calls, fetchImpl } = scripted([{ status }]);
      const { waits, sleep } = recordingSleep();
      const result = await structureResumeWithModel({ resumeText: "Fictional resume", pin: PIN, fetchImpl, sleep });
      assert.equal(result.status, "failed");
      assert.equal(result.structure, null);
      assert.equal(calls.length, 3, "the outer three attempts must not each make three inner requests");
      assert.deepEqual(waits, [500, 1000]);
    });
  }
});

/** Answers each call with the next scripted reply ({status, body?, headers?}). */
function scripted(replies) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    const status = reply.status;
    return {
      ok: status < 300,
      status,
      headers: new Headers(reply.headers || {}),
      json: async () => reply.body || (status < 300 ? OK : { error: { message: "fictional upstream detail" } }),
    };
  };
  return { calls, fetchImpl };
}

/** Records each wait instead of sleeping. */
function recordingSleep() {
  const waits = [];
  const sleep = async (ms) => { waits.push(ms); };
  return { waits, sleep };
}

describe("chat() transient-failure retry (P8)", () => {
  it("retries a 429 and returns the answer that follows", async () => {
    const { calls, fetchImpl } = scripted([{ status: 429 }, { status: 200 }]);
    const { waits, sleep } = recordingSleep();
    const out = await chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep });
    assert.equal(out.text, "ok");
    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1);
    assert.ok(waits[0] >= 250 && waits[0] <= 500, `first backoff is jittered within 250–500 ms, got ${waits[0]}`);
  });

  it("retries 5xx at most twice, with a longer jittered wait the second time, then gives up", async () => {
    const { calls, fetchImpl } = scripted([{ status: 503 }, { status: 500 }, { status: 502 }, { status: 200 }]);
    const { waits, sleep } = recordingSleep();
    await assert.rejects(() => chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep }), (error) => {
      assert.equal(error.name, "ProviderApiError");
      assert.equal(error.upstreamStatus, 502);
      assert.equal(String(error.message).includes("fictional upstream detail"), false);
      return true;
    });
    assert.equal(calls.length, 3, "one call plus two retries");
    assert.equal(waits.length, 2);
    assert.ok(waits[1] >= 500 && waits[1] <= 1000, `second backoff is jittered within 500–1000 ms, got ${waits[1]}`);
  });

  it("jitters the backoff, so two runs rarely wait the same", async () => {
    const seen = new Set();
    for (let run = 0; run < 8; run += 1) {
      const { fetchImpl } = scripted([{ status: 503 }, { status: 200 }]);
      const { waits, sleep } = recordingSleep();
      await chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep });
      seen.add(waits[0]);
    }
    assert.ok(seen.size > 1, "eight runs produced more than one wait");
  });

  it("honours Retry-After in seconds and as an HTTP date", async () => {
    const seconds = scripted([{ status: 429, headers: { "retry-after": "3" } }, { status: 200 }]);
    const first = recordingSleep();
    await chat({ pin: PIN, messages: MESSAGES, fetchImpl: seconds.fetchImpl, sleep: first.sleep });
    assert.deepEqual(first.waits, [3000]);

    const date = new Date(Date.now() + 5_000).toUTCString();
    const dated = scripted([{ status: 503, headers: { "retry-after": date } }, { status: 200 }]);
    const second = recordingSleep();
    await chat({ pin: PIN, messages: MESSAGES, fetchImpl: dated.fetchImpl, sleep: second.sleep });
    assert.equal(second.waits.length, 1);
    assert.ok(second.waits[0] > 3_000 && second.waits[0] <= 5_000, `waited ${second.waits[0]} ms for a date ~5 s out`);
  });

  it("does not retry when Retry-After runs past the call's deadline", async () => {
    const { calls, fetchImpl } = scripted([{ status: 429, headers: { "retry-after": "30" } }, { status: 200 }]);
    const { waits, sleep } = recordingSleep();
    await assert.rejects(
      () => chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep, timeoutMs: 5_000 }),
      (error) => error.upstreamStatus === 429,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  it("treats insufficient_quota as final: one call, not retryable", async () => {
    const quota = { error: { message: "You exceeded your current quota.", type: "insufficient_quota", code: "insufficient_quota" } };
    const { calls, fetchImpl } = scripted([{ status: 429, body: quota }, { status: 200 }]);
    const { waits, sleep } = recordingSleep();
    await assert.rejects(() => chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep }), (error) => {
      assert.equal(error.upstreamStatus, 429);
      assert.equal(error.providerCode, "insufficient_quota");
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  it("does not retry a non-transient 4xx", async () => {
    const { calls, fetchImpl } = scripted([{ status: 400 }, { status: 200 }]);
    const { sleep } = recordingSleep();
    await assert.rejects(() => chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep }), (error) => error.upstreamStatus === 400);
    assert.equal(calls.length, 1);
  });

  it("stops waiting when the caller cancels, and never calls again", async () => {
    const { calls, fetchImpl } = scripted([{ status: 503 }, { status: 200 }]);
    const controller = new AbortController();
    const sleep = (_ms, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      controller.abort(Object.assign(new Error("Client disconnected"), { name: "AbortError" }));
    });
    await assert.rejects(
      () => chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep, signal: controller.signal }),
      (error) => {
        assert.equal(error.name, "AbortError");
        assert.equal(error.providerCode, "aborted");
        return true;
      },
    );
    assert.equal(calls.length, 1);
  });

  it("lets a caller that runs its own retry loop opt out", async () => {
    const { calls, fetchImpl } = scripted([{ status: 503 }, { status: 200 }]);
    const { waits, sleep } = recordingSleep();
    await assert.rejects(() => chat({ pin: PIN, messages: MESSAGES, fetchImpl, sleep, maxRetries: 0 }), (error) => error.upstreamStatus === 503);
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  it("waits for real, abortably, when no sleep is injected", async () => {
    const { calls, fetchImpl } = scripted([{ status: 503 }, { status: 200 }]);
    const started = Date.now();
    const out = await chat({ pin: PIN, messages: MESSAGES, fetchImpl });
    const elapsed = Date.now() - started;
    assert.equal(out.text, "ok");
    assert.equal(calls.length, 2);
    assert.ok(elapsed >= 240, `the retry waited (${elapsed} ms)`);
  });
});
