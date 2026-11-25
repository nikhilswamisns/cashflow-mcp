// Search over every chart we have. Type to filter, open one inline, ask Claude about it.
import type { BrowseSpec, CatalogItem, Form, ViewSpec } from "../src/spec.js";
import { search } from "../src/metrics.js";
import { esc, renderView, type Host } from "./charts.js";

/** small line drawing of each chart form, so results scan at a glance */
export function sketch(form: Form): string {
  const s = 'stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
  const f = 'fill="currentColor"';
  const body: Record<string, string> = {
    line: `<polyline ${s} points="3,26 12,18 20,21 28,10 36,13"/><polyline ${s} stroke-dasharray="3 3" points="36,13 45,7"/>`,
    area: `<path ${f} opacity=".25" d="M3 26 L12 17 L22 20 L32 9 L45 6 L45 29 L3 29Z"/><polyline ${s} points="3,26 12,17 22,20 32,9 45,6"/>`,
    "stacked-area": `<path ${f} opacity=".55" d="M3 29 L3 20 L24 16 L45 12 L45 29Z"/><path ${f} opacity=".25" d="M3 20 L24 16 L45 12 L45 5 L24 9 L3 13Z"/>`,
    bars: [6, 14, 22, 30, 38].map((x, i) => `<rect ${f} x="${x}" y="${[16, 10, 13, 7, 9][i]}" width="5" height="${29 - [16, 10, 13, 7, 9][i]}" rx="1.5"/>`).join(""),
    "stacked-bars": [6, 14, 22, 30, 38].map((x, i) => `<rect ${f} x="${x}" y="${[14, 10, 12, 8, 9][i]}" width="5" height="${29 - [14, 10, 12, 8, 9][i]}" rx="1.5" opacity=".45"/><rect ${f} x="${x}" y="${[20, 18, 19, 17, 18][i]}" width="5" height="${29 - [20, 18, 19, 17, 18][i]}" rx="1.5"/>`).join(""),
    "in-out": [6, 14, 22, 30, 38].map((x, i) => `<rect ${f} x="${x}" y="${[8, 6, 9, 5, 7][i]}" width="5" height="${16 - [8, 6, 9, 5, 7][i]}" rx="1.5"/><rect ${f} opacity=".45" x="${x}" y="17" width="5" height="${[7, 9, 6, 10, 8][i]}" rx="1.5"/>`).join("") + `<line ${s} x1="3" x2="45" y1="16.5" y2="16.5" stroke-width="1"/>`,
    columns: [6, 14, 22, 30, 38].map((x, i) => `<rect ${f} x="${x}" y="${[6, 16, 21, 24, 19][i]}" width="6" height="${29 - [6, 16, 21, 24, 19][i]}" rx="1.5"/>`).join(""),
    "ranked-hbars": [5, 11, 17, 23].map((y, i) => `<rect ${f} x="4" y="${y}" width="${[40, 30, 21, 12][i]}" height="4" rx="1.5"/>`).join(""),
    "grouped-hbars": [5, 15, 25].map((y, i) => `<rect ${f} x="4" y="${y - 2}" width="${[38, 28, 18][i]}" height="3.5" rx="1.2"/><rect ${f} opacity=".45" x="4" y="${y + 2}" width="${[30, 33, 12][i]}" height="3.5" rx="1.2"/>`).join(""),
    "stacked-hbars": [6, 14, 22].map((y, i) => `<rect ${f} x="4" y="${y}" width="${[20, 14, 24][i]}" height="5" rx="1.5"/><rect ${f} opacity=".45" x="${25 + [0, -6, 4][i]}" y="${y}" width="${[16, 22, 12][i]}" height="5" rx="1.5"/>`).join(""),
    "diverging-hbars": `<line ${s} x1="24" x2="24" y1="3" y2="29" stroke-width="1"/>` + [5, 12, 19, 26].map((y, i) => `<rect ${f} x="${[24, 24, 12, 6][i]}" y="${y}" width="${[16, 9, 12, 18][i]}" height="4" rx="1.5" opacity="${i < 2 ? 1 : 0.5}"/>`).join(""),
    donut: `<circle ${s} cx="24" cy="16" r="10" stroke-width="5" opacity=".3"/><path ${s} stroke-width="5" d="M24 6 A10 10 0 1 1 15 21"/>`,
    "bullet-rows": [7, 16, 25].map((y, i) => `<rect ${f} opacity=".2" x="4" y="${y}" width="40" height="4" rx="1.5"/><rect ${f} x="4" y="${y}" width="${[30, 20, 36][i]}" height="4" rx="1.5"/><rect ${f} x="${[34, 32, 30][i]}" y="${y - 2}" width="1.6" height="8"/>`).join(""),
    funnel: [5, 12, 19, 26].map((y, i) => `<rect ${f} x="${4 + i * 4.5}" y="${y}" width="${40 - i * 9}" height="4.5" rx="1.5"/>`).join(""),
    table: `<rect ${s} x="4" y="4" width="40" height="24" rx="2.5" stroke-width="1.5"/>` + [11, 18, 24].map((y) => `<line ${s} stroke-width="1" x1="4" x2="44" y1="${y - 1}" y2="${y - 1}"/>`).join("") + `<line ${s} stroke-width="1" x1="20" x2="20" y1="4" y2="28"/>`,
  };
  return `<svg class="sketch" viewBox="0 0 48 32" aria-hidden="true">${body[form] ?? body.bars}</svg>`;
}

