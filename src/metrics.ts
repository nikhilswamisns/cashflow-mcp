// Metric catalog. Each metric builds a Panel from data; the view picks the chart.
// shortcut: deterministic sample data, replace each builder's input with Zoho Books / Zoho Analytics calls.

import type { CatalogItem, Panel, Tile, ViewSpec, Unit } from "./spec.js";
import { pickChart } from "./spec.js";

const END = { y: 2026, m: 10 }; // Nov 2026, month index 0-based
function months(n: number, offset = 0): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(END.y, END.m - (n - 1) + i + offset, 1));
    return d.toISOString().slice(0, 7);
  });
}
const wave = (n: number, base: number, slope: number, amp: number, phase = 0) =>
  Array.from({ length: n }, (_, t) => Math.round(base + slope * t + amp * Math.sin(t / 2 + phase)));

function cashFlows(n: number) {
  const x = months(n);
  const cashIn = wave(n, 300_000, 6_000, 40_000);
  const cashOut = wave(n, 290_000, 4_500, 25_000, 1.4);
  return { x, cashIn, cashOut };
}

export const METRICS = {
  cash_balance(n = 12): Panel {
    const { x, cashIn, cashOut } = cashFlows(n);
    let bal = 1_900_000;
    const actual = cashIn.map((v, i) => (bal += v - cashOut[i]));
    const fx = months(3, 3); // next 3 months
    const last = actual[actual.length - 1];
    const fc = [1, 2, 3].map((k) => last + k * 14_000);
    const pad = (a: (number | null)[], before: number, after: number) => [...Array(before).fill(null), ...a, ...Array(after).fill(null)];
    return {
      id: "cash_balance", shape: "trend", measure: "level", unit: "usd", kind: "prediction",
      title: "Cash balance", sub: "Month-end bank balance, then the next 3 months forecast",
      x: [...x, ...fx],
      series: [
        { name: "Actual", values: pad(actual, 0, 3) },
        { name: "Forecast", role: "forecast", values: pad([last, ...fc], n - 1, 0) },
        { name: "Low", role: "low", values: pad([last, ...fc.map((v, k) => v - 40_000 * (k + 1))], n - 1, 0) },
        { name: "High", role: "high", values: pad([last, ...fc.map((v, k) => v + 40_000 * (k + 1))], n - 1, 0) },
      ],
      insight: `Forecast ends near **$${(fc[2] / 1e6).toFixed(2)}M** in ${fx[2]}; the band is the likely range.`,
    };
  },

  cash_in_out(n = 12): Panel {
    const { x, cashIn, cashOut } = cashFlows(n);
    const net = cashIn.map((v, i) => v - cashOut[i]);
    const neg = net.filter((v) => v < 0).length;
    return {
      id: "cash_in_out", shape: "trend", measure: "flow", unit: "usd", inOut: true,
      title: "Cash in and out by month", sub: "Receipts go up, payments go down. The line is the net.",
      x, series: [{ name: "Cash in", values: cashIn }, { name: "Cash out", values: cashOut }],
      insight: neg ? `Net was negative in **${neg} of ${n}** months.` : `Net was positive every month.`,
    };
  },

  cash_in_by_source(n = 12): Panel {
    const x = months(n);
    return {
      id: "cash_in_by_source", shape: "trend", measure: "flow", unit: "usd", parts: true,
      title: "Cash in by source", sub: "Monthly receipts split by where they came from",
      x, series: [
        { name: "Invoices paid", values: wave(n, 180_000, 3_000, 20_000) },
        { name: "Retainers", values: wave(n, 60_000, 800, 6_000, 1) },
        { name: "Insurance", values: wave(n, 45_000, 1_200, 9_000, 2) },
        { name: "Other", values: wave(n, 15_000, 0, 4_000, 3) },
      ],
    };
  },

  ar_aging(): Panel {
    return {
      id: "ar_aging", shape: "breakdown", ordered: true, unit: "usd", goodWhen: "lower",
      title: "Receivables by age", sub: "Open invoices by days past due",
      x: ["Not due", "1–30", "31–60", "61–90", "90+"],
      series: [{ name: "Open A/R", values: [212_000, 84_000, 31_500, 18_200, 46_700] }],
      insight: "**$96K** is more than 30 days late; **$47K** of it is past 90 days.",
    };
  },

  top_customers(): Panel {
    const names = ["Acme Health", "Northwind", "Bluebird Care", "Summit Rehab", "Harbor Home", "Cedar Clinic", "Lakeview", "Pinecrest", "Oakridge", "Riverside", "Maple Grove", "Sunset Senior", "Westfield"];
    return {
      id: "top_customers", shape: "breakdown", unit: "usd",
      title: "Revenue by customer", sub: "Last 12 months, largest first",
      x: names, series: [{ name: "Revenue", values: [612_000, 455_000, 398_000, 290_000, 264_000, 201_000, 188_000, 120_000, 96_000, 72_000, 51_000, 40_000, 22_000] }],
    };
  },

  pay_speed_change(): Panel {
    return {
      id: "pay_speed_change", shape: "breakdown", unit: "days", goodWhen: "lower",
      title: "Change in days to pay", sub: "vs a year ago; negative = paying faster",
      x: ["Acme Health", "Northwind", "Bluebird Care", "Summit Rehab", "Harbor Home", "Cedar Clinic"],
      series: [{ name: "Change (days)", values: [-6, 4, 12, -2, 9, -11] }],
    };
  },

  revenue_by_type(): Panel {
    return {
      id: "revenue_by_type", shape: "share", unit: "usd",
      title: "Revenue by customer type", sub: "Last 12 months",
      x: ["Home health", "Hospice", "Private pay", "Outpatient"],
      values: [1_420_000, 610_000, 280_000, 190_000],
    };
  },

  collections_vs_target(): Panel {
    return {
      id: "collections_vs_target", shape: "progress", unit: "usd",
      title: "Collections against target", sub: "Year to date; tick = projected year end, line = target",
      rows: [
        { label: "North", actual: 820_000, target: 900_000, projected: 1_010_000 },
        { label: "South", actual: 610_000, target: 800_000, projected: 740_000 },
        { label: "East", actual: 455_000, target: 420_000, projected: 540_000 },
        { label: "West", actual: 190_000, target: 500_000, projected: 260_000 },
      ],
    };
  },

  quote_to_cash(): Panel {
    return {
      id: "quote_to_cash", shape: "funnel", unit: "count",
      title: "Quote to cash", sub: "Last 90 days",
      rows: [{ label: "Quotes sent", value: 420 }, { label: "Accepted", value: 238 }, { label: "Invoiced", value: 221 }, { label: "Paid", value: 174 }],
    };
  },

  overdue_invoices(): Panel {
    return {
      id: "overdue_invoices", shape: "table", unit: "usd",
      title: "Most overdue invoices",
      columns: [{ key: "customer", label: "Customer" }, { key: "invoice", label: "Invoice" }, { key: "days", label: "Days late", unit: "days" }, { key: "amount", label: "Amount", unit: "usd" }],
      rows: [
        { customer: "Harbor Home", invoice: "INV-1043", days: 128, amount: 18_400 },
        { customer: "Lakeview", invoice: "INV-1088", days: 97, amount: 12_950 },
        { customer: "Summit Rehab", invoice: "INV-1102", days: 74, amount: 9_800 },
        { customer: "Pinecrest", invoice: "INV-1121", days: 61, amount: 6_300 },
      ],
    };
  },
} satisfies Record<string, (n?: number) => Panel>;

