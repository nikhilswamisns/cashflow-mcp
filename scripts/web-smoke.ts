// Web smoke test: start the HTTP entry on sample data, check the secret lock, call a tool, read the view.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const PORT = 3917;
const SECRET = "smoke-secret-0123456789abcdefghijklmnop";
const base = `http://127.0.0.1:${PORT}`;
const proc = spawn("npx", ["tsx", "src/web.ts"], { env: { ...process.env, PORT: String(PORT), CASHFLOW_DATA: "sample", CASHFLOW_WEB_SECRET: SECRET }, stdio: ["ignore", "ignore", "inherit"] });

try {
  for (let i = 0; ; i++) {
    const up = await fetch(`${base}/`).then(() => true, () => false);
    if (up) break;
    if (i > 100) throw new Error("web server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const p of ["/", "/mcp", "/mcp/wrong-secret-0123456789abcdefghijklmn", `/mcp/${SECRET}x`]) {
    assert.equal((await fetch(base + p, { method: "POST" })).status, 404, `${p} must be locked`);
  }

  const client = new Client({ name: "web-smoke", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${SECRET}`)));
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "visualize"), "visualize tool listed");
  const res = await client.callTool({ name: "dashboard", arguments: {} });
  assert.equal((res.structuredContent as { tiles: unknown[] }).tiles.length, 5);
  const rr = await client.readResource({ uri: "ui://cashflow/view.html" });
  assert.ok((rr.contents[0] as { text: string }).text.includes("<html"), "view html served");
  await client.close();
  console.log(`web smoke OK (${tools.length} tools over HTTP, wrong paths 404)`);
} finally {
  proc.kill();
}
