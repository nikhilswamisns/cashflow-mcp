// HTTP entry for claude.ai custom connectors from your laptop: npm run web, then expose the port with a tunnel.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { cashflowHttp } from "./http.js";
import { source } from "./data.js"; // also loads .env

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3000;

if ((process.env.CASHFLOW_AUTH_SECRET?.trim() ?? "").length < 32) {
  // first run: make one and keep it in .env so tokens survive restarts
  process.env.CASHFLOW_AUTH_SECRET = randomBytes(32).toString("base64url");
  fs.appendFileSync(path.join(ROOT, ".env"), `\nCASHFLOW_AUTH_SECRET=${process.env.CASHFLOW_AUTH_SECRET}\n`, { mode: 0o600 });
  console.error("Made CASHFLOW_AUTH_SECRET and saved it in .env");
}
if ((process.env.CASHFLOW_PASSWORD ?? "").length < 12) {
  console.error("Set CASHFLOW_PASSWORD (12+ characters) in .env: it is the password on the sign-in page.");
  process.exit(1);
}

const app = cashflowHttp();
const handle = toNodeHandler({ fetch: (req) => app(req) }, { onerror: (e) => console.error("[web]", e.message) });

http
  .createServer((req, res) => void handle(req, res))
  .listen(PORT, "127.0.0.1", () => {
    console.error(`cashflow-mcp on http://127.0.0.1:${PORT}  (data: ${source})`);
    console.error(`Tunnel it:  cloudflared tunnel --url http://localhost:${PORT}`);
    console.error(`Connector URL in claude.ai:  https://<tunnel-host>/mcp  (sign in with CASHFLOW_PASSWORD)`);
  });
