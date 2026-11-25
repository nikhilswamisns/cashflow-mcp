import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { Chart, BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
import type { Dashboard, Tile } from "../src/metrics.js";

Chart.register(BarController, BarElement, LineController, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

const root = document.getElementById("root")!;
let chart: Chart | undefined;

const usd = (n: number) => (Math.abs(n) >= 1000 ? `${n < 0 ? "-" : ""}$${Math.round(Math.abs(n) / 1000).toLocaleString("en-US")}k` : `$${n}`);
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function tileHtml(t: Tile): string {
  const value = t.unit === "usd" ? usd(t.value) : `${t.value} mo`;
  // for cash out, a rise is bad
  const good = t.changePct === null ? null : t.key === "cash_out" ? t.changePct <= 0 : t.changePct >= 0;
  const change = t.changePct === null ? "" : `<span class="${good ? "up" : "down"}">${t.changePct >= 0 ? "▲" : "▼"} ${Math.abs(t.changePct)}%</span> `;
  return `<div class="tile"><div class="label">${esc(t.label)}</div><div class="value">${esc(value)}</div><div class="note">${change}${esc(t.note)}</div></div>`;
}

export function render(d: Dashboard): void {
  root.innerHTML = `
    <div class="tiles">${d.tiles.map(tileHtml).join("")}</div>
    <div class="card">
      <h2>Cash in vs cash out, last ${d.series.length} months</h2>
      <div class="chart"><canvas id="c" aria-label="Monthly cash in, cash out and net"></canvas></div>
      <div class="fine">As of ${esc(d.asOf)} · source: ${d.source === "mock" ? "sample data" : "Zoho Books"}</div>
    </div>`;
  chart?.destroy();
  const grid = css("--border"), text = css("--muted");
  chart = new Chart(document.getElementById("c") as HTMLCanvasElement, {
    data: {
      labels: d.series.map((m) => m.month),
      datasets: [
        { type: "bar", label: "Cash in", data: d.series.map((m) => m.cashIn), backgroundColor: css("--c-in") },
        { type: "bar", label: "Cash out", data: d.series.map((m) => m.cashOut), backgroundColor: css("--c-out") },
        { type: "line", label: "Net", data: d.series.map((m) => m.cashIn - m.cashOut), borderColor: css("--c-net"), backgroundColor: css("--c-net"), pointRadius: 2, tension: 0.3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: text, boxWidth: 10 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: $${Number(c.raw).toLocaleString("en-US")}` } } },
      scales: { x: { ticks: { color: text }, grid: { color: grid } }, y: { ticks: { color: text, callback: (v) => usd(Number(v)) }, grid: { color: grid } } },
    },
  });
}

// local preview hook: window.render(data) in a plain browser tab
(window as unknown as { render: typeof render }).render = render;

const app = new App({ name: "kinnser-dashboard", version: "0.1.0" }, {}, { autoResize: true });
app.ontoolresult = (params) => {
  const d = params.structuredContent as unknown as Dashboard | undefined;
  if (d?.tiles) render(d);
  else root.innerHTML = `<div class="empty">No dashboard data returned.</div>`;
};
app.onhostcontextchanged = (ctx) => { if (ctx.theme) applyDocumentTheme(ctx.theme); };
if (window.parent !== window) {
  app.connect().then(() => { const t = app.getHostContext()?.theme; if (t) applyDocumentTheme(t); }).catch((e) => console.error(e));
}
