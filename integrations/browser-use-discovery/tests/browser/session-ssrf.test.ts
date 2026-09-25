// BEAUDIT C1 + C16: page visits through sessionManager.run must go through the
// SSRF primitive — loopback, metadata redirects and rebinding hostnames are
// refused, and nothing is fetched. Promotes probe C-ssrf-session.mjs.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { responseFromIncomingMessage } from "../../../../server/security-boundaries.mjs";
import { createBrowserUseSessionManager } from "../../src/browser/session.ts";

const PRIVATE_NETWORK = /private-network/;

function makeRuntimeConfig(overrides = {}) {
  return {
    stateDatabasePath: "",
    workerConfigPath: "",
    browserUseCommand: "",
    googleServiceAccountJson: "",
    googleServiceAccountFile: "",
    googleAccessToken: "",
    webhookSecret: "",
    allowedOrigins: [],
    port: 0,
    host: "127.0.0.1",
    runMode: "local",
    asyncAckByDefault: true,
    ...overrides,
  } as any;
}

async function withPatchedFetch<T>(
  impl: (url: string, init?: RequestInit) => Promise<Response>,
  body: (calls: string[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return impl(url, init);
  }) as typeof fetch;
  try {
    return await body(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("session refuses a loopback page on the real transport and the server sees no hit", async () => {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(String(req.url));
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("PROBE-INTERNAL-SECRET");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const session = createBrowserUseSessionManager(makeRuntimeConfig());
    await assert.rejects(
      () =>
        session.run({
          url: `http://127.0.0.1:${port}/secret`,
          instruction: "x",
          timeoutMs: 2000,
        }),
      PRIVATE_NETWORK,
    );
    assert.deepEqual(hits, []);
  } finally {
    server.close();
  }
});

test("session refuses a loopback URL before calling fetch", async () => {
  await withPatchedFetch(
    async () => new Response("PROBE-INTERNAL-SECRET", { status: 200 }),
    async (calls) => {
      const session = createBrowserUseSessionManager(makeRuntimeConfig());
      await assert.rejects(
        () =>
          session.run({ url: "http://127.0.0.1:18130/secret", instruction: "x" }),
        PRIVATE_NETWORK,
      );
      assert.deepEqual(calls, []);
    },
  );
});

test("session refuses a redirect to cloud metadata and never fetches the second hop", async () => {
  await withPatchedFetch(
    async (url) =>
      url.startsWith("https://careers.example.com/")
        ? new Response(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          })
        : new Response("ami-id instance-id", { status: 200 }),
    async (calls) => {
      const session = createBrowserUseSessionManager(makeRuntimeConfig());
      await assert.rejects(
        () =>
          session.run({ url: "https://careers.example.com/jobs", instruction: "x" }),
        PRIVATE_NETWORK,
      );
      assert.deepEqual(calls, ["https://careers.example.com/jobs"]);
    },
  );
});

test("session refuses a hostname that resolves to loopback (127.0.0.1.nip.io)", async () => {
  const calls: string[] = [];
  const session = createBrowserUseSessionManager(makeRuntimeConfig(), {
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("PROBE-INTERNAL-SECRET", { status: 200 });
    }) as typeof fetch,
    lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
  });
  await assert.rejects(
    () => session.run({ url: "http://127.0.0.1.nip.io/jobs", instruction: "x" }),
    PRIVATE_NETWORK,
  );
  assert.deepEqual(calls, []);
});

test("session refuses a private URL before spawning the browser command, with no fetch fallback", async () => {
  await withPatchedFetch(
    async () => new Response("PROBE-INTERNAL-SECRET", { status: 200 }),
    async (calls) => {
      const session = createBrowserUseSessionManager(
        makeRuntimeConfig({ browserUseCommand: "exit 3" }),
      );
      await assert.rejects(
        () =>
          session.run({
            url: "http://169.254.169.254/latest/meta-data/",
            instruction: "x",
            timeoutMs: 2000,
          }),
        PRIVATE_NETWORK,
      );
      assert.deepEqual(calls, []);
    },
  );
});

