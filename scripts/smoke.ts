// Smoke test: spawn the server over stdio, list tools, call each tool, read the UI resource.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { METRIC_IDS } from "../src/metrics.js";

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: "npx", args: ["tsx", "src/server.ts"] }));

const { tools } = await client.listTools();
for (const name of ["dashboard", "show_metric"]) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} listed`);
  assert.equal((tool._meta as { ui?: { resourceUri?: string } })?.ui?.resourceUri, "ui://kinnser/view.html");
}

const res = await client.callTool({ name: "dashboard", arguments: { months: 24 } });
const d = res.structuredContent as { tiles: { label: string }[]; panels: { id: string; x: string[] }[] };
assert.equal(d.tiles.length, 5);
assert.deepEqual(d.panels.map((p) => p.id), ["cash_balance", "cash_in_out"]);
assert.equal(d.panels[1].x.length, 24);
const text = (res.content as { text: string }[])[0].text;
assert.match(text, /chart: line/);
assert.match(text, /chart: in-out/);

for (const metric of METRIC_IDS) {
  const r = await client.callTool({ name: "show_metric", arguments: { metric } });
  assert.ok(!r.isError, `${metric} ok`);
  assert.equal((r.structuredContent as { panels: { id: string }[] }).panels[0].id, metric);
}
const bad = await client.callTool({ name: "show_metric", arguments: { metric: "nope" } });
assert.ok(bad.isError, "unknown metric rejected");

const rr = await client.readResource({ uri: "ui://kinnser/view.html" });
const html = rr.contents[0] as { text: string; mimeType: string };
assert.match(html.mimeType, /mcp-app/);
assert.ok(!/<script[^>]+src=/.test(html.text) && html.text.length > 10_000, "bundled single-file HTML, no external scripts");

console.log(text.split("\n\n").slice(0, 3).join("\n\n"));
console.log("smoke OK");
await client.close();
