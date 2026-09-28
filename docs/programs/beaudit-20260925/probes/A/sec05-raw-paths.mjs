// SEC-05 / A-crash probe: send raw request targets to a sandbox worker and check it survives.
// Usage: node .lane-evidence/probes/sec05-raw-paths.mjs [port]   (worker started via start-worker.sh)
import net from "node:net";

const port = Number(process.argv[2] || 18110);
const targets = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["/runs/%E0%A4%A", "/runs/%", "/%E0%A4%A", "/webhook%", "/runs/a%2Fb", "/runs/..%2F..", "//", "//x"];

function raw(target, method = "GET") {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    let data = "";
    const timer = setTimeout(() => { socket.destroy(); resolve("TIMEOUT"); }, 3000);
    socket.on("connect", () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    socket.on("data", (d) => { data += d; });
    socket.on("error", (e) => { clearTimeout(timer); resolve(`SOCKET_ERROR ${e.code}`); });
    socket.on("close", () => { clearTimeout(timer); resolve(data.split("\r\n")[0] + " | " + (data.split("\r\n\r\n")[1] || "").slice(0, 120)); });
  });
}

async function alive() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`);
    return `health=${r.status}`;
  } catch (e) {
    return `health=DOWN (${e.cause?.code || e.message})`;
  }
}

for (const t of targets) {
  const res = await raw(t);
  console.log(`${JSON.stringify(t)} -> ${res.trim() || "(empty reply)"} ; ${await alive()}`);
}
