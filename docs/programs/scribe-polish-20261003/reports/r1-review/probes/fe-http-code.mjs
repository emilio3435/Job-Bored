import { readFileSync } from "node:fs";
import vm from "node:vm";
import { makeEnv } from "../../tests/fixtures/jb-dom.mjs";
const win = makeEnv({ bodyClass: "jb-v2" }); win.Date = Date;
vm.runInNewContext(readFileSync("scribe-v2-api.js", "utf8"), win);
const reply = (status, text) => async () => ({ ok: false, status, text: async () => text });
const live = (fetchImpl) => win.JBScribeApi.create({ mode: "live", slug: "acme", base: "http://example.invalid", fetchImpl });
for (const [label, status, text, method, args] of [
  ["save, JobBored 500 (HTML body)", 500, "<!DOCTYPE html><h1>Internal Server Error</h1>", "acceptEdit", ["p1", {}]],
  ["load versions, proxy 502", 502, "Bad Gateway", "listVersions", ["resume"]],
  ["bring back, 404 from an older server", 404, "<!DOCTYPE html>", "restore", ["r0"]],
]) {
  const err = await live(reply(status, text))[method](...args).catch((e) => e);
  console.log(label, "→", JSON.stringify({ code: err.code, message: err.message }));
}
