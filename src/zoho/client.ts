// Zoho Books API client: refresh-token OAuth, data-centre aware, retries on 401/429, paging, short cache.
// Read-only: only GET calls are made.

export interface ZohoConfig {
  dc: string; // com | in | eu | com.au | jp | ca | com.cn | sa
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  orgId: string;
}

const DCS = new Set(["com", "in", "eu", "com.au", "jp", "ca", "com.cn", "sa"]);

// accept the names other projects use, so an existing .env can be copied as-is
const ALIASES = {
  dc: ["ZOHO_DC", "ZOHO_DATA_CENTER", "ZOHO_DATACENTER", "ZOHO_REGION", "ZOHO_DOMAIN", "ZOHO_ACCOUNTS_URL", "ZOHO_API_DOMAIN"],
  clientId: ["ZOHO_CLIENT_ID", "ZOHO_BOOKS_CLIENT_ID"],
  clientSecret: ["ZOHO_CLIENT_SECRET", "ZOHO_BOOKS_CLIENT_SECRET"],
  refreshToken: ["ZOHO_REFRESH_TOKEN", "ZOHO_BOOKS_REFRESH_TOKEN"],
  orgId: ["ZOHO_BOOKS_ORG_ID", "ZOHO_ORG_ID", "ZOHO_ORGANIZATION_ID", "ZOHO_BOOKS_ORGANIZATION_ID"],
};
const pick = (env: NodeJS.ProcessEnv, keys: string[]) => keys.map((k) => env[k]?.trim()).find(Boolean) ?? "";
/** "https://accounts.zoho.in", "zohoapis.eu", ".com.au", "IN" -> "in" / "eu" / "com.au" */
export const normalizeDc = (v: string) => (v.toLowerCase().match(/zoho(?:apis)?\.([a-z.]+?)\/?$/)?.[1] ?? v.toLowerCase()).replace(/^\./, "").replace(/\/$/, "") || "com";

/** null when any value is missing, so the server falls back to sample data */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ZohoConfig | null {
  const cfg = {
    dc: normalizeDc(pick(env, ALIASES.dc) || "com"),
    clientId: pick(env, ALIASES.clientId),
    clientSecret: pick(env, ALIASES.clientSecret),
    refreshToken: pick(env, ALIASES.refreshToken),
    orgId: pick(env, ALIASES.orgId),
  };
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken || !cfg.orgId) return null;
  if (!DCS.has(cfg.dc)) throw new Error(`ZOHO_DC "${cfg.dc}" is not a Zoho data centre (${[...DCS].join(", ")})`);
  return cfg;
}

export class ZohoError extends Error {}

type Fetch = typeof fetch;
type Json = Record<string, unknown>;

export class ZohoBooks {
  private token?: { value: string; exp: number };
  private cache = new Map<string, { exp: number; data: Json }>();

  constructor(
    private cfg: ZohoConfig,
    private http: Fetch = fetch,
    private now: () => number = Date.now,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private ttlMs = 10 * 60_000, // shortcut: in-memory cache per process, move to a DB/Redis when several instances run
  ) {}

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.exp > this.now()) return this.token.value;
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.cfg.refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret });
    const r = await this.http(`https://accounts.zoho.${this.cfg.dc}/oauth/v2/token`, { method: "POST", body });
    const j = (await r.json().catch(() => ({}))) as Json;
    if (!r.ok || typeof j.access_token !== "string") {
      // never echo the secret or token, only Zoho's error code
      throw new ZohoError(`Zoho login failed (${String(j.error ?? r.status)}). Check ZOHO_CLIENT_ID / SECRET / REFRESH_TOKEN and ZOHO_DC=${this.cfg.dc}.`);
    }
    const ttl = Number(j.expires_in ?? 3600) * 1000;
    this.token = { value: j.access_token, exp: this.now() + ttl - 60_000 };
    return this.token.value;
  }

  /** GET /books/v3/{path}. Retries once on 401 (new token) and up to 3 times on 429 / 5xx. */
  async get(path: string, params: Record<string, string | number> = {}): Promise<Json> {
    const qs = new URLSearchParams({ organization_id: this.cfg.orgId, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const url = `https://www.zohoapis.${this.cfg.dc}/books/v3/${path.replace(/^\//, "")}?${qs}`;
    const hit = this.cache.get(url);
    if (hit && hit.exp > this.now()) return hit.data;

    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const r = await this.http(url, { headers: { Authorization: `Zoho-oauthtoken ${await this.accessToken(false)}` } });
      if (r.status === 401 && !refreshed) {
        refreshed = true;
        await this.accessToken(true);
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && attempt < 3) {
        const wait = Number(r.headers.get("retry-after")) * 1000 || 2 ** attempt * 1000;
        await this.sleep(Math.min(wait, 30_000));
        continue;
      }
      const j = (await r.json().catch(() => ({}))) as Json;
      if (!r.ok || (j.code !== undefined && j.code !== 0)) {
        const hint = r.status === 429 ? " (rate limit: try again in a minute)" : r.status === 401 ? " (token rejected: check scopes)" : "";
        throw new ZohoError(`Zoho Books ${path} failed: ${String(j.message ?? r.status)}${hint}`);
      }
      this.cache.set(url, { exp: this.now() + this.ttlMs, data: j });
      return j;
    }
  }

  /** newest-first pages until records are older than `from` (YYYY-MM-DD); keeps old history out of memory */
  async listSince<T extends { date: string }>(path: string, key: string, from: string, params: Record<string, string | number> = {}, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const j = await this.get(path, { ...params, sort_column: "date", sort_order: "D", page, per_page: 200 });
      const rows = (j[key] as T[]) ?? [];
      out.push(...rows.filter((r) => r.date >= from));
      const more = (j.page_context as { has_more_page?: boolean } | undefined)?.has_more_page;
      if (!more || rows.length === 0 || rows[rows.length - 1].date < from) return out;
    }
    console.error(`[zoho] ${path}: stopped at ${maxPages} pages (${out.length} records)`);
    return out;
  }

  /** every page of a list endpoint, capped so a huge account can't run away */
  async list<T>(path: string, key: string, params: Record<string, string | number> = {}, maxPages = 50): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const j = await this.get(path, { ...params, page, per_page: 200 });
      out.push(...((j[key] as T[]) ?? []));
      if (!(j.page_context as { has_more_page?: boolean } | undefined)?.has_more_page) return out;
    }
    console.error(`[zoho] ${path}: stopped at ${maxPages} pages (${out.length} records)`);
    return out;
  }
}
