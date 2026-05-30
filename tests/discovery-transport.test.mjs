import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSPORT_CLOUDFLARE_NAMED,
  TRANSPORT_CLOUDFLARE_QUICK,
  TRANSPORT_NGROK,
  normalizeTransportPreference,
  detectCloudflared,
  parseQuickTunnelUrl,
  selectTransport,
  isStableTransport,
  buildQuickTunnelCommand,
  buildNamedTunnelCommand,
} from "../scripts/lib/discovery-transport.mjs";

test("normalizeTransportPreference maps CLI/env spellings and rejects junk", () => {
  assert.equal(normalizeTransportPreference(""), "auto");
  assert.equal(normalizeTransportPreference("auto"), "auto");
  assert.equal(normalizeTransportPreference("cloudflare-named"), TRANSPORT_CLOUDFLARE_NAMED);
  assert.equal(normalizeTransportPreference("cloudflare_quick"), TRANSPORT_CLOUDFLARE_QUICK);
  assert.equal(normalizeTransportPreference("NGROK"), TRANSPORT_NGROK);
  assert.equal(normalizeTransportPreference("nonsense"), "");
});

test("detectCloudflared parses version and handles absence", () => {
  const present = detectCloudflared({
    spawnSyncImpl: () => ({ status: 0, stdout: "cloudflared version 2024.2.1 (built ...)" }),
  });
  assert.deepEqual(present, { installed: true, version: "2024.2.1" });

  const missing = detectCloudflared({
    spawnSyncImpl: () => ({ error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }) }),
  });
  assert.deepEqual(missing, { installed: false });
});

test("parseQuickTunnelUrl extracts the trycloudflare URL from the banner", () => {
  const banner = [
    "2024-02-13T10:30:00Z INF +-------------------------------------+",
    "2024-02-13T10:30:00Z INF |  https://foo-bar-baz.trycloudflare.com  |",
    "2024-02-13T10:30:00Z INF +-------------------------------------+",
  ].join("\n");
  assert.equal(parseQuickTunnelUrl(banner), "https://foo-bar-baz.trycloudflare.com");
  assert.equal(parseQuickTunnelUrl("no url here"), "");
});

test("selectTransport honors explicit preference over everything", () => {
  assert.equal(
    selectTransport({ preference: "ngrok", cloudflaredInstalled: true, namedTunnelConfigured: true }),
    TRANSPORT_NGROK,
  );
  assert.equal(
    selectTransport({ preference: "cloudflare-quick", cloudflaredInstalled: false }),
    TRANSPORT_CLOUDFLARE_QUICK,
  );
});

test("selectTransport auto-priority: named > quick > ngrok", () => {
  // named wins when configured
  assert.equal(
    selectTransport({ preference: "auto", cloudflaredInstalled: true, namedTunnelConfigured: true }),
    TRANSPORT_CLOUDFLARE_NAMED,
  );
  // quick is the greenfield default when cloudflared is present and no named tunnel
  assert.equal(
    selectTransport({ preference: "auto", cloudflaredInstalled: true, namedTunnelConfigured: false }),
    TRANSPORT_CLOUDFLARE_QUICK,
  );
  // ngrok fallback when cloudflared is absent
  assert.equal(
    selectTransport({ preference: "auto", cloudflaredInstalled: false, namedTunnelConfigured: false }),
    TRANSPORT_NGROK,
  );
  // unrecognized preference is treated as auto
  assert.equal(
    selectTransport({ preference: "bogus", cloudflaredInstalled: true }),
    TRANSPORT_CLOUDFLARE_QUICK,
  );
});

test("isStableTransport is true only for the named tunnel", () => {
  assert.equal(isStableTransport(TRANSPORT_CLOUDFLARE_NAMED), true);
  assert.equal(isStableTransport(TRANSPORT_CLOUDFLARE_QUICK), false);
  assert.equal(isStableTransport(TRANSPORT_NGROK), false);
});

test("buildQuickTunnelCommand builds correct argv and rejects bad ports", () => {
  assert.deepEqual(buildQuickTunnelCommand(8644), {
    command: "cloudflared",
    args: ["tunnel", "--url", "http://127.0.0.1:8644"],
  });
  assert.throws(() => buildQuickTunnelCommand(0));
  assert.throws(() => buildQuickTunnelCommand("nope"));
});

test("buildNamedTunnelCommand builds run argv and requires a name", () => {
  assert.deepEqual(buildNamedTunnelCommand("jobbored-discovery"), {
    command: "cloudflared",
    args: ["tunnel", "run", "jobbored-discovery"],
  });
  assert.throws(() => buildNamedTunnelCommand(""));
});
