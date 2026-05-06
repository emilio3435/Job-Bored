const DEFAULT_TUNNELS = [
  {
    name: "command-center-discovery",
    proto: "https",
    public_url: "https://qa-discovery.ngrok-free.app",
    config: {
      addr: "http://127.0.0.1:8644",
    },
  },
];

export function createNgrokApiFetch({
  tunnels = DEFAULT_TUNNELS,
  status = 200,
  body = null,
  headers = { "content-type": "application/json" },
} = {}) {
  const calls = [];

  async function fetch(url, init = {}) {
    calls.push({ url: String(url), init });
    const parsed = new URL(String(url));

    if (parsed.pathname !== "/api/tunnels") {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers,
      });
    }

    const payload = body || { tunnels };
    return new Response(JSON.stringify(payload), { status, headers });
  }

  fetch.calls = calls;
  fetch.setTunnels = (nextTunnels) => {
    tunnels = Array.isArray(nextTunnels) ? nextTunnels : [];
  };

  return fetch;
}

export default createNgrokApiFetch;