test("session fetch fallback after a failed command is also guarded", async () => {
  await withPatchedFetch(
    async (url) =>
      url.startsWith("https://careers.example.com/")
        ? new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1:18130/secret" },
          })
        : new Response("PROBE-INTERNAL-SECRET", { status: 200 }),
    async (calls) => {
      const session = createBrowserUseSessionManager(
        makeRuntimeConfig({ browserUseCommand: "exit 3" }),
      );
      await assert.rejects(
        () =>
          session.run({
            url: "https://careers.example.com/jobs",
            instruction: "x",
            timeoutMs: 2000,
          }),
        PRIVATE_NETWORK,
      );
      assert.deepEqual(calls, ["https://careers.example.com/jobs"]);
    },
  );
});

test("session caps an endless page body instead of buffering it", async () => {
  let pulls = 0;
  const chunk = new Uint8Array(256 * 1024).fill(97);
  await withPatchedFetch(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulls += 1;
            if (pulls > 400) controller.close();
            else controller.enqueue(chunk);
          },
        }),
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    async () => {
      const session = createBrowserUseSessionManager(makeRuntimeConfig());
      await assert.rejects(
        () => session.run({ url: "https://careers.example.com/huge", instruction: "x" }),
        /exceeds/i,
      );
      assert.ok(pulls < 40, `body must stop near the cap; pulled ${pulls} chunks`);
    },
  );
});

test("session passes request.abortSignal through to the fetch path", async () => {
  const controller = new AbortController();
  let fetchEntered: () => void = () => {};
  const enteredFetch = new Promise<void>((resolve) => {
    fetchEntered = resolve;
  });
  await withPatchedFetch(
    (_url, init) => {
      fetchEntered();
      assert.equal(init?.signal, controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    },
    async () => {
      const session = createBrowserUseSessionManager(makeRuntimeConfig());
      const pending = session.run({
        url: "https://careers.example.com/slow",
        instruction: "x",
        abortSignal: controller.signal,
      });
      await Promise.race([enteredFetch, pending]);
      controller.abort();
      await assert.rejects(() => pending, (error: Error) => error.name === "AbortError");
    },
  );
});

// Repair round: the pinned transport returns raw bytes, so a gzip page must be
// decoded before session.run reads its text and title. The Response is built
// by the same helper the pinned transport uses, against a loopback server.
test("session decodes a gzip page before reading its title", async () => {
  const page = "<html><head><title>Staff Engineer</title></head><body>Apply</body></html>";
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
    res.end(gzipSync(page));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await withPatchedFetch(
      (url) =>
        new Promise<Response>((resolve, reject) => {
          http
            .get({ host: "127.0.0.1", port, path: "/" }, (res) =>
              resolve(responseFromIncomingMessage(res, { url })),
            )
            .on("error", reject);
        }),
      async () => {
        const session = createBrowserUseSessionManager(makeRuntimeConfig());
        const result = await session.run({ url: "https://careers.example.com/role", instruction: "x" });
        assert.equal(result.text, page);
        assert.equal(result.metadata.title, "Staff Engineer");
      },
    );
  } finally {
    server.close();
  }
});

test("session visits a public IPv6 literal and still refuses a private one", async () => {
  const calls: string[] = [];
  const noDns = async () => {
    throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  };
  const session = createBrowserUseSessionManager(makeRuntimeConfig(), {
    fetchImpl: (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response("<html><head><title>IPv6 Role</title></head><body>Apply</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch,
    lookupImpl: noDns,
  });
  await session.run({ url: "https://[2606:4700:4700::1111]/jobs", instruction: "x" });
  assert.deepEqual(calls, ["https://[2606:4700:4700::1111]/jobs"]);
  for (const url of ["http://[::1]/jobs", "http://[fd00::5]/jobs", "http://[::ffff:127.0.0.1]/jobs"]) {
    await assert.rejects(() => session.run({ url, instruction: "x" }), PRIVATE_NETWORK);
  }
  assert.equal(calls.length, 1);
});
