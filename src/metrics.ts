// Dashboard numbers. All math lives here so Claude only narrates, never computes.
// shortcut: mock monthly data, replace with the Zoho Books reports API in phase 1.

export interface Month {
  month: string; // YYYY-MM
  cashIn: number;
  cashOut: number;
}

export interface Tile {
  key: string;
  label: string;
  value: number;
  unit: "usd" | "months";
  changePct: number | null; // vs previous month; null when not meaningful
  note: string;
}

export interface Dashboard {
  asOf: string;
  source: "mock" | "zoho_books";
  tiles: Tile[];
  series: Month[];
}

export function mockMonths(count: number, end = new Date(Date.UTC(2026, 10, 1))): Month[] {
  const out: Month[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1));
    const t = count - 1 - i;
    // deterministic: growth trend + seasonality, no randomness so tests are stable
    const cashIn = Math.round(300_000 + t * 6_000 + 40_000 * Math.sin(t / 2));
    const cashOut = Math.round(290_000 + t * 4_500 + 25_000 * Math.cos(t / 3));
    out.push({ month: d.toISOString().slice(0, 7), cashIn, cashOut });
  }
  return out;
}

const pct = (now: number, prev: number) => (prev === 0 ? null : Math.round(((now - prev) / Math.abs(prev)) * 1000) / 10);

export function buildDashboard(series: Month[], cashBalance: number, arOverdue: number, arOverdueCount: number): Dashboard {
  if (series.length < 2) throw new Error("need at least 2 months of data");
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const net = last.cashIn - last.cashOut;
  const prevNet = prev.cashIn - prev.cashOut;
  const avgBurn = series.slice(-3).reduce((s, m) => s + m.cashOut, 0) / Math.min(3, series.length);
  const runway = Math.round((cashBalance / avgBurn) * 10) / 10;

  return {
    asOf: last.month,
    source: "mock",
    series,
    tiles: [
      { key: "cash_in", label: "Cash in", value: last.cashIn, unit: "usd", changePct: pct(last.cashIn, prev.cashIn), note: "received this month" },
      { key: "cash_out", label: "Cash out", value: last.cashOut, unit: "usd", changePct: pct(last.cashOut, prev.cashOut), note: "paid this month" },
      { key: "net", label: "Net cash flow", value: net, unit: "usd", changePct: pct(net, prevNet), note: net >= 0 ? "positive month" : "negative month" },
      { key: "ar_overdue", label: "AR overdue", value: arOverdue, unit: "usd", changePct: null, note: `${arOverdueCount} invoices` },
      { key: "runway", label: "Runway", value: runway, unit: "months", changePct: null, note: "cash ÷ 3-mo avg outflow" },
    ],
  };
}

export function summarize(d: Dashboard): string {
  const lines = d.tiles.map((t) => {
    const v = t.unit === "usd" ? `$${t.value.toLocaleString("en-US")}` : `${t.value} months`;
    const c = t.changePct === null ? "" : ` (${t.changePct >= 0 ? "+" : ""}${t.changePct}% vs last month)`;
    return `- ${t.label}: ${v}${c}, ${t.note}`;
  });
  return [`Cash dashboard as of ${d.asOf} (source: ${d.source}, ${d.series.length} months shown).`, ...lines].join("\n");
}
