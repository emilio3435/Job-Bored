// Owner: Backend Worker B — fill this out in swarm Phase 1.
// Cloudflare Worker that proxies discovery webhook traffic to a local ngrok
// tunnel target. Must:
//   - validate optional SHARED_SECRET bearer token
//   - forward POST /discovery to ${DISCOVERY_TARGET}/discovery
//   - forward GET  /runs/:runId to ${DISCOVERY_TARGET}/runs/:runId
//   - return 200 on GET /health
//   - never log request bodies (privacy)

export default {
  async fetch(request, env, ctx) {
    return new Response("relay template not implemented yet (swarm Phase 1)", {
      status: 501,
    });
  },
};
