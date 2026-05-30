import assert from "node:assert/strict";
import test from "node:test";

import {
  isTcpPortFree,
  findAvailableWorkerPort,
  portHasForeignListener,
} from "../scripts/bootstrap-local-discovery.mjs";

// A minimal fake `net` server whose listen() either succeeds (port free) or
// errors (port in use), mirroring how isTcpPortFree probes a bind.
function fakeServerFactory(free) {
  return () => {
    const handlers = {};
    return {
      once(event, cb) {
        handlers[event] = cb;
      },
      listen() {
        queueMicrotask(() => {
          if (free) handlers.listening && handlers.listening();
          else handlers.error && handlers.error(new Error("EADDRINUSE"));
        });
      },
      close() {},
    };
  };
}

test("isTcpPortFree resolves true when the bind succeeds and false on error", async () => {
  assert.equal(
    await isTcpPortFree(8644, { createServerImpl: fakeServerFactory(true) }),
    true,
  );
  assert.equal(
    await isTcpPortFree(8644, { createServerImpl: fakeServerFactory(false) }),
    false,
  );
});

test("findAvailableWorkerPort scans upward and skips occupied ports", async () => {
  // 8644 and 8645 occupied, 8646 free.
  const isPortFree = async (port) => port >= 8646;
  const chosen = await findAvailableWorkerPort(8644, { isPortFree, maxScan: 10 });
  assert.equal(chosen, 8646);
});

test("findAvailableWorkerPort returns the start port when it is already free", async () => {
  const isPortFree = async () => true;
  const chosen = await findAvailableWorkerPort(8645, { isPortFree, maxScan: 10 });
  assert.equal(chosen, 8645);
});

test("portHasForeignListener flags a non-worker listener (e.g. Hermes)", () => {
  const result = portHasForeignListener(8644, {
    findProcesses: () => [
      { pid: 1, command: "python -m hermes_cli.main gateway run --replace" },
    ],
  });
  assert.equal(result.foreign, true);
  assert.equal(result.foreignProcesses.length, 1);
});

test("portHasForeignListener does NOT flag the JobBored worker itself", () => {
  const result = portHasForeignListener(8644, {
    findProcesses: () => [
      { pid: 2, command: "node integrations/browser-use-discovery/src/server.ts" },
    ],
  });
  assert.equal(result.foreign, false);
});

test("portHasForeignListener treats an empty port as not foreign", () => {
  const result = portHasForeignListener(8644, { findProcesses: () => [] });
  assert.equal(result.foreign, false);
});
