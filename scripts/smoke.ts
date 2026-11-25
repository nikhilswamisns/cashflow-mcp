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

// plot: Claude's own table, no metric -> drawn as-is
const own = await client.callTool({ name: "plot", arguments: { title: "Visits by discipline", columns: [{ name: "Discipline" }, { name: "Visits" }], rows: [["PT", 120], ["OT", 80], ["SLP", 30]] } });
const ownSpec = own.structuredContent as { source: string; panels: { shape: string }[] };
assert.equal(ownSpec.source, "claude");
assert.equal(ownSpec.panels[0].shape, "breakdown");

// plot with a metric we own -> our numbers, conflict flagged, Claude told to correct
const chk = await client.callTool({ name: "plot", arguments: { title: "Top customers", metric: "top_customers", columns: [{ name: "Customer" }, { name: "Revenue", unit: "usd" }], rows: [["Acme Health", 580000], ["Northwind", 455000]] } });
const chkSpec = chk.structuredContent as { check: { conflicts: unknown[]; matched: number } };
assert.equal(chkSpec.check.matched, 2);
assert.equal(chkSpec.check.conflicts.length, 1);
assert.match((chk.content as { text: string }[])[0].text, /CONFLICT with our data \(top_customers\): Acme Health: your answer \$580,000 vs ours \$612,000/);

// plot with one row of numbers -> tiles only
const tiles = await client.callTool({ name: "plot", arguments: { title: "Headline", columns: [{ name: "Revenue", unit: "usd" }, { name: "Margin %", unit: "percent" }], rows: [[1200000, 18]] } });
assert.equal((tiles.structuredContent as { tiles: unknown[] }).tiles.length, 2);

const badTable = await client.callTool({ name: "plot", arguments: { title: "x", columns: [{ name: "a" }, { name: "b" }], rows: [["only one"]] } });
assert.ok(badTable.isError, "ragged table rejected");

// browse + report + compose
const br = await client.callTool({ name: "browse", arguments: { query: "overdue" } });
assert.equal((br.structuredContent as { mode: string }).mode, "browse");
assert.match((br.content as { text: string }[])[0].text, /overdue_invoices/);
const rp = await client.callTool({ name: "report", arguments: { topic: "Collections update for the board", extras: [{ title: "Visits", columns: [{ name: "Discipline" }, { name: "Visits" }], rows: [["PT", 120], ["OT", 80]] }] } });
const rpSpec = rp.structuredContent as { mode: string; recommended: string[]; extras: unknown[] };
assert.equal(rpSpec.mode, "report");
assert.ok(rpSpec.recommended.includes("collections_vs_target"), `recommended: ${rpSpec.recommended}`);
assert.equal(rpSpec.extras.length, 1);
const cp = await client.callTool({ name: "compose", arguments: { topic: "Board", ids: ["ar_aging", "collections_vs_target"], extras: rpSpec.extras, tiles: true } });
const cpSpec = cp.structuredContent as { view: { panels: unknown[]; tiles: unknown[] }; message: string };
assert.equal(cpSpec.view.panels.length, 3);
assert.equal(cpSpec.view.tiles.length, 5);
assert.match(cpSpec.message, /^Subject: Board/);
const badCompose = await client.callTool({ name: "compose", arguments: { topic: "x", ids: [], extras: [{ shape: "trend", x: ["a"], series: [{ name: "s", values: [1, 2] }], id: "z", title: "z", unit: "usd", measure: "flow" }] } });
assert.ok(badCompose.isError, "malformed extra panel rejected");

const rr = await client.readResource({ uri: "ui://kinnser/view.html" });
const html = rr.contents[0] as { text: string; mimeType: string };
assert.match(html.mimeType, /mcp-app/);
assert.ok(!/<script[^>]+src=/.test(html.text) && html.text.length > 10_000, "bundled single-file HTML, no external scripts");

console.log(text.split("\n\n").slice(0, 3).join("\n\n"));
console.log("smoke OK");
await client.close();