export function renderBrowse(root: HTMLElement, spec: BrowseSpec, host: Host): void {
  root.innerHTML = `
    <div class="search"><span class="s-icon" aria-hidden="true">⌕</span><input type="search" class="s-input" placeholder="Search charts and data: cash, overdue, customers…" aria-label="Search charts and data" value="${esc(spec.query)}"><span class="s-count fine"></span></div>
    <div class="results" role="list"></div>
    <div class="opened"></div>`;
  const input = root.querySelector<HTMLInputElement>(".s-input")!;
  const results = root.querySelector<HTMLElement>(".results")!;
  const opened = root.querySelector<HTMLElement>(".opened")!;
  const count = root.querySelector<HTMLElement>(".s-count")!;

  const card = (it: CatalogItem) =>
    `<button class="card" role="listitem" type="button" data-id="${esc(it.id)}">${sketch(it.form)}<span class="c-text"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span><span class="c-go" aria-hidden="true">Open</span></button>`;

  function list() {
    const q = input.value.trim();
    const hits = search(q, spec.items);
    count.textContent = q ? `${hits.length} of ${spec.items.length}` : `${spec.items.length} charts`;
    results.innerHTML = hits.length
      ? hits.map(card).join("")
      : `<div class="empty">Nothing matches "${esc(q)}". <button class="tbtn" type="button" data-ask="1">Ask Claude instead</button></div>`;
  }

  async function open(id: string) {
    const box = document.createElement("div");
    box.className = "open-item";
    box.innerHTML = `<div class="loading">Loading…</div>`;
    opened.prepend(box);
    try {
      const v = (await host.call("show_metric", { metric: id })) as unknown as ViewSpec;
      const title = v.panels[0]?.title ?? id;
      box.innerHTML = `<div class="o-bar"><span class="fine">Opened from search</span><span><button class="tbtn" type="button" data-act="ask">Ask Claude about this</button> <button class="tbtn" type="button" data-act="close" aria-label="Close ${esc(title)}">✕</button></span></div>`;
      renderView(box, v, host);
      box.querySelector('[data-act="ask"]')!.addEventListener("click", () => host.ask(`Explain the "${title}" chart: what stands out and what should we do?`));
      box.querySelector('[data-act="close"]')!.addEventListener("click", () => box.remove());
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      box.innerHTML = `<p class="sub">Could not open ${esc(id)}: ${esc(String((e as Error).message))}</p>`;
    }
  }

  results.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    if (b.dataset.id) open(b.dataset.id);
    else if (b.dataset.ask) host.ask(`Find data about: ${input.value.trim()}`);
  });
  input.addEventListener("input", list);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") results.querySelector<HTMLButtonElement>(".card")?.click();
  });
  list();
}
