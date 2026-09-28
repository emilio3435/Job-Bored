// Lane F probe: OpenAI-compatible stub LLM on 127.0.0.1:18161. No network.
// Mode is read per request from probes/stub-mode.txt so one server serves
// every scenario: good | empty | truncated | http500 | badjson-then-good.
// Every request is appended to probes/out/stub-log.jsonl.
import http from "node:http";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");
mkdirSync(outDir, { recursive: true });
const LOG = join(outDir, "stub-log.jsonl");
const PORT = Number(process.env.STUB_PORT || 18161);
let counter = 0;

function mode() {
  try { return readFileSync(join(here, "stub-mode.txt"), "utf8").trim() || "good"; }
  catch { return "good"; }
}

const GOOD_WRITER = {
  letter: {
    date: "September 25, 2026", company: "Acme Analytics", role: "Data Platform Engineer",
    hiringManager: "Hiring Team",
    hook: "Pipelines that analysts trust are the work I like best.",
    whyThem: "Acme's warehouse modernization and platform reliability goals match my background.",
    whyMe: "I have built streaming ingestion, warehouse modeling and observability for analytics teams.",
    whyNow: "Your platform roadmap needs someone who can ship reliability improvements quickly.",
    closing: "I would welcome a conversation.", flourish: "Thanks for reading.",
  },
  resume: {
    summary: { opener: "Platform engineer.", body: "Builds warehouse pipelines, streaming ingestion and observability." },
    roles: [{ id: "audacy-dsm", bullets: ["Built warehouse pipelines with streaming ingestion and observability."] }],
  },
};

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    counter += 1;
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    const sys = String(msgs.find((m) => m.role === "system")?.content || "");
    const user = String(msgs.find((m) => m.role === "user")?.content || "");
    const m = mode();
    const entry = {
      n: counter, mode: m, path: req.url, model: body.model, max_tokens: body.max_tokens,
      systemHead: sys.slice(0, 60), systemChars: sys.length, userChars: user.length,
      approxInputTokens: Math.round((sys.length + user.length) / 4),
      userHasEmilio: /Emilio Nunez-Garcia/.test(user),
      userHasProbeCandidate: /Pat Probe/.test(user),
      userHasVoiceSamples: user.includes("Voice samples:"),
      voiceSamplesHead: user.includes("Voice samples:") ? user.slice(user.indexOf("Voice samples:"), user.indexOf("Voice samples:") + 160) : "",
      isEditor: user.includes("Rewrite to hit the scorecard"),
    };
    appendFileSync(LOG, JSON.stringify(entry) + "\n");
    const send = (status, obj) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    const chat = (content) => send(200, { choices: [{ message: { role: "assistant", content } }] });
    if (m === "http500") return send(500, { error: "stub" });
    if (m === "empty") return chat("");
    if (m === "truncated") return chat('{"letter":{"hook":"Pipelines that analysts tr');
    return chat(JSON.stringify(GOOD_WRITER));
  });
});
server.listen(PORT, "127.0.0.1", () => console.log(`stub-llm listening 127.0.0.1:${PORT}`));
