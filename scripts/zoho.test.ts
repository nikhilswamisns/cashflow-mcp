// Zoho client against a fake Zoho, and Books builders against fixture records. No network, no credentials.
import assert from "node:assert/strict";
import { configFromEnv, normalizeDc, ZohoBooks, type ZohoConfig } from "../src/zoho/client.js";
import * as B from "../src/zoho/books.js";
import { pickChart } from "../src/spec.js";

// ---------- config ----------
assert.equal(configFromEnv({}), null, "no credentials -> sample mode");
const env = { ZOHO_ORG_ID: "123", ZOHO_CLIENT_ID: "id", ZOHO_CLIENT_SECRET: "sec", ZOHO_REFRESH_TOKEN: "rt", ZOHO_ACCOUNTS_URL: "https://accounts.zoho.in" };
assert.deepEqual(configFromEnv(env), { dc: "in", clientId: "id", clientSecret: "sec", refreshToken: "rt", orgId: "123" }, "aliases + accounts URL");
assert.equal(normalizeDc("https://www.zohoapis.com.au"), "com.au");
assert.equal(normalizeDc(".eu"), "eu");
assert.equal(normalizeDc("IN"), "in");
assert.throws(() => configFromEnv({ ...env, ZOHO_ACCOUNTS_URL: "mars" }), /not a Zoho data centre/);

// ---------- client ----------
const cfg: ZohoConfig = { dc: "eu", clientId: "id", clientSecret: "s3cr3t-val", refreshToken: "rt-val-9", orgId: "42" };
type Call = { url: string; auth?: string };
function fake(script: (url: string, n: number) => { status: number; body: object; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  let tokens = 0;
  const http = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/oauth/v2/token")) {
      tokens++;
      return new Response(JSON.stringify({ access_token: `tok${tokens}`, expires_in: 3600 }), { status: 200 });
    }
    calls.push({ url: u, auth: (init?.headers as Record<string, string>)?.Authorization });
    const r = script(u, calls.length);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return { http, calls, tokens: () => tokens };
}
const noSleep = async () => {};

