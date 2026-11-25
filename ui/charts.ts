import {
  Chart, BarController, BarElement, LineController, LineElement, PointElement, DoughnutController, ArcElement,
  CategoryScale, LinearScale, Filler, Tooltip, type ChartConfiguration, type Plugin,
} from "chart.js";
import { pickChart, rankTop, foldSeries, type Form, type Panel, type Series, type Tile, type Unit, type ViewSpec } from "../src/spec.js";
import { tableEl, toCsv } from "./table.js";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, DoughnutController, ArcElement, CategoryScale, LinearScale, Filler, Tooltip);

/** what the view can ask of the chat host (real host in Claude, stubs in the browser preview) */
export interface Host {
  ask(text: string): void;
  download(filename: string, mimeType: string, text: string): void;
  call(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

let charts: Chart[] = [];
export function destroyCharts(): void {
  charts.forEach((c) => c.destroy());
  charts = [];
}

// ---------- formatting (cashflow format.ts / tsp dom.js) ----------
const MINUS = "−";
export const usd =(n: number) => `${n < 0 ? MINUS : ""}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
const kfmt = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? MINUS : "";
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${s}$${Math.round(a)}`;
};
export const full = (v: number | null | undefined, u: Unit | "months") =>
  v === null || v === undefined ? "Not recorded" : u === "usd" ? usd(v) : u === "percent" ? `${Math.round(v)}%` : u === "days" ? `${v} d` : u === "months" ? `${v} mo` : Math.round(v).toLocaleString("en-US");
export const short = (v: number, u: Unit | "months") => (u === "usd" ? kfmt(v) : full(v, u));
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const bold = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
export const monthLabel = (x: string) => (/^\d{4}-\d{2}$/.test(x) ? new Date(`${x}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) : x);

// ---------- tokens ----------
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const alpha = (c: string, a: number) => `color-mix(in srgb, ${c} ${Math.round(a * 100)}%, transparent)`;
export function tok() {
  return {
    text: css("--text"), text2: css("--text-2"), muted: css("--muted"), grid: css("--grid"), tick: css("--tick"), border: css("--border"),
    borderStrong: css("--border-strong"), surface: css("--surface"), cash: css("--c-cash"), ml: css("--c-ml"), plan: css("--c-plan"),
    cin: css("--c-in"), cout: css("--c-out"), other: css("--k-other"), sans: css("--sans"), mono: css("--mono"),
    k: ["--k1", "--k2", "--k3", "--k4", "--k5"].map(css),
  };
}
export type Tok = ReturnType<typeof tok>;
/** fixed slot per series name, never by rank; past 5 slots and "Other" fall to the neutral */
const slot = (t: Tok, i: number, name: string) => (name.startsWith("Other") || i >= t.k.length ? t.other : t.k[i]);
// canvas can't resolve color-mix, so resolve alpha colours through a probe element
const probe = document.createElement("i");
function solid(c: string): string {
  if (!probe.isConnected) document.body.append(probe);
  probe.style.color = c;
  return getComputedStyle(probe).color;
}

// ---------- shared Chart.js options (cashflow base.ts) ----------
function base(t: Tok, unit: Unit, o: { stacked?: boolean; horizontal?: boolean; zero?: boolean; time?: boolean } = {}): ChartConfiguration["options"] {
  const value = {
    stacked: o.stacked, beginAtZero: o.zero ?? true, grace: "4%", grid: { color: t.grid }, border: { display: false },
    ticks: { color: t.tick, font: { family: t.mono, size: 11 }, maxTicksLimit: 6, callback: (v: string | number) => short(Number(v), unit) },
  };
  const label = { stacked: o.stacked, grid: { display: false }, border: { color: t.border }, ticks: { color: t.tick, font: { family: t.mono, size: 11 }, maxRotation: 0, autoSkip: !!o.time, autoSkipPadding: 12 } }; // categories never drop a label; months may
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 350 }, indexAxis: o.horizontal ? "y" : "x",
    interaction: { mode: "index", intersect: false }, layout: { padding: { top: 6, right: o.horizontal ? 56 : 6 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.surface, titleColor: t.text, bodyColor: t.text2, borderColor: t.borderStrong, borderWidth: 1, padding: 10, cornerRadius: 8, boxPadding: 4,
        titleFont: { family: t.sans, weight: 600 }, bodyFont: { family: t.mono, size: 12 },
        filter: (i) => !(i.dataset as { hideTip?: boolean }).hideTip && i.raw !== null,
        callbacks: { label: (c) => ` ${c.dataset.label}: ${full(Number(o.horizontal ? c.parsed.x : c.parsed.y), unit)}` },
      },
    },
    scales: o.horizontal ? { x: value, y: label } : { x: label, y: value },
  } as ChartConfiguration["options"];
}

/** value at the end of each horizontal bar: selective direct labels instead of reading the axis */
const endLabels = (t: Tok, unit: Unit): Plugin => ({
  id: "endLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = `11px ${t.mono}`;
    ctx.fillStyle = t.text2;
    ctx.textBaseline = "middle";
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const v = chart.data.datasets[0].data[i] as number;
      const x = (bar as unknown as { x: number; base: number }).x, b = (bar as unknown as { base: number }).base;
      ctx.textAlign = v < 0 ? "right" : "left";
      ctx.fillText(short(v, unit), v < 0 ? Math.min(x, b) - 6 : Math.max(x, b) + 6, bar.y);
    });
    ctx.restore();
  },
});

// ---------- legend ----------
type Key = { label: string; color: string; mark: "line" | "dash" | "box" | "band" | "tick" };
const legend = (keys: Key[]) =>
  keys.length < 2 ? "" : `<div class="legend">${keys.map((k) => `<span><i class="${k.mark === "line" ? "" : k.mark}" style="color:${k.color}"></i>${esc(k.label)}</span>`).join("")}</div>`;

// ---------- chart builders, one per form ----------
type Built = { config?: ChartConfiguration; html?: string; keys: Key[]; height?: number };
const role = (s: Series) => s.role ?? "actual";
const BAR = { borderRadius: 4, maxBarThickness: 28, borderSkipped: "start" as const };

function trend(p: Extract<Panel, { shape: "trend" }>, form: Form, t: Tok): Built {
  const labels = p.x.map(monthLabel);
  const series = foldSeries(p.series, !!p.parts);
  const actual = series.filter((s) => role(s) === "actual");
  const keys: Key[] = [];
  const color = (s: Series, i: number) => (actual.length === 1 ? t.cash : slot(t, i, s.name));

  if (form === "in-out") {
    const [a, b] = series;
    const net = a.values.map((v, i) => (v ?? 0) - (b.values[i] ?? 0));
    keys.push({ label: a.name, color: t.cin, mark: "box" }, { label: b.name, color: t.cout, mark: "box" }, { label: "Net", color: t.text, mark: "line" });
    const opts = base(t, p.unit, { stacked: true, time: true });
    return {
      keys,
      config: {
        type: "bar",
        data: {
          labels,
          datasets: [
            { type: "line", label: "Net", data: net, borderColor: t.text, backgroundColor: t.text, borderWidth: 2, pointRadius: p.x.length <= 13 ? 2.5 : 0, tension: 0.3, order: 0, stack: "net" },
            { label: a.name, data: a.values, backgroundColor: t.cin, ...BAR, borderRadius: 2, barPercentage: 0.6, order: 1, stack: "flow" },
            { label: b.name, data: b.values.map((v) => (v === null ? null : -v)), backgroundColor: t.cout, ...BAR, borderRadius: 2, barPercentage: 0.6, order: 1, stack: "flow" },
          ],
        } as ChartConfiguration["data"],
        options: {
          ...opts,
          plugins: { ...opts!.plugins, tooltip: { ...opts!.plugins!.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${full(Math.abs(Number(c.parsed.y)) * (c.dataset.label === "Net" && Number(c.parsed.y) < 0 ? -1 : 1), p.unit)}` } } },
        },
      },
    };
  }

  const datasets: Record<string, unknown>[] = [];
  const isLine = form === "line" || form === "area" || form === "stacked-area";
  let i = 0;
  for (const s of series) {
    const r = role(s);
    if (r === "actual") {
      const c = color(s, i++);
      if (isLine) {
        const fill = form === "area" ? "origin" : form === "stacked-area" ? (datasets.length ? "-1" : "origin") : false;
        datasets.push({ label: s.name, data: s.values, borderColor: c, backgroundColor: solid(alpha(c, form === "stacked-area" ? 0.55 : 0.12)), fill, borderWidth: 2, tension: 0.3, cubicInterpolationMode: "monotone", pointRadius: 0, pointHoverRadius: 4, spanGaps: false });
        keys.push({ label: s.name, color: c, mark: form === "stacked-area" ? "box" : "line" });
      } else {
        // stacked: a 2px surface-coloured edge is the gap between segments (dataviz: gaps, not borders)
        const gap = p.parts ? { borderColor: t.surface, borderWidth: { top: 2 }, borderRadius: 2 } : { borderRadius: 4 };
        datasets.push({ label: s.name, data: s.values, backgroundColor: c, ...BAR, ...gap });
        keys.push({ label: s.name, color: c, mark: "box" });
      }
    } else if (r === "plan") {
      datasets.push({ type: "line", label: s.name, data: s.values, borderColor: t.plan, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, fill: false });
      keys.push({ label: s.name, color: t.plan, mark: "dash" });
    } else if (r === "forecast") {
      if (isLine) datasets.push({ type: "line", label: s.name, data: s.values, borderColor: t.ml, borderDash: [7, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.3 });
      else datasets.push({ label: s.name, data: s.values, backgroundColor: solid(alpha(t.ml, 0.22)), borderColor: t.ml, borderWidth: 1.5, borderDash: [4, 3], ...BAR, grouped: false });
      keys.push({ label: s.name, color: t.ml, mark: isLine ? "dash" : "box" });
    } else if (r === "low") {
      datasets.push({ type: "line", label: s.name, data: s.values, borderColor: "transparent", pointRadius: 0, fill: false, hideTip: true });
    } else if (r === "high") {
      datasets.push({ type: "line", label: s.name, data: s.values, borderColor: "transparent", backgroundColor: solid(alpha(t.ml, 0.16)), pointRadius: 0, fill: "-1", hideTip: true });
      keys.push({ label: "Likely range", color: t.ml, mark: "band" });
    }
  }
  const zero = !(form === "line" || form === "area") || p.unit !== "usd" ? true : Math.min(...series.flatMap((s) => s.values.filter((v): v is number => v !== null))) < 0;
  return { keys, config: { type: isLine ? "line" : "bar", data: { labels, datasets } as unknown as ChartConfiguration["data"], options: base(t, p.unit, { stacked: form === "stacked-area" || form === "stacked-bars", zero: isLine ? zero : true, time: true }) } };
}

