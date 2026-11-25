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
npm run check     # type-check + chart picker rules
npm run smoke     # builds the UI, starts the server over stdio, calls every tool
npm run gallery   # writes dist/ui/gallery.json: every chart form, for a browser preview
```

Copy `.env.example` to `.env` and fill in the Zoho Self Client values (not used yet: data is sample).

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

## What exists now

- `dashboard` tool: 5 KPI tiles with sparklines, cash balance with forecast, cash in vs out.
- `show_metric` tool: any of the 10 catalog metrics in `src/metrics.ts`, drawn in the picked form.
- One MCP App view (`ui/view.*`, bundled to one HTML file by Vite) renders every spec, light and dark.
- All numbers come from `src/metrics.ts`; the text result gives Claude the same numbers so it narrates and never recomputes. Data is sample until the Zoho Books client lands.
- Transport is stdio (Claude Desktop, Claude Code). A claude.ai project connector needs a remote HTTP endpoint: next step after Zoho.

### Try it in Claude Desktop

Add to `claude_desktop_config.json`:

```json
{ "mcpServers": { "kinnser": { "command": "npx", "args": ["tsx", "/Users/kiran/Desktop/sns_systems/kinnser-mcp/src/server.ts"] } } }
```

Run `npm run build` first, then ask Claude "show cash dashboard".