export type MetricId = keyof typeof METRICS;
export const METRIC_IDS = Object.keys(METRICS) as MetricId[];

export function dashboardTiles(): Tile[] {
  const { cashIn, cashOut } = cashFlows(12);
  const net = cashIn.map((v, i) => v - cashOut[i]);
  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10);
  const L = 11;
  return [
    { label: "Cash in", value: cashIn[L], unit: "usd", deltaPct: pct(cashIn[L], cashIn[L - 1]), goodWhen: "higher", note: "this month", spark: cashIn },
    { label: "Cash out", value: cashOut[L], unit: "usd", deltaPct: pct(cashOut[L], cashOut[L - 1]), goodWhen: "lower", note: "this month", spark: cashOut },
    { label: "Net cash flow", value: net[L], unit: "usd", deltaPct: pct(net[L], net[L - 1]), goodWhen: "higher", note: "this month", spark: net },
    { label: "A/R overdue", value: 96_400, unit: "usd", note: "14 invoices over 30 days" },
    { label: "Runway", value: 7.5, unit: "months", note: "cash ÷ 3-month avg outflow", kind: "prediction" },
  ];
}

export function dashboardSpec(months = 12): ViewSpec {
  return { title: "Cash dashboard", asOf: "2026-11", source: "sample", tiles: dashboardTiles(), panels: [METRICS.cash_balance(months), METRICS.cash_in_out(months)] };
}

export function metricSpec(id: MetricId, months = 12): ViewSpec {
  return { title: "", asOf: "2026-11", source: "sample", panels: [METRICS[id](months)] };
}

// ---- text for the model: the same numbers the view shows, so Claude narrates and never recomputes ----

