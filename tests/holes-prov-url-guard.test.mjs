/**
 * HOLES PROV · S1, P11, S12: provider and catalog URLs are caller-supplied
 * (Local, self-hosted, xAI), so a hosted server must refuse private,
 * loopback, link-local and cloud-metadata hosts before it fetches one. A
 * loopback server keeps reaching Ollama on 127.0.0.1 and a LAN box.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROVIDER_URL_BLOCKED,
  listenerIsLoopback,
  providerFetch,
} from "../server/provider-url-guard.mjs";

const HOSTED = { LISTEN_HOST: "0.0.0.0" };
const LOCAL = {};

/** Records every call; answers 200 with an empty object. */
function recordingFetch(answer = () => ({ ok: true, status: 200, json: async () => ({}) })) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  };
  return { calls, fetchImpl };
}

describe("listenerIsLoopback reads LISTEN_HOST like server/index.mjs", () => {
  it("treats an unset or loopback LISTEN_HOST as local and anything else as hosted", () => {
    for (const host of [undefined, "", "127.0.0.1", "localhost", "LOCALHOST", "::1"]) {
      assert.equal(listenerIsLoopback(host === undefined ? {} : { LISTEN_HOST: host }), true, `${host} is loopback`);
    }
    for (const host of ["0.0.0.0", "::", "10.0.0.5", "api.example.com"]) {
      assert.equal(listenerIsLoopback({ LISTEN_HOST: host }), false, `${host} is hosted`);
    }
  });
});

describe("providerFetch on a hosted server", () => {
  const refused = [
    ["loopback", "http://127.0.0.1:11434/v1/chat/completions"],
    ["loopback name", "http://localhost:11434/api/tags"],
    ["IPv6 loopback", "http://[::1]:11434/v1/models"],
    ["RFC 1918 10/8", "http://10.0.0.5:8000/v1/chat/completions"],
    ["RFC 1918 192.168/16", "http://192.168.1.20:11434/api/tags"],
    ["RFC 1918 172.16/12", "https://172.16.4.2/v1/chat/completions"],
    ["IPv6 unique-local", "http://[fd00::1]/v1/chat/completions"],
    ["link-local", "http://169.254.10.20/v1/chat/completions"],
    ["IPv6 link-local", "http://[fe80::1]/v1/chat/completions"],
    ["cloud metadata IP", "http://169.254.169.254/latest/meta-data/"],
    ["cloud metadata IP, integer form", "http://2852039166/latest/meta-data/"],
    ["cloud metadata name", "http://metadata.google.internal/computeMetadata/v1/"],
    ["non-http scheme", "file:///etc/passwd"],
  ];
  for (const [label, url] of refused) {
    it(`refuses a ${label} address without fetching it`, async () => {
      const { calls, fetchImpl } = recordingFetch();
      await assert.rejects(
        () => providerFetch(url, { method: "POST", body: "{}" }, { fetchImpl, env: HOSTED }),
        (error) => {
          assert.equal(error.code, PROVIDER_URL_BLOCKED);
          assert.match(error.message, /hosted/i);
          return true;
        },
      );
      assert.equal(calls.length, 0, "a refused address is never fetched");
    });
  }

  it("refuses a public-looking name that resolves to a private address", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const lookupImpl = async () => [{ address: "10.1.2.3", family: 4 }];
    await assert.rejects(
      () => providerFetch("https://llm.example.com/v1/chat/completions", { method: "POST", body: "{}" }, { fetchImpl, env: HOSTED, lookupImpl }),
      (error) => error.code === PROVIDER_URL_BLOCKED,
    );
    assert.equal(calls.length, 0);
  });

  it("refuses a redirect that bounces a public host onto cloud metadata", async () => {
    const { calls, fetchImpl } = recordingFetch(() => ({
      ok: false,
      status: 302,
      headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
      json: async () => ({}),
    }));
    const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
    await assert.rejects(
      () => providerFetch("https://llm.example.com/v1/models", { method: "GET" }, { fetchImpl, env: HOSTED, lookupImpl }),
      (error) => error.code === PROVIDER_URL_BLOCKED,
    );
    assert.equal(calls.length, 1, "only the public first hop was fetched");
  });

  it("fetches a public self-hosted address", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const lookupImpl = async () => [{ address: "93.184.216.34", family: 4 }];
    const resp = await providerFetch("https://llm.example.com/v1/chat/completions", { method: "POST", body: "{}" }, { fetchImpl, env: HOSTED, lookupImpl });
    assert.equal(resp.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://llm.example.com/v1/chat/completions");
  });

  it("fetches the built-in provider origins as before, with no DNS lookup", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const lookupImpl = async () => { throw new Error("built-in provider origins need no lookup"); };
    for (const url of [
      "https://api.openai.com/v1/chat/completions",
      "https://api.anthropic.com/v1/messages",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      "https://openrouter.ai/api/v1/chat/completions",
      "https://api.x.ai/v1/models",
    ]) {
      await providerFetch(url, { method: "GET" }, { fetchImpl, env: HOSTED, lookupImpl });
    }
    assert.equal(calls.length, 5);
  });
});

describe("providerFetch on a loopback server", () => {
  for (const url of [
    "http://127.0.0.1:11434/v1/chat/completions",
    "http://localhost:11434/api/tags",
    "http://192.168.1.20:11434/v1/chat/completions",
    "http://nas:11434/api/tags",
  ]) {
    it(`keeps reaching ${url}`, async () => {
      const { calls, fetchImpl } = recordingFetch();
      await providerFetch(url, { method: "GET" }, { fetchImpl, env: LOCAL });
      assert.deepEqual(calls.map((call) => call.url), [url]);
    });
  }
});
