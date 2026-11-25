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
npm run smoke   # builds the UI, starts the server over stdio, calls the dashboard tool
```

Copy `.env.example` to `.env` and fill in the Zoho Self Client values (not used yet: data is mock).

## What exists now

- `dashboard` tool (`src/server.ts`): 5 tiles (cash in, cash out, net, AR overdue, runway) and a monthly cash in/out chart, rendered inline in Claude as an MCP App (`ui/dashboard.*`, bundled to one HTML file by Vite).
- All numbers are computed in `src/metrics.ts`. Data is mock until the Zoho Books client lands.
- Transport is stdio (Claude Desktop, Claude Code). A claude.ai project connector needs a remote HTTP endpoint: next step after Zoho.

### Try it in Claude Desktop

Add to `claude_desktop_config.json`:

```json
{ "mcpServers": { "kinnser": { "command": "npx", "args": ["tsx", "/Users/kiran/Desktop/sns_systems/kinnser-mcp/src/server.ts"] } } }
```

Run `npm run build` first, then ask Claude "show cash dashboard".
