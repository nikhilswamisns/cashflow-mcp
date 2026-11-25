import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { catalog, composeMessage, dashboardSpec, METRICS, metricSpec, recommend, search, summarize, METRIC_IDS, type MetricId } from "./metrics.js";
import { compare, inferPanel, type Table } from "./infer.js";
import { validatePanel, type BrowseSpec, type Panel, type ReportSpec, type Tile, type ViewSpec } from "./spec.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEW_URI = "ui://kinnser/view.html";
const UI = { ui: { resourceUri: VIEW_URI } };
const APP_ONLY = { ui: { resourceUri: VIEW_URI, visibility: ["app"] as ("app" | "model")[] } };

const server = new McpServer({ name: "kinnser-mcp", version: "0.3.0" });

const ok = (structured: object, text: string) => ({ content: [{ type: "text" as const, text }], structuredContent: structured as Record<string, unknown> });
const view = (v: ViewSpec) => ok(v, summarize(v));
const months = z.number().int().min(2).max(120).default(12).describe("How many months of history");
const metricId = z.enum(METRIC_IDS as [MetricId, ...MetricId[]]);
const METRIC_LIST =
  "cash_balance (balance + forecast), cash_in_out (in vs out by month), cash_in_by_source (receipts by source), " +
  "ar_aging (receivables by days late), top_customers (revenue by customer), pay_speed_change (days-to-pay change per customer), " +
  "revenue_by_type (share by customer type), collections_vs_target (progress vs target by region), quote_to_cash (funnel), overdue_invoices (table)";

const unit = z.enum(["usd", "count", "percent", "days"]);
const cell = z.union([z.string().max(200), z.number(), z.null()]);
const tableShape = {
  title: z.string().min(1).max(120),
  sub: z.string().max(200).optional(),
  columns: z.array(z.object({ name: z.string().min(1).max(80), unit: unit.optional() })).min(1).max(12),
  rows: z.array(z.array(cell)).max(500),
  hint: z.enum(["trend", "breakdown", "share", "progress", "funnel", "table", "tiles"]).optional().describe("Only if the auto-pick would be wrong"),
};

registerAppTool(server, "dashboard", {
  title: "Cash dashboard",
  description: "Show the company dashboard: KPI tiles (cash in, cash out, net, A/R overdue, runway), the cash balance with forecast, and cash in vs out by month. Call at the start of a chat or when the user asks how the business is doing.",
  inputSchema: z.object({ months }),
  _meta: UI,
}, async ({ months }) => view(dashboardSpec(months)));

registerAppTool(server, "show_metric", {
  title: "Show a metric",
  description: `Show one metric from our data as a chart; the best chart type is picked from the data. Metrics: ${METRIC_LIST}.`,
  inputSchema: z.object({ metric: metricId, months }),
  _meta: UI,
}, async ({ metric, months }) => view(metricSpec(metric, months)));

registerAppTool(server, "plot", {
  title: "Chart your answer",
  description:
    "After you answer with numbers, call this with the table behind your answer to show it as an interactive chart + table. " +
    "Send a plain table: columns (name, optional unit usd|count|percent|days) and rows. The chart type is picked automatically: " +
    "months -> trend, category + number -> ranked bars, parts that add up -> donut, actual + target -> progress bars, one row of numbers -> KPI tiles. " +
    `If the table is about one of our metrics (${METRIC_LIST}), set metric: your numbers are checked against our data and conflicts are shown. ` +
    "Skip this tool when the answer has no numbers worth charting.",
  inputSchema: z.object({ ...tableShape, metric: metricId.optional() }),
  _meta: UI,
}, async (args) => {
  const t = args as Table & { metric?: MetricId };
  const inferred = inferPanel(t);
  const asOf = "2026-11";
  if ("tiles" in inferred) return view({ title: t.title, asOf, source: "claude", tiles: inferred.tiles, panels: [] });
  if (!t.metric) return view({ title: t.title, asOf, source: "claude", panels: [inferred] });
  // we have this data: draw ours and flag where Claude's numbers differ
  const ours = METRICS[t.metric]();
  const check = { metric: t.metric, ...compare(t, ours) };
  const flagged: Panel = check.conflicts.length
    ? { ...ours, insight: `Claude's answer differs on **${check.conflicts.length}** row${check.conflicts.length > 1 ? "s" : ""}; this chart shows our data.` }
    : ours;
  return view({ title: t.title, asOf, source: "sample", panels: [flagged], check });
});

registerAppTool(server, "browse", {
  title: "Search charts and data",
  description: "Open a search box over every chart and dataset we have, so the user can find and open one. Use when the user asks what data or charts are available, or to search for one.",
  inputSchema: z.object({ query: z.string().max(200).default("") }),
  _meta: UI,
}, async ({ query }) => {
  const spec: BrowseSpec = { mode: "browse", query, items: catalog() };
  const hits = search(query);
  return ok(spec, `Opened the chart search${query ? ` for "${query}"` : ""}. ${hits.length} match: ${hits.map((h) => `${h.id} (${h.title})`).join(", ")}. The user picks one in the view.`);
});

registerAppTool(server, "report", {
  title: "Build a report or message",
  description:
    "Open a report builder when the user asks to create a report, summary, update or message. Sections that fit the topic are pre-selected; the user can add or remove others, then create it and download or copy it. " +
    `Pass recommended metric ids (${METRIC_IDS.join(", ")}) if you know what fits; pass tables from your own answer as extras.`,
  inputSchema: z.object({
    topic: z.string().min(1).max(200),
    format: z.enum(["report", "message"]).default("report"),
    recommended: z.array(metricId).max(10).optional(),
    extras: z.array(z.object(tableShape)).max(5).optional(),
  }),
  _meta: UI,
}, async ({ topic, format, recommended, extras }) => {
  const rec = recommended?.length ? recommended : recommend(topic);
  const extraPanels = (extras ?? []).map((t) => inferPanel(t as Table)).filter((p): p is Panel => !("tiles" in p));
  const spec: ReportSpec = { mode: "report", topic, format, recommended: rec, items: catalog(), extras: extraPanels };
  return ok(spec, `Opened the ${format} builder for "${topic}". Pre-selected: ${rec.join(", ")}${extraPanels.length ? ` plus ${extraPanels.length} table(s) from your answer` : ""}. The user adjusts and creates it in the view.`);
});

// called by the view only: assemble the chosen sections
registerAppTool(server, "compose", {
  title: "Compose report",
  description: "Assemble chosen sections into a report and message text.",
  inputSchema: z.object({ topic: z.string().max(200), ids: z.array(metricId).max(10), extras: z.array(z.unknown()).max(5).default([]), tiles: z.boolean().default(true) }),
  _meta: APP_ONLY,
}, async ({ topic, ids, extras, tiles }) => {
  const extraPanels = extras as Panel[];
  extraPanels.forEach(validatePanel);
  const panels = [...ids.map((id) => METRICS[id]()), ...extraPanels];
  const t: Tile[] = tiles ? dashboardSpec().tiles ?? [] : [];
  const v: ViewSpec = { title: topic, asOf: "2026-11", source: "sample", tiles: t, panels };
  const message = composeMessage(topic, panels, t);
  return ok({ view: v, message }, `Report "${topic}" built with ${panels.length} sections.`);
});

registerAppResource(server, "Kinnser chart view", VIEW_URI, { description: "Charts, tables, search and report builder" }, async () => ({
  contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: await fs.readFile(path.join(ROOT, "dist/ui/view.html"), "utf-8") }],
}));

await server.connect(new StdioServerTransport());
