// Smoke test: spawn the server over stdio, list tools, call dashboard, read the UI resource.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/server.ts"] }));

const { tools } = await client.listTools();
const dash = tools.find((t) => t.name === "dashboard");
assert.ok(dash, "dashboard tool listed");
const uri = (dash._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri;
assert.equal(uri, "ui://kinnser/dashboard.html");

const res = await client.callTool({ name: "dashboard", arguments: { months: 24 } });
const d = res.structuredContent as { tiles: { key: string; value: number }[]; series: { cashIn: number; cashOut: number }[] };
assert.equal(d.series.length, 24);
assert.deepEqual(d.tiles.map((t) => t.key), ["cash_in", "cash_out", "net", "ar_overdue", "runway"]);
const last = d.series[23];
assert.equal(d.tiles[2].value, last.cashIn - last.cashOut, "net = in - out");

const r = await client.readResource({ uri: uri! });
const html = (r.contents[0] as { text: string; mimeType: string });
assert.match(html.mimeType, /mcp-app/);
assert.ok(!/<script[^>]+src=/.test(html.text) && html.text.length > 10_000, "bundled single-file HTML, no external scripts");

console.log((res.content as { text: string }[])[0].text);
console.log("smoke OK");
await client.close();
