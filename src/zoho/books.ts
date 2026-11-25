// Zoho Books records -> panels. Pure functions over raw records so they are tested without Zoho.
// Months are whole calendar months ending with the last complete month (a half month would read as a drop).

import type { Panel, Tile } from "../spec.js";

export interface Invoice {
  invoice_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name: string;
  status: string; // draft | sent | viewed | overdue | partially_paid | paid | void | unpaid
  date: string; // YYYY-MM-DD
  due_date: string;
  total: number;
  balance: number;
  last_payment_date?: string;
}
export interface CustomerPayment {
  date: string;
  amount: number;
  customer_name?: string;
  payment_mode?: string;
}
export interface VendorPayment {
  date: string;
  amount: number;
}
export interface Expense {
  date: string;
  total: number;
}
export interface BankAccount {
  account_name: string;
  account_type: string; // bank | cash | credit_card | ...
  balance: number;
  is_active?: boolean;
}
export interface Estimate {
  status: string; // draft | sent | accepted | invoiced | declined | expired
  date: string;
  total: number;
}
export interface Contact {
  contact_id: string;
  customer_sub_type?: string; // business | individual
}

export interface BooksData {
  today: string; // YYYY-MM-DD
  invoices: Invoice[];
  payments: CustomerPayment[];
  vendorPayments: VendorPayment[];
  expenses: Expense[];
  banks: BankAccount[];
  estimates: Estimate[];
  contacts: Contact[];
  /** optional, from ZOHO_COLLECTIONS_MONTHLY_TARGET: Zoho Books has no targets */
  monthlyCollectionTarget?: number;
}

// ---------- dates ----------
const DAY = 86_400_000;
const d = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
const ym = (s: string) => s.slice(0, 7);
/** the n complete months before today's month, oldest first */
export function lastMonths(today: string, n: number): string[] {
  const t = new Date(d(today));
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n + i, 1)).toISOString().slice(0, 7));
}
const addMonths = (m: string, k: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7);
};
const daysBetween = (a: string, b: string) => Math.round((d(b) - d(a)) / DAY);
const k = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`);

const LIVE = new Set(["sent", "viewed", "overdue", "partially_paid", "paid", "unpaid"]); // excludes draft and void
const OPEN = (i: Invoice) => i.balance > 0 && i.status !== "void" && i.status !== "draft";

function byMonth<T>(rows: T[], months: string[], date: (r: T) => string, value: (r: T) => number): number[] {
  const idx = new Map(months.map((m, i) => [m, i]));
  const out = months.map(() => 0);
  for (const r of rows) {
    const i = idx.get(ym(date(r)));
    if (i !== undefined) out[i] += value(r);
  }
  return out.map(Math.round);
}

export function flows(b: BooksData, n: number) {
  const months = lastMonths(b.today, n);
  const cashIn = byMonth(b.payments, months, (p) => p.date, (p) => p.amount);
  const vp = byMonth(b.vendorPayments, months, (p) => p.date, (p) => p.amount);
  const ex = byMonth(b.expenses, months, (e) => e.date, (e) => e.total);
  const cashOut = vp.map((v, i) => v + ex[i]);
  return { months, cashIn, cashOut, net: cashIn.map((v, i) => v - cashOut[i]) };
}

const cashOnHand = (b: BooksData) => Math.round(b.banks.filter((a) => a.is_active !== false && (a.account_type === "bank" || a.account_type === "cash")).reduce((s, a) => s + a.balance, 0));

// ---------- panels ----------

export function cashBalance(b: BooksData, n: number): Panel {
  const { months, net } = flows(b, n);
  // walk back from today's bank balance: end of month m = now - net of every later month (incl. this partial month)
  const thisMonth = ym(b.today);
  const mtd = b.payments.filter((p) => ym(p.date) === thisMonth).reduce((s, p) => s + p.amount, 0)
    - b.vendorPayments.filter((p) => ym(p.date) === thisMonth).reduce((s, p) => s + p.amount, 0)
    - b.expenses.filter((e) => ym(e.date) === thisMonth).reduce((s, e) => s + e.total, 0);
  const end: number[] = [];
  let bal = cashOnHand(b) - mtd;
  for (let i = n - 1; i >= 0; i--) {
    end[i] = Math.round(bal);
    bal -= net[i];
  }
  // forecast: average net of the last 3 months, band widens with the spread of monthly net
  const recent = net.slice(-3);
  const avg = recent.reduce((a, v) => a + v, 0) / recent.length;
  const mean = net.reduce((a, v) => a + v, 0) / net.length;
  const sd = Math.sqrt(net.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, net.length - 1));
  const last = end[n - 1];
  const fx = [1, 2, 3].map((i) => addMonths(months[n - 1], i));
  const fc = [1, 2, 3].map((i) => Math.round(last + avg * i));
  const pad = (a: (number | null)[], before: number, after: number) => [...Array(before).fill(null), ...a, ...Array(after).fill(null)];
  return {
    id: "cash_balance", shape: "trend", measure: "level", unit: "usd", kind: "prediction",
    title: "Cash balance", sub: "Bank and cash accounts at month end, then 3 months at the recent pace",
    x: [...months, ...fx],
    series: [
      { name: "Actual", values: pad(end, 0, 3) },
      { name: "Forecast", role: "forecast", values: pad([last, ...fc], n - 1, 0) },
      { name: "Low", role: "low", values: pad([last, ...fc.map((v, i) => Math.round(v - sd * Math.sqrt(i + 1)))], n - 1, 0) },
      { name: "High", role: "high", values: pad([last, ...fc.map((v, i) => Math.round(v + sd * Math.sqrt(i + 1)))], n - 1, 0) },
    ],
    insight: `At the last 3 months' pace (**${avg >= 0 ? "+" : ""}${k(avg)}/month**) cash reaches about **${k(fc[2])}** by ${fx[2]}.`,
  };
}

