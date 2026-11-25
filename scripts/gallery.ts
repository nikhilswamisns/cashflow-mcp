// Writes preview specs into dist/ui/ so the view can be checked in a plain browser tab:
// gallery.json (every chart form), plot.json (Claude's table with a conflict), claude.json, browse.json, report.json.
import fs from "node:fs";
import { catalog, dashboardSpec, METRICS, METRIC_IDS, recommend } from "../src/metrics.js";
import { compare, inferPanel, type Table } from "../src/infer.js";
import type { BrowseSpec, Panel, ReportSpec, ViewSpec } from "../src/spec.js";

const out = (name: string, v: unknown) => fs.writeFileSync(`dist/ui/${name}.json`, JSON.stringify(v));
const d = dashboardSpec();
out("gallery", { ...d, title: "Gallery", panels: [...d.panels, ...METRIC_IDS.filter((i) => !["cash_balance", "cash_in_out"].includes(i)).map((i) => METRICS[i]())] });

const claude: Table = { title: "Top customers", columns: [{ name: "Customer" }, { name: "Revenue", unit: "usd" }], rows: [["Acme Health", 580_000], ["Northwind", 455_000], ["Bluebird Care", 398_000], ["Summit Rehab", 310_000]] };
const ours = METRICS.top_customers();
const check = { metric: "top_customers", ...compare(claude, ours) };
out("plot", { title: "Top customers", asOf: "2026-11", source: "sample", panels: [{ ...ours, insight: `Claude's answer differs on **${check.conflicts.length}** rows; this chart shows our data.` }], check } satisfies ViewSpec);

const visits: Table = { title: "Visits by discipline", sub: "This month", columns: [{ name: "Discipline" }, { name: "Visits" }], rows: [["PT", 120], ["OT", 80], ["SLP", 30], ["MSW", 12]] };
out("claude", { title: "Visits", asOf: "2026-11", source: "claude", panels: [inferPanel(visits) as Panel] } satisfies ViewSpec);
out("browse", { mode: "browse", query: "", items: catalog() } satisfies BrowseSpec);
out("report", { mode: "report", topic: "Collections update for the board", format: "report", recommended: recommend("Collections update for the board"), items: catalog(), extras: [inferPanel(visits) as Panel] } satisfies ReportSpec);
console.log("wrote dist/ui/{gallery,plot,claude,browse,report}.json");
