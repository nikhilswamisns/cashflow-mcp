// View spec: the server says WHAT the data is (its shape and meaning), pickChart decides HOW to draw it.
// Rules come from the charts used in cashflow_with_ml and tsp-ai-demo, checked against the dataviz rules
// (one axis only, no pie past 6 parts, no line unless x is time, fold series past 8).

export type Unit = "usd" | "count" | "percent" | "days";
/** actual = happened (solid), plan = target (dashed grey), forecast = model (dashed orange), low/high = forecast band */
export type Role = "actual" | "plan" | "forecast" | "low" | "high";

export interface Series {
  name: string;
  values: (number | null)[];
  role?: Role; // default "actual"
}

interface PanelBase {
  id: string;
  title: string;
  sub?: string;
  unit: Unit;
  /** prediction panels get a dashed border and a "Prediction" tag */
  kind?: "actual" | "prediction";
  /** one sentence, figures in **bold**; written by code, not the model */
  insight?: string;
  /** colours deltas and diverging bars: is a bigger number good? */
  goodWhen?: "higher" | "lower";
}

/** x is time (months, weeks). measure: flow = amount per period (bars), level = balance at a point (line). */
export interface TrendPanel extends PanelBase {
  shape: "trend";
  measure: "flow" | "level";
  x: string[];
  series: Series[];
  /** series add up to a whole (stacked) */
  parts?: boolean;
  /** first series goes up, second goes down, net line on top (cash in vs out) */
  inOut?: boolean;
}

/** x is categories (customers, sources, aging buckets). */
export interface BreakdownPanel extends PanelBase {
  shape: "breakdown";
  x: string[];
  series: Series[];
  /** categories have a natural order (aging buckets, tiers): keep it, draw columns */
  ordered?: boolean;
  parts?: boolean;
}

/** one whole split into parts */
export interface SharePanel extends PanelBase {
  shape: "share";
  x: string[];
  values: number[];
}

/** each row against its own target: plan by division, rep vs quota */
export interface ProgressPanel extends PanelBase {
  shape: "progress";
  rows: { label: string; actual: number; target: number; projected?: number }[];
}

/** ordered stages, each a subset of the one before */
export interface FunnelPanel extends PanelBase {
  shape: "funnel";
  rows: { label: string; value: number }[];
}

export interface TablePanel extends PanelBase {
  shape: "table";
  columns: { key: string; label: string; unit?: Unit }[];
  rows: Record<string, string | number | null>[];
}

export type Panel = TrendPanel | BreakdownPanel | SharePanel | ProgressPanel | FunnelPanel | TablePanel;

export interface Tile {
  label: string;
  value: number;
  unit: Unit | "months";
  note?: string;
  /** % change vs previous period */
  deltaPct?: number | null;
  goodWhen?: "higher" | "lower";
  spark?: number[];
  kind?: "actual" | "prediction";
}

export interface ViewSpec {
  title: string;
  asOf: string;
  source: "sample" | "zoho_books" | "zoho_analytics";
  tiles?: Tile[];
  panels: Panel[];
}

export type Form =
  | "line" // level over time, optional plan / forecast / band
  | "area" // one level series alone
  | "stacked-area" // level parts over time
  | "bars" // flow over time
  | "stacked-bars" // flow parts over time
  | "in-out" // flow in (up) vs out (down) + net line
  | "columns" // ordered categories
  | "ranked-hbars" // unordered categories, one series, largest first
  | "grouped-hbars" // unordered categories, 2-3 series side by side
  | "stacked-hbars" // categories split into parts
  | "diverging-hbars" // signed values per category
  | "donut" // share, at most 6 parts
  | "bullet-rows" // progress vs target
  | "funnel"
  | "table";

export const MAX_SERIES = 8;
export const MAX_DONUT_PARTS = 6;
export const MAX_BARS = 10;

export function validatePanel(p: Panel): void {
  const len = (n: number, what: string) => {
    if (n === 0) throw new Error(`${p.id}: ${what} is empty`);
  };
  if (p.shape === "trend" || p.shape === "breakdown") {
    len(p.x.length, "x");
    len(p.series.length, "series");
    for (const s of p.series) if (s.values.length !== p.x.length) throw new Error(`${p.id}: series "${s.name}" has ${s.values.length} values for ${p.x.length} x labels`);
  } else if (p.shape === "share") {
    len(p.x.length, "x");
    if (p.values.length !== p.x.length) throw new Error(`${p.id}: ${p.values.length} values for ${p.x.length} parts`);
  } else if (p.shape === "table") len(p.columns.length, "columns");
  else len(p.rows.length, "rows");
}

/** Pick the chart form from what the data is. Pure, so the server tests it and the view uses it. */
export function pickChart(p: Panel): Form {
  validatePanel(p);
  switch (p.shape) {
    case "trend": {
      if (p.inOut && p.series.length >= 2) return "in-out";
      const actual = p.series.filter((s) => (s.role ?? "actual") === "actual");
      if (p.measure === "level") {
        if (p.parts && actual.length > 1) return "stacked-area";
        return p.series.length === 1 ? "area" : "line";
      }
      return p.parts && actual.length > 1 ? "stacked-bars" : "bars";
    }
    case "breakdown": {
      const signed = p.series.some((s) => s.values.some((v) => v !== null && v < 0));
      if (p.series.length === 1 && signed) return "diverging-hbars";
      if (p.parts && p.series.length > 1) return "stacked-hbars";
      if (p.ordered) return "columns";
      return p.series.length === 1 ? "ranked-hbars" : "grouped-hbars";
    }
    case "share": {
      // a share of a rate or a signed number is not a share; past 6 parts slices can't be compared
      const bad = p.unit === "percent" || p.values.some((v) => v < 0);
      return bad || p.x.length > MAX_DONUT_PARTS ? "ranked-hbars" : "donut";
    }
    case "progress":
      return "bullet-rows";
    case "funnel":
      return "funnel";
    case "table":
      return "table";
  }
}

/** Largest-first, top n, rest folded into "Other" when the values add up (usd / count). */
export function rankTop(labels: string[], values: number[], unit: Unit, n = MAX_BARS): { labels: string[]; values: number[] } {
  const rows = labels.map((l, i) => ({ l, v: values[i] })).sort((a, b) => b.v - a.v);
  if (rows.length <= n) return { labels: rows.map((r) => r.l), values: rows.map((r) => r.v) };
  const head = rows.slice(0, n - 1);
  const additive = unit === "usd" || unit === "count";
  if (!additive) return { labels: rows.slice(0, n).map((r) => r.l), values: rows.slice(0, n).map((r) => r.v) };
  const other = rows.slice(n - 1).reduce((s, r) => s + r.v, 0);
  return { labels: [...head.map((r) => r.l), `Other (${rows.length - n + 1})`], values: [...head.map((r) => r.v), other] };
}

/** Keep at most MAX_SERIES series: the biggest by total, the rest summed into "Other" when they are parts. */
export function foldSeries(series: Series[], parts: boolean): Series[] {
  if (series.length <= MAX_SERIES) return series;
  const total = (s: Series) => s.values.reduce<number>((a, v) => a + Math.abs(v ?? 0), 0);
  const sorted = [...series].sort((a, b) => total(b) - total(a));
  if (!parts) return sorted.slice(0, MAX_SERIES);
  const keep = sorted.slice(0, MAX_SERIES - 1);
  const rest = sorted.slice(MAX_SERIES - 1);
  const values = rest[0].values.map((_, i) => rest.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  return [...keep, { name: `Other (${rest.length})`, values }];
}