const fmt = (v: number | null | undefined, unit: Unit | "months") =>
  v === null || v === undefined ? "n/a" : unit === "usd" ? `${v < 0 ? "-" : ""}$${Math.round(Math.abs(v)).toLocaleString("en-US")}` : unit === "percent" ? `${v}%` : unit === "days" ? `${v} days` : unit === "months" ? `${v} months` : v.toLocaleString("en-US");

export function summarizePanel(p: Panel): string {
  const head = `## ${p.title} (chart: ${pickChart(p)})`;
  const body: string[] = [];
  if (p.shape === "trend" || p.shape === "breakdown") {
    for (const s of p.series) {
      const pts = s.values.map((v, i) => [p.x[i], v] as const).filter(([, v]) => v !== null);
      if (p.shape === "trend") body.push(`- ${s.name}${s.role && s.role !== "actual" ? ` [${s.role}]` : ""}: ${pts.map(([x, v]) => `${x} ${fmt(v, p.unit)}`).join(", ")}`);
      else body.push(`- ${s.name}: ${pts.map(([x, v]) => `${x} ${fmt(v, p.unit)}`).join("; ")}`);
    }
  } else if (p.shape === "share") {
    const total = p.values.reduce((a, b) => a + b, 0);
    body.push(...p.x.map((x, i) => `- ${x}: ${fmt(p.values[i], p.unit)} (${Math.round((p.values[i] / total) * 100)}%)`), `- Total: ${fmt(total, p.unit)}`);
  } else if (p.shape === "progress") {
    body.push(...p.rows.map((r) => `- ${r.label}: ${fmt(r.actual, p.unit)} of ${fmt(r.target, p.unit)} (${Math.round((r.actual / r.target) * 100)}%)${r.projected ? `, projected ${fmt(r.projected, p.unit)}` : ""}`));
  } else if (p.shape === "funnel") {
    body.push(...p.rows.map((r, i) => `- ${r.label}: ${fmt(r.value, p.unit)}${i ? ` (${Math.round((r.value / p.rows[i - 1].value) * 100)}% of previous)` : ""}`));
  } else {
    body.push(...p.rows.map((r) => `- ${p.columns.map((c) => `${c.label}: ${c.unit ? fmt(r[c.key] as number, c.unit) : r[c.key]}`).join(", ")}`));
  }
  if (p.insight) body.push(`Insight: ${p.insight.replace(/\*\*/g, "")}`);
  return [head, ...body].join("\n");
}

export function summarize(v: ViewSpec): string {
  const tiles = (v.tiles ?? []).map((t) => `- ${t.label}: ${fmt(t.value, t.unit)}${t.deltaPct != null ? ` (${t.deltaPct >= 0 ? "+" : ""}${t.deltaPct}% vs last month)` : ""}${t.note ? `, ${t.note}` : ""}`);
  const head = `${v.title || "Metric"} as of ${v.asOf} (source: ${v.source}). The chart is shown to the user; use these numbers, do not recompute.`;
  let check = "";
  if (v.check) {
    const c = v.check;
    const u = v.panels[0]?.unit ?? "count";
    check = c.conflicts.length
      ? `CONFLICT with our data (${c.metric}): ${c.conflicts.map((x) => `${x.label}: your answer ${fmt(x.claude, u)} vs ours ${fmt(x.ours, u)}`).join("; ")}. The chart shows OUR numbers. Correct your answer for the user.`
      : `Checked against our data (${c.metric}): ${c.matched} rows match.`;
    if (c.unmatched.length) check += ` Could not match: ${c.unmatched.join(", ")}.`;
  }
  return [head, check, tiles.join("\n"), ...v.panels.map(summarizePanel)].filter(Boolean).join("\n\n");
}

// ---- catalog: search and report recommendations ----

const TAGS: Record<MetricId, string[]> = {
  cash_balance: ["cash", "balance", "bank", "forecast", "runway", "liquidity"],
  cash_in_out: ["cash", "inflow", "outflow", "receipts", "payments", "net", "burn"],
  cash_in_by_source: ["cash", "receipts", "income", "source", "revenue", "insurance"],
  ar_aging: ["receivables", "a/r", "ar", "aging", "overdue", "late", "collections", "owed", "owes", "owe", "unpaid", "debtors"],
  top_customers: ["customers", "revenue", "clients", "top", "sales", "biggest"],
  pay_speed_change: ["customers", "days to pay", "dso", "payment", "speed", "late"],
  revenue_by_type: ["revenue", "mix", "segment", "customer type", "share", "payer"],
  collections_vs_target: ["collections", "target", "goal", "region", "plan", "quota", "progress"],
  quote_to_cash: ["funnel", "quotes", "conversion", "pipeline", "sales", "won"],
  overdue_invoices: ["invoices", "overdue", "late", "a/r", "collections", "list"],
};