function breakdown(p: Extract<Panel, { shape: "breakdown" }>, form: Form, t: Tok): Built {
  if (form === "ranked-hbars" || form === "diverging-hbars") {
    const s = p.series[0];
    const vals = s.values.map((v) => v ?? 0);
    const { labels, values } = form === "ranked-hbars" ? rankTop(p.x, vals, p.unit) : rankTop(p.x, vals, "percent", 99);
    const good = (v: number) => ((p.goodWhen ?? "higher") === "higher" ? v >= 0 : v <= 0);
    const colors = form === "diverging-hbars" ? values.map((v) => (good(v) ? t.cin : t.cout)) : values.map((_, i) => (labels[i].startsWith("Other") ? t.other : t.cash));
    const keys: Key[] = form === "diverging-hbars" ? [{ label: "Better", color: t.cin, mark: "box" }, { label: "Worse", color: t.cout, mark: "box" }] : [];
    return {
      keys, height: Math.max(140, labels.length * 30 + 36),
      config: { type: "bar", data: { labels, datasets: [{ label: s.name, data: values, backgroundColor: colors, ...BAR, maxBarThickness: 18 }] }, options: base(t, p.unit, { horizontal: true }), plugins: [endLabels(t, p.unit)] },
    };
  }
  const series = foldSeries(p.series, !!p.parts);
  const horizontal = form !== "columns";
  // grouped / stacked: categories ordered by total, largest first (unless ordered)
  let order = p.x.map((_, i) => i);
  if (!p.ordered) order.sort((a, b) => series.reduce((s, x) => s + (x.values[b] ?? 0), 0) - series.reduce((s, x) => s + (x.values[a] ?? 0), 0));
  const labels = order.map((i) => p.x[i]);
  const one = series.length === 1;
  const datasets = series.map((s, k) => ({ label: s.name, data: order.map((i) => s.values[i]), backgroundColor: one ? t.cash : slot(t, k, s.name), ...BAR, maxBarThickness: horizontal ? 18 : 40, ...(p.parts ? { borderColor: t.surface, borderWidth: horizontal ? { right: 2 } : { top: 2 }, borderRadius: 2 } : { borderRadius: 4 }) }));
  return {
    keys: one ? [] : series.map((s, k) => ({ label: s.name, color: slot(t, k, s.name), mark: "box" as const })),
    height: horizontal ? Math.max(140, labels.length * (p.parts ? 30 : 22 * series.length + 10) + 36) : 240,
    config: { type: "bar", data: { labels, datasets } as ChartConfiguration["data"], options: base(t, p.unit, { horizontal, stacked: !!p.parts }), plugins: one && horizontal ? [endLabels(t, p.unit)] : [] },
  };
}

