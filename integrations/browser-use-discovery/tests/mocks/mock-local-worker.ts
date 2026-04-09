type DiscoveryFixtures = {
  health: Record<string, unknown>;
  ack: Record<string, unknown>;
  expectedRequest: Record<string, unknown>;
};

function corsHeaders(origin: string) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-discovery-secret",
    vary: "origin",
  };
}

export function createMockLocalWorker(fixtures: DiscoveryFixtures) {
  return {
    healthResponse(origin = "http://localhost:8080") {
      return new Response(JSON.stringify(fixtures.health), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders(origin),
        },
      });
    },
    async acceptDiscovery(
      body: unknown,
      origin = "http://localhost:8080",
    ): Promise<Response> {
      const payload = body && typeof body === "object" ? body : {};
      const req = fixtures.expectedRequest;
      if (payload.event !== req.event) {
        throw new Error(`unexpected event: ${String(payload.event || "")}`);
      }
      if (payload.schemaVersion !== req.schemaVersion) {
        throw new Error(
          `unexpected schemaVersion: ${String(payload.schemaVersion || "")}`,
        );
      }
      if (payload.sheetId !== req.sheetId) {
        throw new Error(`unexpected sheetId: ${String(payload.sheetId || "")}`);
      }
      if (!String(payload.variationKey || "").startsWith("var-")) {
        throw new Error("variationKey must be populated");
      }
      return new Response(JSON.stringify(fixtures.ack), {
        status: 202,
        headers: {
          "content-type": "application/json; charset=utf-8",
          ...corsHeaders(origin),
        },
      });
    },
  };
}