export function catalog(): CatalogItem[] {
  return METRIC_IDS.map((id) => {
    const p = METRICS[id]();
    return { id, title: p.title, sub: p.sub ?? "", form: pickChart(p), tags: TAGS[id] };
  });
}

const STOP = new Set(["who", "us", "we", "our", "the", "me", "my", "show", "what", "how", "is", "are", "of", "by", "for", "to", "and", "in", "on", "an", "do", "does", "much", "many", "give", "need", "update", "report", "please"]);
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9/]+/).filter((w) => w.length > 1 && !STOP.has(w));
// whole words, plus prefixes for longer words ("invoic" -> "invoices")
const hit = (hay: string[], w: string) => hay.some((h) => h === w || (w.length >= 4 && h.startsWith(w)));

/** score each metric by word overlap with the query; empty query returns everything */
export function search(query: string, items = catalog()): CatalogItem[] {
  const q = words(query);
  if (!q.length) return items;
  const scored = items.map((it) => {
    const title = words(it.title);
    const hay = [...title, ...words(it.sub), ...it.tags.flatMap(words)];
    const score = q.reduce((s, w) => s + (it.tags.includes(w) ? 3 : 0) + (hit(hay, w) ? 1 : 0) + (hit(title, w) ? 2 : 0), 0);
    return { it, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.it);
}

/** pre-checked sections for a report topic: the best matches, or the cash basics when nothing matches */
export function recommend(topic: string, n = 4): MetricId[] {
  const hits = search(topic).slice(0, n).map((i) => i.id as MetricId);
  return hits.length ? hits : ["cash_balance", "cash_in_out", "ar_aging"];
}

/** one line per panel for a message: the insight if there is one, else the key figure */
export function headline(p: Panel): string {
  if (p.insight) return p.insight.replace(/\*\*/g, "");
  switch (p.shape) {
    case "trend": {
      const s = p.series.find((x) => (x.role ?? "actual") === "actual") ?? p.series[0];
      const vals = s.values.map((v, i) => [p.x[i], v] as const).filter(([, v]) => v !== null);
      const [x, v] = vals[vals.length - 1];
      return `${s.name} was ${fmt(v, p.unit)} in ${x}.`;
    }
    case "breakdown": {
      const s = p.series[0];
      const top = p.x.map((x, i) => [x, s.values[i] ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
      return `Largest is ${top[0]} at ${fmt(top[1], p.unit)}.`;
    }
    case "share": {
      const total = p.values.reduce((a, b) => a + b, 0);
      const i = p.values.indexOf(Math.max(...p.values));
      return `${p.x[i]} is ${Math.round((p.values[i] / total) * 100)}% of ${fmt(total, p.unit)}.`;
    }
    case "progress": {
      const behind = p.rows.filter((r) => r.actual < r.target);
      return behind.length ? `${behind.length} of ${p.rows.length} behind target: ${behind.map((r) => `${r.label} ${Math.round((r.actual / r.target) * 100)}%`).join(", ")}.` : `All ${p.rows.length} on or above target.`;
    }
    case "funnel": {
      const a = p.rows[0], z = p.rows[p.rows.length - 1];
      return `${Math.round((z.value / a.value) * 100)}% of ${a.label.toLowerCase()} reach ${z.label.toLowerCase()} (${fmt(z.value, p.unit)} of ${fmt(a.value, p.unit)}).`;
    }
    case "table": {
      const top = p.rows[0];
      if (!top) return "No rows.";
      const first = p.columns.map((c) => (c.unit ? fmt(top[c.key] as number, c.unit) : String(top[c.key] ?? ""))).join(", ");
      return `${p.rows.length} rows; top: ${first}.`;
    }
  }
}

/** plain-text message (email / chat) from the chosen sections */
export function composeMessage(topic: string, panels: Panel[], tiles: Tile[] = []): string {
  const lines = [`Subject: ${topic || "Business update"} (as of ${new Date(Date.UTC(END.y, END.m, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })})`, "", "Hi team,", "", "Quick update:", ""];
  for (const t of tiles) lines.push(`- ${t.label}: ${fmt(t.value, t.unit)}${t.note ? ` (${t.note})` : ""}`);
  for (const p of panels) lines.push(`- ${p.title}: ${headline(p)}`);
  lines.push("", "Full charts are in the attached report.", "", "Thanks");
  return lines.join("\n");
}