export function cashInOut(b: BooksData, n: number): Panel {
  const { months, cashIn, cashOut, net } = flows(b, n);
  const neg = net.filter((v) => v < 0).length;
  return {
    id: "cash_in_out", shape: "trend", measure: "flow", unit: "usd", inOut: true,
    title: "Cash in and out by month", sub: "Customer payments up; vendor payments and expenses down. The line is the net.",
    x: months, series: [{ name: "Cash in", values: cashIn }, { name: "Cash out", values: cashOut }],
    insight: neg ? `Net was negative in **${neg} of ${n}** months.` : "Net was positive every month.",
  };
}

export function cashInBySource(b: BooksData, n: number): Panel {
  const months = lastMonths(b.today, n);
  const mode = (p: CustomerPayment) => (p.payment_mode?.trim() || "Not recorded").replace(/\b\w/g, (c) => c.toUpperCase());
  const modes = [...new Set(b.payments.filter((p) => months.includes(ym(p.date))).map(mode))];
  return {
    id: "cash_in_by_source", shape: "trend", measure: "flow", unit: "usd", parts: true,
    title: "Cash in by payment method", sub: "Customer payments per month, split by how they paid",
    x: months, series: modes.map((m) => ({ name: m, values: byMonth(b.payments.filter((p) => mode(p) === m), months, (p) => p.date, (p) => p.amount) })),
  };
}

const BUCKETS = ["Not due", "1–30", "31–60", "61–90", "90+"];
const bucket = (late: number) => (late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4);

export function arAging(b: BooksData): Panel {
  const sums = [0, 0, 0, 0, 0];
  for (const i of b.invoices.filter(OPEN)) sums[bucket(daysBetween(i.due_date, b.today))] += i.balance;
  const late30 = sums[2] + sums[3] + sums[4];
  return {
    id: "ar_aging", shape: "breakdown", ordered: true, unit: "usd", goodWhen: "lower",
    title: "Receivables by age", sub: "Open invoice balances by days past due",
    x: BUCKETS, series: [{ name: "Open A/R", values: sums.map(Math.round) }],
    insight: `**${k(late30)}** is more than 30 days late; **${k(sums[4])}** of it is past 90 days.`,
  };
}

export function topCustomers(b: BooksData): Panel {
  const from = lastMonths(b.today, 12)[0];
  const tot = new Map<string, number>();
  for (const i of b.invoices) if (LIVE.has(i.status) && ym(i.date) >= from) tot.set(i.customer_name, (tot.get(i.customer_name) ?? 0) + i.total);
  const rows = [...tot].sort((a, b2) => b2[1] - a[1]);
  return { id: "top_customers", shape: "breakdown", unit: "usd", title: "Revenue by customer", sub: "Invoiced in the last 12 months, largest first", x: rows.map((r) => r[0]), series: [{ name: "Revenue", values: rows.map((r) => Math.round(r[1])) }] };
}

export function paySpeedChange(b: BooksData): Panel {
  const cut = d(b.today) - 365 * DAY;
  const per = new Map<string, { now: number[]; before: number[] }>();
  for (const i of b.invoices) {
    if (i.status !== "paid" || !i.last_payment_date) continue;
    const days = daysBetween(i.date, i.last_payment_date);
    const e = per.get(i.customer_name) ?? { now: [], before: [] };
    (d(i.last_payment_date) >= cut ? e.now : e.before).push(days);
    per.set(i.customer_name, e);
  }
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const rows = [...per]
    .filter(([, e]) => e.now.length >= 2 && e.before.length >= 2) // need a few invoices each year to compare
    .map(([name, e]) => [name, Math.round(avg(e.now) - avg(e.before)), e.now.length] as const)
    .sort((a, b2) => b2[2] - a[2])
    .slice(0, 10);
  return {
    id: "pay_speed_change", shape: "breakdown", unit: "days", goodWhen: "lower",
    title: "Change in days to pay", sub: "Last 12 months vs the year before; negative = paying faster",
    x: rows.map((r) => r[0]), series: [{ name: "Change (days)", values: rows.map((r) => r[1]) }],
  };
}

