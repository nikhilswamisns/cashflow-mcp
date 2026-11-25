// Table -> panel detection and the conflict check against our data.
import assert from "node:assert/strict";
import { compare, inferPanel, toMonth, toNumber, type Table } from "../src/infer.js";
import { pickChart, type Panel } from "../src/spec.js";
import { METRICS, recommend, search, composeMessage } from "../src/metrics.js";

const form = (t: Table) => {
  const p = inferPanel(t);
  return "tiles" in p ? "tiles" : pickChart(p);
};
const T = (columns: string[], rows: (string | number | null)[][], extra: Partial<Table> = {}): Table => ({ title: "t", columns: columns.map((name) => ({ name })), rows, ...extra });

// parsing
assert.equal(toMonth("Nov 2026"), "2026-11");
assert.equal(toMonth("November '26"), "2026-11");
assert.equal(toMonth("2026-03-31"), "2026-03");
assert.equal(toMonth("11/2026"), "2026-11");
assert.equal(toMonth("Acme"), null);
assert.equal(toNumber("$1,234.50"), 1234.5);
assert.equal(toNumber("(500)"), -500);
assert.equal(toNumber("12%"), 12);
assert.equal(toNumber("1.2M"), 1_200_000);
assert.equal(toNumber("n/a"), null);

// shape detection
assert.equal(form(T(["Month", "Revenue"], [["Jan 2026", "$10,000"], ["Feb 2026", "$12,000"], ["Mar 2026", "$11,000"]])), "bars", "money per month -> bars");
assert.equal(form(T(["Month", "Cash balance"], [["2026-01", 100], ["2026-02", 120]])), "area", "balance per month -> area");
assert.equal(form(T(["Month", "Revenue", "Budget"], [["2026-01", 10, 11], ["2026-02", 12, 11]])), "bars", "actual + plan per month stays a trend");
assert.equal(form(T(["Customer", "Revenue"], [["A", 5], ["B", 9], ["C", 2]])), "ranked-hbars");
assert.equal(form(T(["Age", "Amount"], [["Not due", 5], ["1-30", 9], ["31-60", 2], ["90+", 1]])), "columns", "aging buckets keep order");
assert.equal(form(T(["Type", "Share %"], [["Home", "57%"], ["Hospice", "24%"], ["Private", "19%"]])), "donut", "percent split adding to 100 -> donut");
assert.equal(form(T(["Region", "Collected", "Target"], [["N", 80, 100], ["S", 50, 90]])), "bullet-rows", "actual vs target -> bullet rows");
assert.equal(form(T(["Revenue", "Cash", "Runway days"], [[100, 50, 30]])), "tiles", "one row of numbers -> tiles");
assert.equal(form(T(["Customer", "Revenue", "Days late"], [["A", "$5", 3], ["B", "$9", 4]])), "table", "mixed units never share an axis");
assert.equal(form(T(["Customer", "Owner", "Status"], [["A", "Jo", "open"]])), "table", "no numbers -> table");
assert.equal(form(T(["Stage", "Count"], [["Quotes", 100], ["Won", 40]], { hint: "funnel" })), "funnel", "hint wins");
assert.throws(() => inferPanel(T(["a", "b"], [["x"]])), /row 1 has 1 cells for 2 columns/);

// conflict check against our top_customers data
const ours: Panel = METRICS.top_customers();
const check = compare(T(["Customer", "Revenue"], [["Acme Health Inc.", "$580,000"], ["northwind", 455_000], ["Bluebird Care", "$398K"], ["Unknown Co", 10]]), ours);
assert.equal(check.matched, 3, "names match despite case, suffix and $K");
assert.deepEqual(check.conflicts, [{ label: "Acme Health Inc.", claude: 580_000, ours: 612_000 }]);
assert.deepEqual(check.unmatched, ["Unknown Co"]);
const months = compare(T(["Month", "Cash in"], [["Nov 2026", 1]]), METRICS.cash_in_out());
assert.equal(months.matched, 1, "month labels normalise to YYYY-MM");
assert.equal(months.conflicts.length, 1);

// search, recommendations, message
assert.equal(search("overdue invoices")[0].id, "overdue_invoices");
assert.equal(search("who owes us money late")[0].id, "ar_aging");
const rec = recommend("monthly cash update");
assert.ok(rec.includes("cash_balance") && rec.includes("cash_in_out") && rec.length === 4, `cash basics pre-selected: ${rec}`);
assert.deepEqual(recommend("zzz"), ["cash_balance", "cash_in_out", "ar_aging"], "fallback to cash basics");
const msg = composeMessage("Board update", [METRICS.ar_aging(), METRICS.collections_vs_target()]);
assert.match(msg, /Subject: Board update/);
assert.match(msg, /Receivables by age: \$96K is more than 30 days late/);
assert.match(msg, /3 of 4 behind target: North 91%, South 76%, West 38%/);

console.log("infer OK");
