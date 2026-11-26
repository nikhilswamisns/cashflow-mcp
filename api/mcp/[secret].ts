// Vercel function: https://<project>.vercel.app/api/mcp/<CASHFLOW_WEB_SECRET>
// Set CASHFLOW_WEB_SECRET (32+ chars) and the Zoho settings in Vercel > Settings > Environment Variables.
import { lockedMcp } from "../../src/http.js";

const secret = process.env.CASHFLOW_WEB_SECRET?.trim() ?? "";
const mcp = secret.length >= 32 ? lockedMcp(secret, "/api/mcp") : null;

export default {
  fetch: (req: Request) => (mcp ? mcp.fetch(req) : new Response("CASHFLOW_WEB_SECRET is not set (32+ characters)", { status: 503 })),
};
