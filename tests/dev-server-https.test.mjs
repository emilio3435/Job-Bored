import assert from "node:assert/strict";
import { get as httpsGet } from "node:https";
import { describe, it } from "node:test";

import { startDevServer } from "../dev-server.mjs";

const SILENT_LOGGER = {
  log() {},
  error() {},
};

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function fetchHttpsText(url) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { rejectUnauthorized: false },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body,
          });
        });
      },
    );
    req.on("error", reject);
  });
}

describe("dev-server HTTPS surface", () => {
  it("serves the dashboard over TLS when enabled", async () => {
    const server = await startDevServer({
      port: 0,
      logger: SILENT_LOGGER,
      tls: true,
    });
    const port = server.address().port;
    try {
      const response = await fetchHttpsText(`https://localhost:${port}/`);
      assert.equal(response.statusCode, 200);
      assert.match(String(response.headers["content-type"] || ""), /text\/html/i);
      assert.match(response.body, /Command Center/i);
    } finally {
      await closeServer(server);
    }
  });
});
