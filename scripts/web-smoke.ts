// Web smoke test: start the HTTP entry on sample data, sign in through OAuth like claude.ai, call a tool, read the view.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const PORT = 3917;
const PASSWORD = "smoke-password-123";
const base = `http://127.0.0.1:${PORT}`;
const CB = "http://localhost:6274/oauth/callback";
const proc = spawn("npx", ["tsx", "src/web.ts"], {
  env: { ...process.env, PORT: String(PORT), CASHFLOW_DATA: "sample", CASHFLOW_AUTH_SECRET: "smoke-auth-secret-0123456789abcdefghij", CASHFLOW_PASSWORD: PASSWORD },
  stdio: ["ignore", "ignore", "inherit"],
});

try {
  for (let i = 0; ; i++) {
    if (await fetch(`${base}/`).then(() => true, () => false)) break;
    if (i > 100) throw new Error("web server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal((await fetch(`${base}/mcp`, { method: "POST" })).status, 401, "no token, no MCP");

  const { client_id } = await (await fetch(`${base}/register`, { method: "POST", body: JSON.stringify({ redirect_uris: [CB] }) })).json();
  const verifier = "smoke-verifier-".padEnd(48, "x");
  const q = { response_type: "code", client_id, redirect_uri: CB, state: "s", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", password: PASSWORD };
  const a = await fetch(`${base}/authorize`, { method: "POST", body: new URLSearchParams(q), redirect: "manual" });
  assert.equal(a.status, 302);
  const code = new URL(a.headers.get("location")!).searchParams.get("code")!;
  const t = await (await fetch(`${base}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CB, client_id, code_verifier: verifier }) })).json();
  assert.ok(t.access_token, "token issued");

  const client = new Client({ name: "web-smoke", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${t.access_token}` } } }));
  const { tools } = await client.listTools();
  assert.ok(tools.some((x) => x.name === "visualize"), "visualize tool listed");
  const res = await client.callTool({ name: "dashboard", arguments: {} });
  assert.equal((res.structuredContent as { tiles: unknown[] }).tiles.length, 5);
  const rr = await client.readResource({ uri: "ui://cashflow/view.html" });
  assert.ok((rr.contents[0] as { text: string }).text.includes("<html"), "view html served");
  await client.close();
  console.log(`web smoke OK (OAuth sign-in, ${tools.length} tools over HTTP)`);
} finally {
  proc.kill();
}
