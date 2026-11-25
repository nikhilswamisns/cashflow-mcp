import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { buildDashboard, mockMonths, summarize } from "./metrics.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEW_URI = "ui://kinnser/dashboard.html";

const server = new McpServer({ name: "kinnser-mcp", version: "0.1.0" });

registerAppTool(
  server,
  "dashboard",
  {
    title: "Cash dashboard",
    description:
      "Show the company cash dashboard: tiles for cash in, cash out, net cash flow, AR overdue and runway, plus a monthly cash in/out chart. Call this at the start of a chat or whenever the user asks about cash position.",
    inputSchema: z.object({ months: z.number().int().min(2).max(120).default(12).describe("How many months to chart") }),
    _meta: { ui: { resourceUri: VIEW_URI } },
  },
  async ({ months }) => {
    const d = buildDashboard(mockMonths(months), 2_350_000, 96_400, 14);
    return { content: [{ type: "text", text: summarize(d) }], structuredContent: d as unknown as Record<string, unknown> };
  },
);

registerAppResource(server, "Cash dashboard view", VIEW_URI, { description: "Tiles and cash chart" }, async () => ({
  contents: [{ uri: VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: await fs.readFile(path.join(ROOT, "dist/ui/dashboard.html"), "utf-8") }],
}));

await server.connect(new StdioServerTransport());