function donut(p: Extract<Panel, { shape: "share" }>, t: Tok): Built {
  const total = p.values.reduce((a, b) => a + b, 0);
  const order = p.x.map((_, i) => i).sort((a, b) => p.values[b] - p.values[a]);
  const colors = order.map((i, k) => slot(t, k, p.x[i]));
  const list = order
    .map((i, k) => `<li><i style="background:${colors[k]}"></i><span>${esc(p.x[i])}</span><span class="num">${short(p.values[i], p.unit)}</span><span class="num" style="color:var(--muted)">${Math.round((p.values[i] / total) * 100)}%</span></li>`)
    .join("");
  const opts = base(t, p.unit);
  return {
    keys: [],
    html: `<div class="donut"><div class="chart"><canvas role="img" aria-label="${esc(p.title)}"></canvas><div class="donut-mid"><b class="num">${short(total, p.unit)}</b><small>total</small></div></div><ul class="parts">${list}</ul></div>`,
    config: {
      type: "doughnut",
      data: { labels: order.map((i) => p.x[i]), datasets: [{ data: order.map((i) => p.values[i]), backgroundColor: colors, borderColor: t.surface, borderWidth: 3, hoverOffset: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "68%", animation: { duration: 350 },
        plugins: { legend: { display: false }, tooltip: { ...opts!.plugins!.tooltip, callbacks: { label: (c) => ` ${full(Number(c.raw), p.unit)} · ${Math.round((Number(c.raw) / total) * 100)}%` } } },
      } as ChartConfiguration["options"],
    },
  };
}

function bullets(p: Extract<Panel, { shape: "progress" }>, t: Tok): Built {
  const max = Math.max(...p.rows.flatMap((r) => [r.actual, r.target, r.projected ?? 0])) * 1.04;
  const pc = (v: number) => `${(v / max) * 100}%`;
  const rows = p.rows
    .map((r) => {
      const ratio = Math.round((r.actual / r.target) * 100);
      const tone = ratio >= 100 ? "up" : ratio < 50 ? "down" : "";
      return `<div><div class="row-head"><span>${esc(r.label)}</span><span class="fig num">${short(r.actual, p.unit)} of ${short(r.target, p.unit)} · <span class="${tone}">${ratio}%</span></span></div>
        <div class="track" role="img" aria-label="${esc(r.label)}: ${full(r.actual, p.unit)} of ${full(r.target, p.unit)}"><div class="fill" style="width:${pc(r.actual)}"></div>${r.projected ? `<div class="proj" style="left:calc(${pc(r.projected)} - 1.5px)" title="Projected ${full(r.projected, p.unit)}"></div>` : ""}<div class="target" style="left:calc(${pc(r.target)} - 1px)" title="Target ${full(r.target, p.unit)}"></div></div></div>`;
    })
    .join("");
  const keys: Key[] = [{ label: "So far", color: t.cash, mark: "box" }, { label: "Target", color: t.text, mark: "tick" }];
  if (p.rows.some((r) => r.projected)) keys.push({ label: "Projected", color: t.ml, mark: "tick" });
  return { keys, html: `<div class="rows">${rows}</div>` };
}

function funnel(p: Extract<Panel, { shape: "funnel" }>): Built {
  const first = p.rows[0].value || 1;
  const rows = p.rows
    .map((r, i) => `<div><div class="row-head"><span>${esc(r.label)}</span><span class="fig num">${full(r.value, p.unit)} · ${Math.round((r.value / first) * 100)}%</span></div>
      <div class="track"><div class="fill" style="width:${Math.max(14, (r.value / first) * 100)}%;${i === p.rows.length - 1 ? "background:var(--c-in)" : ""}"></div></div></div>`)
    .join("");
  return { keys: [], html: `<div class="rows funnel">${rows}</div>` };
}

// ---------- table data: every chart has one, so no value is tooltip-only ----------
export type TableData = { cols: { label: string; unit?: Unit }[]; rows: (string | number | null)[][] };
export function tableOf(p: Panel): TableData {
  switch (p.shape) {
    case "trend":
    case "breakdown":
      return { cols: [{ label: p.shape === "trend" ? "Month" : "" }, ...p.series.map((s) => ({ label: s.name, unit: p.unit }))], rows: p.x.map((x, i) => [p.shape === "trend" ? monthLabel(x) : x, ...p.series.map((s) => s.values[i])]) };
    case "share": {
      const total = p.values.reduce((a, b) => a + b, 0);
      return { cols: [{ label: "" }, { label: "Amount", unit: p.unit }, { label: "Share", unit: "percent" }], rows: p.x.map((x, i) => [x, p.values[i], (p.values[i] / total) * 100]) };
    }
    case "progress":
      return { cols: [{ label: "" }, { label: "So far", unit: p.unit }, { label: "Target", unit: p.unit }, { label: "Projected", unit: p.unit }, { label: "Reached", unit: "percent" }], rows: p.rows.map((r) => [r.label, r.actual, r.target, r.projected ?? null, (r.actual / r.target) * 100]) };
    case "funnel":
      return { cols: [{ label: "Stage" }, { label: "Count", unit: p.unit }, { label: "Of first", unit: "percent" }], rows: p.rows.map((r) => [r.label, r.value, (r.value / (p.rows[0].value || 1)) * 100]) };
    case "table":
      return { cols: p.columns.map((c) => ({ label: c.label, unit: c.unit })), rows: p.rows.map((r) => p.columns.map((c) => r[c.key] ?? null)) };
  }
}

// ---------- tiles ----------
function spark(values: number[], color: string): string {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(24 - ((v - min) / span) * 22).toFixed(1)}`).join(" ");
  return `<svg class="t-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}
export function tileHtml(x: Tile, t: Tok): string {
  let delta = "";
  if (x.deltaPct !== null && x.deltaPct !== undefined) {
    const good = (x.goodWhen ?? "higher") === "higher" ? x.deltaPct >= 0 : x.deltaPct <= 0;
    delta = `<span class="${good ? "up" : "down"}">${x.deltaPct >= 0 ? "▲" : "▼"} ${Math.abs(x.deltaPct)}%</span> `;
  }
  const tag = x.kind === "prediction" ? `<span class="tag pred">Prediction</span>` : "";
  return `<div class="tile${x.kind === "prediction" ? " pred" : ""}"><div class="t-label"><span>${esc(x.label)}</span>${tag}</div>
    <div class="t-value">${esc(short(x.value, x.unit))}</div><div class="t-note">${delta}${esc(x.note ?? "")}</div>${x.spark && x.spark.length > 1 ? spark(x.spark, t.cash) : ""}</div>`;
}

// ---------- panel ----------
const WIDE: Form[] = ["line", "area", "stacked-area", "bars", "stacked-bars", "in-out", "table"];
const fileSafe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "data";

export interface PanelOpts {
  host?: Host;
  /** row labels to highlight in the table (conflicts with Claude's answer) */
  flagged?: Set<string>;
  /** report mode: no buttons, chart only */
  static?: boolean;
}

export function panelEl(p: Panel, t: Tok, o: PanelOpts = {}): { el: HTMLElement; built: Built; form: Form } {
  const form = pickChart(p);
  let built: Built;
  if (p.shape === "trend") built = trend(p, form, t);
  else if (p.shape === "breakdown") built = breakdown(p, form, t);
  else if (p.shape === "share") built = form === "donut" ? donut(p, t) : breakdown({ ...p, shape: "breakdown", series: [{ name: p.title, values: p.values }] }, form, t);
  else if (p.shape === "progress") built = bullets(p, t);
  else if (p.shape === "funnel") built = funnel(p);
  else built = { keys: [] };

  const el = document.createElement("section");
  el.className = `panel${WIDE.includes(form) ? " wide" : ""}${p.kind === "prediction" ? " pred" : ""}`;
  el.dataset.form = form;
  const pred = p.kind === "prediction" ? `<span class="tag pred" title="What we expect to happen next. A prediction, not a fact.">Prediction</span>` : "";
  const tools = o.static
    ? ""
    : `${form === "table" ? "" : `<button class="tbtn" data-act="toggle" type="button" aria-pressed="false">Table</button>`}<button class="tbtn" data-act="csv" type="button" title="Download as CSV">CSV</button>`;
  const isTable = p.shape === "table";
  const body = isTable ? "" : built.html ?? `<div class="chart" style="height:${built.height ?? 260}px"><canvas role="img" aria-label="${esc(p.title)}"></canvas></div>`;
  el.innerHTML = `<div class="p-head"><div><h2>${esc(p.title)}</h2>${p.sub ? `<p class="sub">${esc(p.sub)}</p>` : ""}</div><div class="p-tools">${pred}${tools}</div></div>
    <div class="p-chart">${body}${legend(built.keys)}</div><div class="p-table"${isTable ? "" : " hidden"}></div>
    ${p.insight ? `<p class="insight">${bold(p.insight)}</p>` : ""}<div class="p-ask" hidden></div>`;

  const data = tableOf(p);
  el.querySelector(".p-table")!.append(tableEl(data, { flagged: o.flagged, maxRows: o.static ? Infinity : 12 }));
  if (isTable) el.querySelector<HTMLElement>(".p-chart")!.hidden = true;

  el.querySelector<HTMLButtonElement>('[data-act="toggle"]')?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const on = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Chart" : "Table";
    el.querySelector<HTMLElement>(".p-chart")!.hidden = on;
    el.querySelector<HTMLElement>(".p-table")!.hidden = !on;
  });
  el.querySelector('[data-act="csv"]')?.addEventListener("click", () => o.host?.download(`${fileSafe(p.title)}.csv`, "text/csv", toCsv(data)));

  // click a bar or point: offer to ask Claude about that item (never sends on its own)
  if (built.config && o.host && !o.static) {
    const ask = el.querySelector<HTMLElement>(".p-ask")!;
    built.config.options = {
      ...built.config.options,
      onClick: (_e, items, chart) => {
        const hit = items[0];
        if (!hit) return;
        const label = String(chart.data.labels?.[hit.index] ?? "");
        if (!label) return;
        ask.hidden = false;
        ask.innerHTML = `<button class="chip" type="button">Ask Claude about <b>${esc(label)}</b> ↗</button><button class="chip ghost" type="button" aria-label="Dismiss">✕</button>`;
        const [go, close] = ask.querySelectorAll("button");
        go.addEventListener("click", () => { o.host!.ask(`In "${p.title}", tell me more about ${label}: what is driving it and what should we do?`); ask.hidden = true; });
        close.addEventListener("click", () => (ask.hidden = true));
      },
      onHover: (e, items) => ((e.native?.target as HTMLElement | null)?.style.setProperty("cursor", items.length ? "pointer" : "default")),
    };
  }
  return { el, built, form };
}

