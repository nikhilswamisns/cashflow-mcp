# kinnser-mcp

MCP server that gives Claude projects ready-made finance metrics and charts from Zoho Books.
Zoho's own MCP returns raw records; this server returns pre-aggregated metrics, consistent charts and computed insights.

Chart UI and chart code are reused from `~/Downloads/cashflow_with_ml` (repo `nikhilswamisns/cashflow_with_ml`).

## Roadmap

1. **Zoho main data**: connect to Zoho Books and pull the core data and metrics (revenue trend, AR aging, top customers, expenses by category). Tools `get_metric`, `get_chart`. Source: Zoho Books reports API.
2. **Zoho Analytics charts**: fetch the company's existing Zoho Analytics reports and dashboards and show them as charts. Tools `list_reports`, `get_report`.
3. **Custom charts** from cashflow_with_ml (waterfall, forecast, ...). Same tools, new `chart_type` values.
4. **AI layer**, per company: `insights`, `forecast`, custom asks.

## Design rules

- Aggregate in Zoho reports or the DB; send Claude small results (e.g. 120 monthly points), never raw rows.
- Numbers come from code with fixed formulas; Claude only narrates them.
- One pack of metrics per data source (Zoho Books), shared by every company. Onboarding = one OAuth click.
- Read-only Zoho scopes. Credentials in `.env`, never in chat or git.

## Setup

```bash
npm install
npm run check       # type-check + picker, table-inference and Zoho tests (no network)
npm run smoke       # builds the UI, starts the server over stdio, calls every tool
npm run preview     # builds, writes sample data, opens http://localhost:5178/view.html with a demo bar
npm run zoho:check  # with .env filled: logs in to Zoho Books and builds every metric from live data
```

### Zoho Books

Copy `.env.example` to `.env` (or copy an existing project's `.env`: `ZOHO_ORG_ID`, `ZOHO_ACCOUNTS_URL` and similar names are understood) and fill in the Self Client values. With all four credentials present the server uses live Zoho Books; with any missing it uses sample data. A Zoho failure is returned as an error, never replaced by sample numbers.

What is read (`src/zoho/books.ts`, all whole calendar months up to last month):

| Metric | Zoho Books source |
|---|---|
| cash in / out, cash balance, runway | customer payments; vendor payments + expenses; bank and cash account balances walked back month by month |
| receivables by age, overdue invoices, A/R tile | open invoices (not void or draft) by days past due |
| revenue by customer / by customer type | invoices in the last 12 months; contact `customer_sub_type` |
| change in days to pay | paid invoices: issue date to last payment date, last 12 months vs the year before |
| cash in by method | customer payments by `payment_mode` |
| quote to invoice | estimates in the last 90 days: sent, accepted, invoiced |
| collections vs target | customer payments vs `ZOHO_COLLECTIONS_MONTHLY_TARGET` |

Calls are read-only, cached 10 minutes, retried on rate limits, and paged newest-first so old history is not downloaded.

## How charts are chosen

The server never says "draw a bar chart". Each metric returns a **panel** that says what the data *is* (`src/spec.ts`); `pickChart()` picks the form. Rules come from the charts in cashflow_with_ml and tsp-ai-demo, checked against the dataviz rules (one axis, no pie past 6 parts, line only over time, fold past 8 series).

| Data is… | Panel | Chart |
|---|---|---|
| a balance over time | `trend`, `measure: "level"` | area (one series) or line; plan = dashed grey, forecast = dashed orange + likely-range band |
| an amount per period | `trend`, `measure: "flow"` | bars; `parts` → stacked bars; `inOut` → in up / out down + net line |
| a value per category | `breakdown` | ranked horizontal bars, largest first, top 10 + "Other" |
| ordered categories (aging) | `breakdown`, `ordered` | columns in their own order |
| signed change per category | `breakdown` with negatives | diverging bars, green = better (`goodWhen`) |
| 2–3 values per category | `breakdown`, several series | grouped (or `parts` → stacked) horizontal bars |
| one whole split ≤ 6 parts | `share` | donut with total in the middle; > 6 parts or rates → ranked bars |
| actual vs target per row | `progress` | bullet rows: bar = so far, line = target, orange tick = projected |
| stages | `funnel` | funnel rows, % of first stage |
| a list to read | `table` | table |

Every chart has a Table toggle, a code-written insight line, and Actual/Prediction tags. Colours keep one meaning (blue actual, orange forecast, grey plan, green in/good, red out/bad); the 5 categorical slots pass the dataviz colour-blind validator in light and dark.

## Tools

| Tool | When Claude calls it | What the user sees |
|---|---|---|
| `dashboard` | start of a chat, "how are we doing" | KPI tiles with sparklines, cash balance + forecast, cash in vs out |
| `show_metric` | a question that matches one of our 10 metrics | that metric in its picked chart |
| `visualize` | **after answering in text**, only when a chart or tiles help | Claude's answer has the numbers: they are charted with our templates (one row: KPI tiles); if we hold that metric, Claude's numbers are checked against ours and conflicts are flagged and sent back. No numbers in the answer: we pull our own data for the question. Neither: nothing is shown |
| `browse` | "what data do we have", "find the overdue chart" | a search box over every chart; open results inline, ask Claude about one |
| `report` | "make a report / summary / message for X" | a builder: sections that fit X pre-checked (plus tables from Claude's answer), the rest one click away; Report or Message; create, then download HTML / CSV / .txt, copy, or ask Claude to polish |
| `compose` | view only | assembles the chosen report sections |

The rule: **our data wins when we have it; Claude's answer is charted when we don't; nothing shows when no chart is needed.** Every chart from Claude's numbers is tagged "From Claude's answer".

In the view: click a bar to get an "Ask Claude about …" chip (never sends on its own), sort and filter tables, CSV per chart, full screen when the host allows it.

### Project instructions to paste

> Answer in text first. Then, only if a chart or headline tiles would help, call `kinnser.visualize` with the question; pass the numbers from your answer as `table` when you have them, and set `metric` when the question is about one of ours. When asked for a report, summary or update, call `kinnser.report`. When asked what data exists, call `kinnser.browse`. Do not call any of these when a chart adds nothing.

## What exists now

- One MCP App view (`ui/main.ts` routes to `charts.ts`, `table.ts`, `browse.ts`, `report.ts`; bundled to one HTML file by Vite), light and dark.
- `src/infer.ts` turns a plain table into a panel (months → trend, buckets → ordered columns, actual + target → bullet rows, one row → tiles, mixed units → table) and matches labels for the conflict check (case, Inc/LLC, "Nov 2026" = "2026-11").
- All numbers for our metrics come from `src/metrics.ts`; text results give Claude the same numbers. Data is sample until the Zoho Books client lands.
- `npm run gallery` writes preview specs (`gallery`, `plot`, `claude`, `browse`, `report`) into `dist/ui/`; open `view.html` from a local server and call `window.render(spec)`. In the browser preview, downloads and "ask Claude" are stubbed.
- Transport is stdio (Claude Desktop, Claude Code). A claude.ai project connector needs a remote HTTP endpoint: next step after Zoho.

### Try it in Claude Desktop

Add to `claude_desktop_config.json`:

```json
{ "mcpServers": { "kinnser": { "command": "npx", "args": ["tsx", "/Users/kiran/Desktop/sns_systems/kinnser-mcp/src/server.ts"] } } }
```

Run `npm run build` first, then ask Claude "show cash dashboard".
