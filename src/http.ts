// Web-standard MCP handler behind a secret last path segment; used by src/web.ts (laptop) and api/mcp/[secret].ts (Vercel).
// shortcut: the secret path is the only lock; add OAuth before other people or real data use a public URL.

import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { buildServer } from "./app.js";

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** 404 unless the path is <prefix>/<secret>; same answer for a wrong secret and a wrong path */
export function lockedMcp(secret: string, prefix: string) {
  if (secret.length < 32) throw new Error("CASHFLOW_WEB_SECRET must be at least 32 characters");
  const mcp = createMcpHandler(() => buildServer(), { onerror: (e) => console.error("[mcp]", e.message) });
  return {
    fetch: async (req: Request): Promise<Response> =>
      same(new URL(req.url).pathname, `${prefix}/${secret}`) ? mcp.fetch(req) : new Response(null, { status: 404 }),
  };
}