export function revenueByType(b: BooksData): Panel {
  const from = lastMonths(b.today, 12)[0];
  const type = new Map(b.contacts.map((c) => [c.contact_id, c.customer_sub_type === "individual" ? "Individual" : c.customer_sub_type === "business" ? "Business" : "Not recorded"]));
  const tot = new Map<string, number>();
  for (const i of b.invoices) if (LIVE.has(i.status) && ym(i.date) >= from) {
    const t = type.get(i.customer_id) ?? "Not recorded";
    tot.set(t, (tot.get(t) ?? 0) + i.total);
  }
  return { id: "revenue_by_type", shape: "share", unit: "usd", title: "Revenue by customer type", sub: "Invoiced in the last 12 months", x: [...tot.keys()], values: [...tot.values()].map(Math.round) };
}

export function collectionsVsTarget(b: BooksData): Panel {
  const months = lastMonths(b.today, 4);
  const got = byMonth(b.payments, months, (p) => p.date, (p) => p.amount);
  const target = b.monthlyCollectionTarget;
  if (!target) throw new Error("No collections target: set ZOHO_COLLECTIONS_MONTHLY_TARGET in .env (Zoho Books has no targets).");
  return {
    id: "collections_vs_target", shape: "progress", unit: "usd",
    title: "Collections against target", sub: `Customer payments per month vs ${k(target)} target`,
    rows: months.map((m, i) => ({ label: m, actual: got[i], target })),
  };
}

export function quoteToCash(b: BooksData): Panel {
  const cut = d(b.today) - 90 * DAY;
  const est = b.estimates.filter((e) => d(e.date) >= cut && e.status !== "draft");
  const accepted = est.filter((e) => e.status === "accepted" || e.status === "invoiced");
  const invoiced = est.filter((e) => e.status === "invoiced");
  return {
    id: "quote_to_cash", shape: "funnel", unit: "count", title: "Quote to invoice", sub: "Estimates sent in the last 90 days",
    rows: [{ label: "Estimates sent", value: est.length }, { label: "Accepted", value: accepted.length }, { label: "Invoiced", value: invoiced.length }],
  };
}

export function overdueInvoices(b: BooksData): Panel {
  const rows = b.invoices
    .filter((i) => OPEN(i) && daysBetween(i.due_date, b.today) > 0)
    .map((i) => ({ customer: i.customer_name, invoice: i.invoice_number, days: daysBetween(i.due_date, b.today), amount: Math.round(i.balance) }))
    .sort((a, b2) => b2.days - a.days)
    .slice(0, 15);
  return {
    id: "overdue_invoices", shape: "table", unit: "usd", title: "Most overdue invoices",
    columns: [{ key: "customer", label: "Customer" }, { key: "invoice", label: "Invoice" }, { key: "days", label: "Days late", unit: "days" }, { key: "amount", label: "Balance", unit: "usd" }],
    rows,
  };
}

export function tiles(b: BooksData): Tile[] {
  const { months, cashIn, cashOut, net } = flows(b, 12);
  const L = 11;
  const pct = (a: number, p: number) => (p === 0 ? null : Math.round(((a - p) / Math.abs(p)) * 1000) / 10);
  const open = b.invoices.filter(OPEN).filter((i) => daysBetween(i.due_date, b.today) > 30);
  const burn = cashOut.slice(-3).reduce((s, v) => s + v, 0) / 3;
  const label = new Date(`${months[L]}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return [
    { label: "Cash in", value: cashIn[L], unit: "usd", deltaPct: pct(cashIn[L], cashIn[L - 1]), goodWhen: "higher", note: label, spark: cashIn },
    { label: "Cash out", value: cashOut[L], unit: "usd", deltaPct: pct(cashOut[L], cashOut[L - 1]), goodWhen: "lower", note: label, spark: cashOut },
    { label: "Net cash flow", value: net[L], unit: "usd", deltaPct: pct(net[L], net[L - 1]), goodWhen: "higher", note: label, spark: net },
    { label: "A/R overdue", value: Math.round(open.reduce((s, i) => s + i.balance, 0)), unit: "usd", note: `${open.length} invoices over 30 days` },
    { label: "Runway", value: burn > 0 ? Math.round((cashOnHand(b) / burn) * 10) / 10 : 0, unit: "months", note: "cash ÷ 3-month avg outflow", kind: "prediction" },
  ];
}
