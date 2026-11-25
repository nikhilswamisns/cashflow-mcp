// Chart picker rules: each data shape gets the chart the two reference apps (and dataviz) use for it.
import assert from "node:assert/strict";
import { pickChart, rankTop, foldSeries, validatePanel, type Panel } from "../src/spec.js";
import { METRICS, METRIC_IDS } from "../src/metrics.js";

const x = ["2026-01", "2026-02", "2026-03"];
const s = (name: string, values: (number | null)[], role?: "plan" | "forecast" | "low" | "high") => ({ name, values, role });
const trend = (extra: Partial<Extract<Panel, { shape: "trend" }>>): Panel => ({ id: "t", title: "t", unit: "usd", shape: "trend", measure: "level", x, series: [s("a", [1, 2, 3])], ...extra } as Panel);
const brk = (extra: Partial<Extract<Panel, { shape: "breakdown" }>>): Panel => ({ id: "b", title: "b", unit: "usd", shape: "breakdown", x: ["A", "B"], series: [s("a", [1, 2])], ...extra } as Panel);

// time
assert.equal(pickChart(trend({})), "area", "one balance over time -> area");
assert.equal(pickChart(trend({ series: [s("a", [1, 2, 3]), s("plan", [1, 1, 1], "plan")] })), "line", "balance vs plan -> line");
assert.equal(pickChart(trend({ series: [s("a", [1, 2, 3]), s("b", [3, 2, 1])], parts: true })), "stacked-area", "balance parts -> stacked area");
assert.equal(pickChart(trend({ measure: "flow" })), "bars", "amount per month -> bars");
assert.equal(pickChart(trend({ measure: "flow", parts: true, series: [s("a", [1, 2, 3]), s("b", [3, 2, 1])] })), "stacked-bars");
assert.equal(pickChart(trend({ measure: "flow", inOut: true, series: [s("in", [1, 2, 3]), s("out", [3, 2, 1])] })), "in-out");

// categories
assert.equal(pickChart(brk({})), "ranked-hbars", "unordered categories -> ranked horizontal bars");
assert.equal(pickChart(brk({ ordered: true })), "columns", "aging buckets keep their order");
assert.equal(pickChart(brk({ series: [s("a", [1, -2])] })), "diverging-hbars", "signed values -> diverging");
assert.equal(pickChart(brk({ series: [s("a", [1, 2]), s("b", [2, 1])] })), "grouped-hbars");
assert.equal(pickChart(brk({ parts: true, series: [s("a", [1, 2]), s("b", [2, 1])] })), "stacked-hbars");

// share: donut only for <= 6 additive parts
const share = (n: number, unit: "usd" | "percent" = "usd"): Panel => ({ id: "s", title: "s", unit, shape: "share", x: Array.from({ length: n }, (_, i) => `p${i}`), values: Array(n).fill(1) });
assert.equal(pickChart(share(4)), "donut");
assert.equal(pickChart(share(7)), "ranked-hbars", "7 parts -> bars, slices can't be compared");
assert.equal(pickChart(share(3, "percent")), "ranked-hbars", "rates are not shares");

// validation at the boundary
assert.throws(() => validatePanel(trend({ series: [s("a", [1, 2])] })), /2 values for 3/);
assert.throws(() => pickChart(brk({ x: [], series: [s("a", [])] })), /empty/);

// ranking and folding
const r = rankTop(["a", "b", "c", "d"], [1, 4, 2, 3], "usd", 3);
assert.deepEqual(r, { labels: ["b", "d", "Other (2)"], values: [4, 3, 3] });
assert.deepEqual(rankTop(["a", "b", "c"], [10, 30, 20], "percent", 2).labels, ["b", "c"], "rates are not summed into Other");
const many = Array.from({ length: 10 }, (_, i) => s(`s${i}`, [i, i, i]));
const folded = foldSeries(many, true);
assert.equal(folded.length, 8);
assert.equal(folded[7].name, "Other (3)");
assert.deepEqual(folded[7].values, [3, 3, 3], "0+1+2 folded");

// every catalog metric validates and maps to the expected form
const expected: Record<string, string> = {
  cash_balance: "line", cash_in_out: "in-out", cash_in_by_source: "stacked-bars", ar_aging: "columns", top_customers: "ranked-hbars",
  pay_speed_change: "diverging-hbars", revenue_by_type: "donut", collections_vs_target: "bullet-rows", quote_to_cash: "funnel", overdue_invoices: "table",
};
for (const id of METRIC_IDS) assert.equal(pickChart(METRICS[id]()), expected[id], id);

console.log(`picker OK (${METRIC_IDS.length} metrics)`);
