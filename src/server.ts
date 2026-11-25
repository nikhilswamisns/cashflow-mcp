import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { dashboardSpec, metricSpec, summarize, METRIC_IDS, type MetricId } from "./metrics.js";
import type { ViewSpec } from "./spec.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEW_URI = "ui://kinnser/view.html";

const server = new McpServer({ name: "kinnser-mcp", version: "0.2.0" });

const result = (v: ViewSpec) => ({ content: [{ type: "text" as const, text: summarize(v) }], structuredContent: v as unknown as Record<string, unknown> });
const months = z.number().int().min(2).max(120).default(12).describe("How many months of history");

registerAppTool(
  server,
  "dashboard",
  {
    title: "Cash dashboard",
    description:
      "Show the company dashboard: KPI tiles (cash in, cash out, net, A/R overdue, runway), the cash balance with forecast, and cash in vs out by month. Call at the start of a chat or when the user asks how the business is doing.",
    inputSchema: z.object({ months }),
    _meta: { ui: { resourceUri: VIEW_URI } },
  },
  async ({ months }) => result(dashboardSpec(months)),
);

registerAppTool(
  server,
  "show_metric",
  {
    title: "Show a metric",
    description:
      "Show one metric as a chart. The best chart type is picked from the data. Metrics: " +
      "cash_balance (balance + forecast), cash_in_out (in vs out by month), cash_in_by_source (receipts by source), " +
      "ar_aging (receivables by days late), top_customers (revenue by customer), pay_speed_change (days-to-pay change per customer), " +
      "revenue_by_type (share by customer type), collections_vs_target (progress vs target by region), quote_to_cash (funnel), overdue_invoices (table).",
    inputSchema: z.object({ metric: z.enum(METRIC_IDS as [MetricId, ...MetricId[]]), months }),
    _meta: { ui: { resourceUri: VIEW_URI } },
  },
  async ({ metric, months }) => result(metricSpec(metric, months)),
);

registerAppResource(server, "Kinnser chart view", VIEW_URI, { description: "Tiles and charts; chart type picked from the data" }, async () => ({
  contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: await fs.readFile(path.join(ROOT, "dist/ui/view.html"), "utf-8") }],
}));

await server.connect(new StdioServerTransport());