/** draw a view spec (tiles + panels) into a container */
export function renderView(container: HTMLElement, v: ViewSpec, host?: Host, o: { static?: boolean } = {}): void {
  const t = tok();
  if (v.check?.conflicts.length) {
    const u = v.panels[0]?.unit ?? "count";
    container.insertAdjacentHTML("beforeend", `<div class="alert" role="status"><b>Numbers don't match our data.</b> ${v.check.conflicts.map((c) => `${esc(c.label)}: answer says ${esc(full(c.claude, u))}, ${esc(sourceName(v.source))} shows ${esc(full(c.ours, u))}`).join(" · ")}. The chart shows ${esc(sourceName(v.source))}.</div>`);
  } else if (v.check) {
    container.insertAdjacentHTML("beforeend", `<div class="alert ok" role="status">Checked against ${esc(sourceName(v.source))}: ${v.check.matched} rows match.${v.check.unmatched.length ? ` ${v.check.unmatched.length} not found: ${esc(v.check.unmatched.join(", "))}.` : ""}</div>`);
  }
  if (v.tiles?.length) {
    const tiles = document.createElement("div");
    tiles.className = "tiles";
    tiles.innerHTML = v.tiles.map((x) => tileHtml(x, t)).join("");
    container.append(tiles);
  }
  const grid = document.createElement("div");
  grid.className = "panels";
  container.append(grid);
  const flagged = new Set(v.check?.conflicts.map((c) => c.label.toLowerCase()) ?? []);
  for (const p of v.panels) {
    try {
      const { el, built } = panelEl(p, t, { host, flagged, static: o.static });
      grid.append(el);
      const canvas = el.querySelector("canvas");
      if (canvas && built.config) charts.push(new Chart(canvas, o.static ? { ...built.config, options: { ...built.config.options, animation: false } } : built.config));
    } catch (e) {
      const el = document.createElement("section");
      el.className = "panel";
      el.innerHTML = `<h2>${esc(p.title)}</h2><p class="sub">Could not draw this: ${esc(String((e as Error).message))}</p>`;
      grid.append(el);
    }
  }
  const origin = v.source === "claude" ? `<span class="tag" title="Numbers came from Claude's answer, not checked against our data">From Claude's answer</span>` : esc(sourceName(v.source));
  container.insertAdjacentHTML("beforeend", `<p class="fine">As of ${esc(monthLabel(v.asOf))} · ${origin} · read only</p>`);
}

export const sourceName = (s: ViewSpec["source"]) => (s === "sample" ? "sample data" : s === "zoho_books" ? "Zoho Books" : s === "zoho_analytics" ? "Zoho Analytics" : "Claude's answer");

