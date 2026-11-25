import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import type { AnySpec, ViewSpec } from "../src/spec.js";
import { destroyCharts, renderView, type Host } from "./charts.js";
import { renderBrowse } from "./browse.js";
import { renderReport } from "./report.js";

const root = document.getElementById("root")!;
let last: AnySpec | undefined;
const inHost = window.parent !== window;

const app = new App({ name: "kinnser-view", version: "0.3.0" }, {}, { autoResize: true });

const hostApi: Host = {
  ask: (text) => void app.sendMessage({ role: "user", content: [{ type: "text", text }] }).catch((e) => console.error(e)),
  download: (filename, mimeType, text) =>
    void app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${filename}`, mimeType, text } }] }).catch((e) => console.error(e)),
  async call(tool, args) {
    const r = await app.callServerTool({ name: tool, arguments: args });
    if (r.isError) throw new Error((r.content?.[0] as { text?: string })?.text ?? `${tool} failed`);
    return (r.structuredContent ?? {}) as Record<string, unknown>;
  },
};

// browser preview: same UI, the server logic runs in the page
const previewApi: Host = {
  ask: (text) => toast(`Would send to Claude: “${text.slice(0, 90)}${text.length > 90 ? "…" : ""}”`),
  download(filename, mimeType, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mimeType }));
    a.download = filename;
    a.click();
    toast(`Downloaded ${filename}`);
  },
  async call(tool, args) {
    const m = await import("../src/metrics.js");
    if (tool === "show_metric") return m.metricSpec(args.metric as never) as unknown as Record<string, unknown>;
    if (tool === "compose") {
      const panels = [...(args.ids as string[]).map((id) => m.METRICS[id as keyof typeof m.METRICS]()), ...((args.extras as never[]) ?? [])];
      const tiles = args.tiles ? m.dashboardSpec().tiles ?? [] : [];
      const view: ViewSpec = { title: String(args.topic), asOf: "2026-11", source: "sample", tiles, panels };
      return { view, message: m.composeMessage(String(args.topic), panels, tiles) };
    }
    throw new Error(`no preview for ${tool}`);
  },
};
const host = inHost ? hostApi : previewApi;

function toast(text: string) {
  let el = document.querySelector<HTMLElement>(".toast.global");
  if (!el) {
    el = document.createElement("p");
    el.className = "toast global";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = text;
  el.hidden = false;
  clearTimeout(Number(el.dataset.t));
  el.dataset.t = String(setTimeout(() => (el!.hidden = true), 2600));
}

export function render(spec: AnySpec): void {
  last = spec;
  destroyCharts();
  root.innerHTML = "";
  if (spec.mode === "browse") renderBrowse(root, spec, host);
  else if (spec.mode === "report") renderReport(root, spec, host);
  else renderView(root, spec, host);
  addFullscreen();
}

function addFullscreen() {
  const modes = app.getHostContext()?.availableDisplayModes ?? [];
  if (!modes.includes("fullscreen")) return;
  const b = document.createElement("button");
  b.className = "tbtn fs";
  b.type = "button";
  const isFull = app.getHostContext()?.displayMode === "fullscreen";
  b.textContent = isFull ? "Exit full screen" : "Full screen";
  b.addEventListener("click", async () => {
    const r = await app.requestDisplayMode({ mode: isFull ? "inline" : "fullscreen" });
    b.textContent = r.mode === "fullscreen" ? "Exit full screen" : "Full screen";
  });
  root.prepend(b);
}

(window as unknown as { render: typeof render }).render = render;

app.ontoolinput = () => {
  if (!last) root.innerHTML = `<div class="loading">Preparing…</div>`;
};
app.ontoolresult = (params) => {
  const s = params.structuredContent as unknown as AnySpec | undefined;
  if (s && ("panels" in s || s.mode === "browse" || s.mode === "report")) render(s);
  else root.innerHTML = ""; // nothing to show: stay out of the way
};
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    if (last && (last.mode ?? "view") === "view") render(last); // chart colours are read at draw time
  }
};
if (inHost) {
  app.connect().then(() => { const th = app.getHostContext()?.theme; if (th) applyDocumentTheme(th); }).catch((e) => console.error(e));
}
