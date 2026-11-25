// Report / message builder: sections that fit the ask are pre-checked, everything else is one click away.
import type { CatalogItem, Panel, ReportSpec, ViewSpec } from "../src/spec.js";
import { pickChart } from "../src/spec.js";
import { destroyCharts, esc, renderView, type Host } from "./charts.js";
import { sketch } from "./browse.js";

type Row = { key: string; title: string; sub: string; form: CatalogItem["form"]; from: "catalog" | "answer" };

export function renderReport(root: HTMLElement, spec: ReportSpec, host: Host): void {
  let format = spec.format;
  let topic = spec.topic;
  const rec = new Set(spec.recommended);
  const extras: Row[] = spec.extras.map((p, i) => ({ key: `x${i}`, title: p.title, sub: p.sub ?? "From Claude's answer", form: pickChart(p), from: "answer" }));
  const items: Row[] = spec.items.map((it) => ({ key: it.id, title: it.title, sub: it.sub, form: it.form, from: "catalog" }));
  const recommended = [...extras, ...items.filter((r) => rec.has(r.key))];
  const others = items.filter((r) => !rec.has(r.key));
  const picked = new Set([...recommended.map((r) => r.key), "tiles"]);

  const row = (r: Row) =>
    `<label class="pick"><input type="checkbox" value="${esc(r.key)}"${picked.has(r.key) ? " checked" : ""}>${sketch(r.form)}<span class="c-text"><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></span>${r.from === "answer" ? `<span class="tag">From answer</span>` : ""}</label>`;

  function builder() {
    destroyCharts();
    root.innerHTML = `
      <section class="panel builder">
        <div class="b-head">
          <div class="seg" role="radiogroup" aria-label="What to create">
            <button type="button" role="radio" data-f="report" aria-checked="${format === "report"}">Report</button>
            <button type="button" role="radio" data-f="message" aria-checked="${format === "message"}">Message</button>
          </div>
          <input class="b-topic" value="${esc(topic)}" aria-label="Title">
        </div>
        <h3>Recommended for “${esc(topic)}”</h3>
        <div class="picks">
          <label class="pick"><input type="checkbox" value="tiles"${picked.has("tiles") ? " checked" : ""}><svg class="sketch" viewBox="0 0 48 32" aria-hidden="true"><rect x="3" y="8" width="12" height="16" rx="2.5" fill="currentColor" opacity=".3"/><rect x="18" y="8" width="12" height="16" rx="2.5" fill="currentColor" opacity=".3"/><rect x="33" y="8" width="12" height="16" rx="2.5" fill="currentColor" opacity=".3"/></svg><span class="c-text"><b>Headline numbers</b><small>Cash in, cash out, net, A/R overdue, runway</small></span></label>
          ${recommended.map(row).join("")}
        </div>
        <details${recommended.length ? "" : " open"}><summary>Also available (${others.length})</summary><div class="picks">${others.map(row).join("")}</div></details>
        <div class="b-foot"><span class="fine b-count"></span><button class="primary" type="button" data-act="create"></button></div>
      </section>`;
    const sync = () => {
      const n = picked.size;
      root.querySelector(".b-count")!.textContent = `${n} section${n === 1 ? "" : "s"} selected`;
      const btn = root.querySelector<HTMLButtonElement>('[data-act="create"]')!;
      btn.textContent = format === "report" ? "Create report" : "Write message";
      btn.disabled = n === 0;
    };
    root.querySelectorAll<HTMLInputElement>('.pick input').forEach((cb) =>
      cb.addEventListener("change", () => { cb.checked ? picked.add(cb.value) : picked.delete(cb.value); sync(); }),
    );
    root.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) =>
      b.addEventListener("click", () => {
        format = b.dataset.f as ReportSpec["format"];
        root.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
        sync();
      }),
    );
    root.querySelector<HTMLInputElement>(".b-topic")!.addEventListener("input", (e) => (topic = (e.target as HTMLInputElement).value));
    root.querySelector('[data-act="create"]')!.addEventListener("click", create);
    sync();
  }

  async function create() {
    const ids = [...picked].filter((k) => k !== "tiles" && !k.startsWith("x"));
    const ex: Panel[] = [...picked].filter((k) => k.startsWith("x")).map((k) => spec.extras[Number(k.slice(1))]);
    const btn = root.querySelector<HTMLButtonElement>('[data-act="create"]')!;
    btn.disabled = true;
    btn.textContent = "Creating…";
    try {
      const r = (await host.call("compose", { topic, ids, extras: ex, tiles: picked.has("tiles") })) as { view: ViewSpec; message: string };
      result(r.view, r.message);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Try again";
      root.querySelector(".b-count")!.textContent = `Could not create: ${(e as Error).message}`;
    }
  }

  function result(v: ViewSpec, message: string) {
    destroyCharts();
    const name = (topic || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
    root.innerHTML = `
      <div class="toolbar">
        <button class="tbtn" type="button" data-act="back">← Edit sections</button>
        <span class="tb-right">
          ${format === "message" ? `<button class="tbtn" type="button" data-act="copy">Copy message</button><button class="tbtn" type="button" data-act="txt">Download .txt</button>` : `<button class="tbtn" type="button" data-act="html">Download report</button><button class="tbtn" type="button" data-act="copy">Copy as message</button>`}
          <button class="primary sm" type="button" data-act="polish">${format === "message" ? "Ask Claude to polish" : "Ask Claude for a summary"}</button>
        </span>
      </div>
      ${format === "message" ? `<textarea class="msg" aria-label="Message text" spellcheck="true">${esc(message)}</textarea><details class="charts-under"><summary>Charts behind this message</summary><div class="rep"></div></details>` : `<div class="rep report-doc"><h1>${esc(v.title)}</h1></div>`}
      <p class="toast" role="status" hidden></p>`;
    const rep = root.querySelector<HTMLElement>(".rep")!;
    renderView(rep, v, host, { static: format === "report" });
    const ta = root.querySelector<HTMLTextAreaElement>(".msg");
    if (ta) ta.style.height = `${ta.scrollHeight + 4}px`; // show the whole message, no inner scroll
    const toast = (t: string) => {
      const el = root.querySelector<HTMLElement>(".toast")!;
      el.textContent = t;
      el.hidden = false;
      setTimeout(() => (el.hidden = true), 2200);
    };
    const text = () => root.querySelector<HTMLTextAreaElement>(".msg")?.value ?? message;
    root.querySelector('[data-act="back"]')!.addEventListener("click", builder);
    root.querySelector('[data-act="copy"]')!.addEventListener("click", async () => toast((await copy(text())) ? "Copied" : "Select the text and copy it"));
    root.querySelector('[data-act="txt"]')?.addEventListener("click", () => host.download(`${name}.txt`, "text/plain", text()));
    root.querySelector('[data-act="html"]')?.addEventListener("click", () => host.download(`${name}.html`, "text/html", standalone(rep, v.title)));
    root.querySelector('[data-act="polish"]')!.addEventListener("click", () =>
      host.ask(format === "message" ? `Polish this message, keep every number exactly as is:\n\n${text()}` : `Write a short executive summary of the "${v.title}" report: ${v.panels.map((p) => p.title).join(", ")}. Use only the numbers from the charts.`),
    );
  }

  builder();
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // sandboxed iframes often block the clipboard API; fall back to a hidden textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** a self-contained HTML file of the report: canvases become images, buttons are dropped */
function standalone(rep: HTMLElement, title: string): string {
  const clone = rep.cloneNode(true) as HTMLElement;
  const live = rep.querySelectorAll("canvas");
  clone.querySelectorAll("canvas").forEach((c, i) => {
    const img = document.createElement("img");
    img.src = live[i].toDataURL("image/png");
    img.alt = c.getAttribute("aria-label") ?? "";
    img.style.width = "100%";
    c.replaceWith(img);
  });
  clone.querySelectorAll("button, .p-ask, .t-filter, .t-foot").forEach((b) => b.remove());
  clone.querySelectorAll<HTMLElement>("[hidden]").forEach((h) => h.classList.contains("p-table") && h.removeAttribute("hidden"));
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  const theme = document.documentElement.getAttribute("data-theme") ?? "";
  return `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${css}\nbody{max-width:960px;margin:0 auto;padding:24px}</style></head><body>${clone.outerHTML}</body></html>`;
}
