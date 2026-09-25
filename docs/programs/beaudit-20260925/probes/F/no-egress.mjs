// Lane F probe preload: fail every non-loopback fetch so a probe server can
// never reach a real provider, ATS, or Google. Loaded with `node --import`.
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return realFetch(input, init);
  console.error(`[no-egress] blocked ${init?.method || "GET"} ${url.origin}${url.pathname}`);
  throw new TypeError(`no-egress: blocked ${url.hostname}`);
};
