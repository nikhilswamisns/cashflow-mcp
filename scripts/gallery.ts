// Writes dist/ui/gallery.json: every metric plus the dashboard, for previewing the view in a browser.
import fs from "node:fs";
import { dashboardSpec, METRICS, METRIC_IDS } from "../src/metrics.js";
const d = dashboardSpec();
fs.writeFileSync("dist/ui/gallery.json", JSON.stringify({ ...d, title: "Gallery", panels: [...d.panels, ...METRIC_IDS.filter((i) => !["cash_balance", "cash_in_out"].includes(i)).map((i) => METRICS[i]())] }));
console.log("wrote dist/ui/gallery.json");
