// Probe G: killFullBootStalePorts (dev-server.mjs:1173) treats ANY checkout's worker as "ours".
// Pure call with injected findProcesses/killPid — nothing is killed, no ports bound.
import { killFullBootStalePorts } from "../../dev-server.mjs";
const foreign = "/usr/local/bin/node --experimental-strip-types /Users/someone/Other-Checkout.worktrees/ux01/integrations/browser-use-discovery/src/server.ts";
const hermes = "/usr/bin/python3 -m hermes.gateway --port 8644";
const killed = [];
const r = await killFullBootStalePorts({
  ports: [8644], workerPort: 8644, currentPid: 1,
  findProcesses: () => [{ pid: 4242, command: foreign }, { pid: 4343, command: hermes }],
  killPid: (pid) => killed.push(pid), waitAfterKillMs: 0,
});
console.log(JSON.stringify({ killed, blocked: r.blocked.map((b) => ({ pid: b.pid, action: b.action })) }, null, 2));
