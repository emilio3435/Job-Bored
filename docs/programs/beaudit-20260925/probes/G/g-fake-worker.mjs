// Fake discovery worker: answers /health like the real one. Usage: node g-fake-worker.mjs <port>
import { createServer } from "node:http";
const port = Number(process.argv[2] || 18173);
createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "browser-use-discovery-worker" })); })
  .listen(port, "127.0.0.1", () => console.log("fake worker on", port));
