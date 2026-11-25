// Interactive table: click a header to sort, filter box when long, show-all toggle, flagged rows highlighted.
import type { Unit } from "../src/spec.js";
import { esc, full, type TableData } from "./charts.js";

export function toCsv(d: TableData): string {
  const q = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [d.cols.map((c) => q(c.label || "Item")), ...d.rows.map((r) => r.map((v) => q(typeof v === "number" ? Math.round(v * 100) / 100 : v)))].map((r) => r.join(",")).join("\n");
}

export function tableEl(d: TableData, o: { flagged?: Set<string>; maxRows?: number } = {}): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "itable";
  const max = o.maxRows ?? 12;
  let sortCol = -1, asc = true, filter = "", all = false;

  const cell = (v: string | number | null, u?: Unit) => (u ? `<td class="num r">${v === null ? "–" : esc(full(Number(v), u))}</td>` : `<td>${esc(String(v ?? "Not recorded"))}</td>`);

  function draw() {
    let rows = d.rows.map((r, i) => ({ r, i }));
    if (filter) rows = rows.filter(({ r }) => r.some((v) => String(v ?? "").toLowerCase().includes(filter)));
    if (sortCol >= 0) {
      rows.sort((a, b) => {
        const x = a.r[sortCol], y = b.r[sortCol];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
        return asc ? c : -c;
      });
    }
    const shown = all ? rows : rows.slice(0, max);
    const head = d.cols
      .map((c, i) => `<th${c.unit ? ' class="r"' : ""} aria-sort="${sortCol === i ? (asc ? "ascending" : "descending") : "none"}"><button type="button" data-col="${i}">${esc(c.label || "Item")}<span class="sort">${sortCol === i ? (asc ? "▲" : "▼") : ""}</span></button></th>`)
      .join("");
    const body = shown
      .map(({ r }) => `<tr${o.flagged?.has(String(r[0]).toLowerCase()) ? ' class="flag" title="Differs from the answer"' : ""}>${r.map((v, i) => cell(v, d.cols[i].unit)).join("")}</tr>`)
      .join("");
    const more = rows.length > max ? `<button class="tbtn" type="button" data-act="all">${all ? "Show fewer" : `Show all ${rows.length}`}</button>` : "";
    const count = filter ? `<span class="fine">${rows.length} of ${d.rows.length}</span>` : "";
    wrap.querySelector(".tablewrap")!.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${d.cols.length}" class="fine">No rows match.</td></tr>`}</tbody></table>`;
    wrap.querySelector(".t-foot")!.innerHTML = `${count}${more}`;
  }

  wrap.innerHTML = `${d.rows.length > 8 ? `<input class="t-filter" type="search" placeholder="Filter rows…" aria-label="Filter rows">` : ""}<div class="tablewrap"></div><div class="t-foot"></div>`;
  wrap.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (!b) return;
    if (b.dataset.col !== undefined) {
      const c = Number(b.dataset.col);
      asc = sortCol === c ? !asc : !d.cols[c].unit; // numbers start largest first
      sortCol = c;
    } else if (b.dataset.act === "all") all = !all;
    draw();
  });
  wrap.querySelector<HTMLInputElement>(".t-filter")?.addEventListener("input", (e) => {
    filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
    draw();
  });
  draw();
  return wrap;
}
