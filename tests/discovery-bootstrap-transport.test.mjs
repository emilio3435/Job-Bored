import assert from "node:assert/strict";
import test from "node:test";

import { buildTransportState } from "../scripts/bootstrap-local-discovery.mjs";
import {
  TRANSPORT_CLOUDFLARE_NAMED,
  TRANSPORT_CLOUDFLARE_QUICK,
  TRANSPORT_NGROK,
} from "../scripts/lib/discovery-transport.mjs";

test("buildTransportState marks only the named tunnel stable and persists its name", () => {
  const named = buildTransportState({
    kind: TRANSPORT_CLOUDFLARE_NAMED,
    publicUrl: "https://discovery.example.com/",
    tunnelName: "jobbored-discovery",
  });
  // Stable so the keepalive skips resync; tunnelName lets the autostart rebuild
  // `cloudflared tunnel run <name>`.
  assert.deepEqual(named, {
    kind: TRANSPORT_CLOUDFLARE_NAMED,
    publicUrl: "https://discovery.example.com/",
    stable: true,
    tunnelName: "jobbored-discovery",
  });
});

test("buildTransportState keeps cloudflare_quick rotating (unstable, no name)", () => {
  const quick = buildTransportState({
    kind: TRANSPORT_CLOUDFLARE_QUICK,
    publicUrl: "https://abc.trycloudflare.com/",
    // A name passed for a non-named transport must NOT be persisted.
    tunnelName: "ignored",
  });
  assert.deepEqual(quick, {
    kind: TRANSPORT_CLOUDFLARE_QUICK,
    publicUrl: "https://abc.trycloudflare.com/",
    stable: false,
  });
});

test("buildTransportState keeps ngrok rotating and tolerates a missing URL", () => {
  const ngrok = buildTransportState({ kind: TRANSPORT_NGROK, publicUrl: "" });
  assert.deepEqual(ngrok, {
    kind: TRANSPORT_NGROK,
    publicUrl: "",
    stable: false,
  });
});

test("buildTransportState omits the name when a named tunnel has none", () => {
  const named = buildTransportState({
    kind: TRANSPORT_CLOUDFLARE_NAMED,
    publicUrl: "https://discovery.example.com/",
    tunnelName: "",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(named, "tunnelName"), false);
  assert.equal(named.stable, true);
});