{
  const f = fake(() => ({ status: 200, body: { code: 0, bankaccounts: [{ account_name: "Op" }] } }));
  const z = new ZohoBooks(cfg, f.http, Date.now, noSleep);
  await z.get("bankaccounts");
  await z.get("bankaccounts");
  assert.equal(f.tokens(), 1, "token reused");
  assert.equal(f.calls.length, 1, "second call served from cache");
  assert.match(f.calls[0].url, /^https:\/\/www\.zohoapis\.eu\/books\/v3\/bankaccounts\?organization_id=42/);
  assert.equal(f.calls[0].auth, "Zoho-oauthtoken tok1");
}
{
  const f = fake((_, n) => (n === 1 ? { status: 401, body: { code: 57, message: "expired" } } : { status: 200, body: { code: 0, invoices: [] } }));
  await new ZohoBooks(cfg, f.http, Date.now, noSleep).get("invoices");
  assert.equal(f.tokens(), 2, "401 -> new token, retried");
  assert.equal(f.calls[1].auth, "Zoho-oauthtoken tok2");
}
{
  const waits: number[] = [];
  const f = fake((_, n) => (n === 1 ? { status: 429, body: {}, headers: { "retry-after": "2" } } : { status: 200, body: { code: 0, invoices: [] } }));
  await new ZohoBooks(cfg, f.http, Date.now, async (ms) => void waits.push(ms)).get("invoices");
  assert.deepEqual(waits, [2000], "429 waits Retry-After then retries");
}
{
  const f = fake(() => ({ status: 200, body: { code: 1002, message: "Organization does not exist" } }));
  await assert.rejects(new ZohoBooks(cfg, f.http, Date.now, noSleep).get("invoices"), (e: Error) => /Organization does not exist/.test(e.message) && !e.message.includes("s3cr3t-val") && !e.message.includes("rt-val-9"));
}
{
  const bad = (async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(new ZohoBooks(cfg, bad, Date.now, noSleep).get("x"), (e: Error) => /Zoho login failed \(invalid_client\)/.test(e.message) && !e.message.includes("s3cr3t-val"));
}
{
  // newest-first paging stops once records are older than the window
  const pages = [[{ date: "2026-11-02" }, { date: "2026-10-01" }], [{ date: "2026-08-10" }, { date: "2026-05-01" }], [{ date: "2025-01-01" }]];
  const f = fake((url) => {
    const p = Number(new URL(url).searchParams.get("page"));
    return { status: 200, body: { code: 0, invoices: pages[p - 1], page_context: { has_more_page: p < pages.length } } };
  });
  const rows = await new ZohoBooks(cfg, f.http, Date.now, noSleep).listSince<{ date: string }>("invoices", "invoices", "2026-06-01");
  assert.deepEqual(rows.map((r) => r.date), ["2026-11-02", "2026-10-01", "2026-08-10"]);
  assert.equal(f.calls.length, 2, "page 3 never fetched");
  assert.match(f.calls[0].url, /sort_column=date&sort_order=D/);
}

// ---------- builders ----------
const inv = (o: Partial<B.Invoice>): B.Invoice => ({ invoice_id: Math.random().toString(36), invoice_number: "INV", customer_id: "c1", customer_name: "Acme", status: "sent", date: "2026-10-01", due_date: "2026-10-31", total: 0, balance: 0, ...o });
const data: B.BooksData = {
  today: "2026-11-25",
  invoices: [
    inv({ invoice_number: "INV-1", status: "overdue", due_date: "2026-11-20", total: 1000, balance: 1000 }), // 5 days late
    inv({ invoice_number: "INV-2", status: "overdue", due_date: "2026-08-01", total: 500, balance: 400, customer_name: "Beta", customer_id: "c2" }), // 116 days late
    inv({ invoice_number: "INV-3", status: "sent", due_date: "2026-12-10", total: 300, balance: 300 }), // not due
    inv({ status: "void", total: 99999, balance: 99999 }), // ignored
    inv({ status: "draft", total: 88888, balance: 88888 }), // ignored
    inv({ status: "paid", date: "2026-03-01", total: 2000, balance: 0, last_payment_date: "2026-04-15" }),
    inv({ status: "paid", date: "2026-05-01", total: 2000, balance: 0, last_payment_date: "2026-06-10" }),
    inv({ status: "paid", date: "2025-03-01", total: 1, balance: 0, last_payment_date: "2025-03-21" }),
    inv({ status: "paid", date: "2025-06-01", total: 1, balance: 0, last_payment_date: "2025-06-21" }),
  ],
  payments: [{ date: "2026-10-05", amount: 5000, payment_mode: "check" }, { date: "2026-10-20", amount: 1000, payment_mode: "bank transfer" }, { date: "2026-09-10", amount: 4000, payment_mode: "check" }, { date: "2026-11-03", amount: 700 }],
  vendorPayments: [{ date: "2026-10-07", amount: 2000 }, { date: "2026-09-07", amount: 3000 }, { date: "2026-11-10", amount: 100 }],
  expenses: [{ date: "2026-10-15", total: 500 }],
  banks: [{ account_name: "Op", account_type: "bank", balance: 10_000 }, { account_name: "Card", account_type: "credit_card", balance: -900 }, { account_name: "Old", account_type: "bank", balance: 50, is_active: false }],
  estimates: [{ status: "sent", date: "2026-10-01", total: 1 }, { status: "accepted", date: "2026-10-02", total: 1 }, { status: "invoiced", date: "2026-11-01", total: 1 }, { status: "draft", date: "2026-11-01", total: 1 }, { status: "invoiced", date: "2026-01-01", total: 1 }],
  contacts: [{ contact_id: "c1", customer_sub_type: "business" }, { contact_id: "c2", customer_sub_type: "individual" }],
};

assert.deepEqual(B.lastMonths("2026-11-25", 3), ["2026-08", "2026-09", "2026-10"], "complete months only");
const io = B.flows(data, 3);
assert.deepEqual(io.cashIn, [0, 4000, 6000]);
assert.deepEqual(io.cashOut, [0, 3000, 2500], "vendor payments + expenses");

const bal = B.cashBalance(data, 3);
// today 10,000 (active bank only); Nov so far +700 -100 => end Oct 9,400; end Sep 9,400-3,500 = 5,900; end Aug 5,900-1,000 = 4,900
assert.deepEqual(bal.shape === "trend" && bal.series[0].values.slice(0, 3), [4900, 5900, 9400]);
assert.equal(pickChart(bal), "line");

const aging = B.arAging(data);
assert.deepEqual(aging.shape === "breakdown" && aging.series[0].values, [300, 1000, 0, 0, 400], "void/draft excluded, balances bucketed");

const top = B.topCustomers(data);
assert.deepEqual(top.shape === "breakdown" && top.x, ["Acme", "Beta"]);
assert.deepEqual(top.shape === "breakdown" && top.series[0].values, [5300, 500], "12-month invoiced total, no void/draft");

const speed = B.paySpeedChange(data);
assert.deepEqual(speed.shape === "breakdown" && [speed.x, speed.series[0].values], [["Acme"], [23]], "45/40 days now vs 20 days before -> +22.5 rounds to 23");

const mix = B.revenueByType(data);
assert.deepEqual(mix.shape === "share" && [mix.x, mix.values], [["Business", "Individual"], [5300, 500]]);

const funnel = B.quoteToCash(data);
assert.deepEqual(funnel.shape === "funnel" && funnel.rows.map((r) => r.value), [3, 2, 1], "last 90 days, drafts out");

const late = B.overdueInvoices(data);
assert.deepEqual(late.shape === "table" && late.rows.map((r) => [r.invoice, r.days, r.amount]), [["INV-2", 116, 400], ["INV-1", 5, 1000]]);

assert.throws(() => B.collectionsVsTarget(data), /ZOHO_COLLECTIONS_MONTHLY_TARGET/);
const cvt = B.collectionsVsTarget({ ...data, monthlyCollectionTarget: 5000 });
assert.deepEqual(cvt.shape === "progress" && cvt.rows.map((r) => r.actual), [0, 0, 4000, 6000]);

const src = B.cashInBySource(data, 3);
assert.deepEqual(src.shape === "trend" && src.series.map((s) => s.name), ["Check", "Bank Transfer"]);

const t = B.tiles(data);
assert.equal(t[0].value, 6000, "cash in for Oct");
assert.equal(t[3].value, 400, "A/R over 30 days late");
assert.equal(t[4].value, Math.round((10_000 / ((0 + 3000 + 2500) / 3)) * 10) / 10, "runway = cash / 3-month avg out");

console.log("zoho OK");
