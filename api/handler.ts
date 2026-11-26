// Vercel function: every path is rewritten here (vercel.json), MCP at https://<project>.vercel.app/mcp behind OAuth.
// Set CASHFLOW_AUTH_SECRET (32+ chars), CASHFLOW_PASSWORD (12+ chars) and the Zoho settings in Vercel > Settings > Environment Variables.
import { cashflowHttp } from "../src/http.js";

let app: ReturnType<typeof cashflowHttp> | null = null;
let setupError = "";
try {
  app = cashflowHttp();
} catch (e) {
  setupError = (e as Error).message;
}

export default {
  fetch(req: Request): Promise<Response> | Response {
    if (!app) return new Response(`Not configured: ${setupError}`, { status: 503 });
    // the rewrite passes the original path as __p, in case the function only sees /api/handler
    const p = new URL(req.url).searchParams.get("__p");
    return p === null ? app(req) : app(req, `/${p}`);
  },
};
