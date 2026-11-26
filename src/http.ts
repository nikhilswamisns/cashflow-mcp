// The HTTP app shared by src/web.ts (laptop + tunnel) and api/handler.ts (Vercel): MCP at /mcp behind OAuth (src/auth.ts).

import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer } from "./app.js";
import { withOAuth } from "./auth.js";

export function cashflowHttp(env: NodeJS.ProcessEnv = process.env) {
  const mcp = createMcpHandler(() => buildServer(), { onerror: (e) => console.error("[mcp]", e.message) });
  return withOAuth((req) => mcp.fetch(req), {
    authSecret: env.CASHFLOW_AUTH_SECRET?.trim() ?? "",
    password: env.CASHFLOW_PASSWORD ?? "",
    publicUrl: env.CASHFLOW_PUBLIC_URL?.trim() || undefined,
  });
}
