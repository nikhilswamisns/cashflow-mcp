// HTTP entry for claude.ai custom connectors: npm run web, then expose the port with a tunnel.
// shortcut: the only lock is a long random secret in the URL path; move to OAuth before anyone else uses it.

import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { buildServer } from "./app.js";
import { source } from "./data.js"; // also loads .env

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3000;

let secret = process.env.CASHFLOW_WEB_SECRET?.trim() ?? "";
if (secret.length < 32) {
  // first run: make one and keep it in .env so the connector URL survives restarts
  secret = randomBytes(24).toString("base64url");
  fs.appendFileSync(path.join(ROOT, ".env"), `\nCASHFLOW_WEB_SECRET=${secret}\n`, { mode: 0o600 });
  console.error("Made CASHFLOW_WEB_SECRET and saved it in .env");
}

const want = Buffer.from(`/mcp/${secret}`);
const allowed = (url = "") => {
  const got = Buffer.from(url.split("?")[0]);
  return got.length === want.length && timingSafeEqual(got, want);
};

const mcp = toNodeHandler(createMcpHandler(() => buildServer(), { onerror: (e) => console.error("[mcp]", e.message) }));

http
  .createServer((req, res) => {
    if (!allowed(req.url)) {
      res.writeHead(404).end(); // same answer for a wrong secret and a wrong path
      return;
    }
    mcp(req, res).catch((e: Error) => {
      console.error("[web]", e.message);
      if (!res.headersSent) res.writeHead(500).end();
    });
  })
  .listen(PORT, "127.0.0.1", () => {
    console.error(`cashflow-mcp on http://127.0.0.1:${PORT}/mcp/${secret}  (data: ${source})`);
    console.error(`Tunnel it:  cloudflared tunnel --url http://localhost:${PORT}`);
    console.error(`Connector URL in claude.ai:  https://<tunnel-host>/mcp/${secret}`);
  });
