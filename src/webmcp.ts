/** OpenHRV — WebMCP surface (fleet Phase 1.4w pattern):
 *  - discovery document at /.well-known/webmcp.json
 *  - tool execution endpoint at /api/webmcp (JSON, {tool, arguments})
 *  - client registration + telemetry beacon at /api/webmcp/beacon
 *  - advertised from robots.txt and llms.txt (generated in index.ts)
 */

export const WEBMCP_TOOLS = [
  {
    name: "openhrv_get_today",
    description: "Get today's Battery (readiness) and Pressure (stress) scores plus the latest HRV metrics for the owner.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    endpoint: { method: "GET", path: "/api/today" },
  },
  {
    name: "openhrv_list_measurements",
    description: "List recent HRV measurements (most recent first).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
      additionalProperties: false,
    },
    endpoint: { method: "GET", path: "/api/measurements" },
  },
  {
    name: "openhrv_create_measurement",
    description: "Create a measurement from RR intervals (milliseconds) and return computed HRV metrics.",
    inputSchema: {
      type: "object",
      properties: {
        rr_ms: { type: "array", items: { type: "number" }, minItems: 10 },
        source: { type: "string", default: "manual" },
      },
      required: ["rr_ms"],
      additionalProperties: false,
    },
    endpoint: { method: "POST", path: "/api/measurements" },
  },
  {
    name: "openhrv_get_mydata",
    description: "Category counts (measurements, sleep, journal, breathing, self-tests) and recent measurements.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    endpoint: { method: "GET", path: "/api/mydata" },
  },
];

export function webmcpDiscovery(origin: string): Record<string, unknown> {
  return {
    name: "OpenHRV",
    version: "1.0.0",
    description:
      "OpenHRV WebMCP tools. This single-user instance is locked to its owner via Cloudflare Access; tool calls require the same authenticated session as the web app.",
    protocol: "webmcp",
    discovery: `${origin}/.well-known/webmcp.json`,
    toolsEndpoint: `${origin}/api/webmcp`,
    beacon: `${origin}/api/webmcp/beacon`,
    tools: WEBMCP_TOOLS,
  };
}
