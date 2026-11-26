// Where numbers come from: live Zoho Books when .env has credentials, sample data otherwise.
// A Zoho failure is an error, never a silent fall back to sample numbers.

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Panel, Source, Tile, ViewSpec } from "./spec.js";
import { METRICS, dashboardTiles, type MetricId } from "./metrics.js";
import { configFromEnv, missingSettings, ZohoBooks } from "./zoho/client.js";
import * as B from "./zoho/books.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  /* no .env: sample mode */
}

const cfg = process.env.CASHFLOW_DATA === "sample" ? null : configFromEnv(); // CASHFLOW_DATA=sample forces sample data
const zoho = cfg ? new ZohoBooks(cfg) : null;
export const source: Source = zoho ? "zoho_books" : "sample";
const today = () => new Date().toISOString().slice(0, 10);
export const asOf = () => (zoho ? today() : "2026-11");

type Need = "invoices" | "payments" | "vendorPayments" | "expenses" | "banks" | "estimates" | "contacts";
const NEEDS: Record<MetricId, Need[]> = {
  cash_balance: ["payments", "vendorPayments", "expenses", "banks"],
  cash_in_out: ["payments", "vendorPayments", "expenses"],
  cash_in_by_source: ["payments"],
  ar_aging: ["invoices"],
  top_customers: ["invoices"],
  pay_speed_change: ["invoices"],
  revenue_by_type: ["invoices", "contacts"],
  collections_vs_target: ["payments"],
  quote_to_cash: ["estimates"],
  overdue_invoices: ["invoices"],
};
const BUILD: Record<MetricId, (b: B.BooksData, n: number) => Panel> = {
  cash_balance: B.cashBalance,
  cash_in_out: B.cashInOut,
  cash_in_by_source: B.cashInBySource,
  ar_aging: (b) => B.arAging(b),
  top_customers: (b) => B.topCustomers(b),
  pay_speed_change: (b) => B.paySpeedChange(b),
  revenue_by_type: (b) => B.revenueByType(b),
  collections_vs_target: (b) => B.collectionsVsTarget(b),
  quote_to_cash: (b) => B.quoteToCash(b),
  overdue_invoices: (b) => B.overdueInvoices(b),
};

const monthsAgo = (n: number) => {
  const t = new Date();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
};

/** fetch only what the metrics need; the client caches each call for 10 minutes */
async function load(needs: Set<Need>, months: number): Promise<B.BooksData> {
  const z = zoho!;
  const from = monthsAgo(Math.max(months, 12) + 1);
  const get = async <T>(n: Need, f: () => Promise<T[]>): Promise<T[]> => (needs.has(n) ? f() : []);
  const invoices = get("invoices", async () => {
    // 24 months for pay-speed comparison, plus every still-open invoice however old
    const recent = await z.listSince<B.Invoice>("invoices", "invoices", monthsAgo(25));
    const open = (await Promise.all(["unpaid", "overdue", "partially_paid"].map((s) => z.list<B.Invoice>("invoices", "invoices", { status: s })))).flat();
    return [...new Map([...recent, ...open].map((i) => [i.invoice_id, i])).values()];
  });
  const [inv, payments, vendorPayments, expenses, banks, estimates, contacts] = await Promise.all([
    invoices,
    get("payments", () => z.listSince<B.CustomerPayment>("customerpayments", "customerpayments", from)),
    get("vendorPayments", () => z.listSince<B.VendorPayment>("vendorpayments", "vendorpayments", from)),
    get("expenses", () => z.listSince<B.Expense>("expenses", "expenses", from)),
    get("banks", () => z.list<B.BankAccount>("bankaccounts", "bankaccounts")),
    get("estimates", () => z.listSince<B.Estimate>("estimates", "estimates", monthsAgo(4))),
    get("contacts", () => z.list<B.Contact>("contacts", "contacts", { contact_type: "customer" })),
  ]);
  const target = Number(process.env.ZOHO_COLLECTIONS_MONTHLY_TARGET);
  return { today: today(), invoices: inv, payments, vendorPayments, expenses, banks, estimates, contacts, monthlyCollectionTarget: Number.isFinite(target) && target > 0 ? target : undefined };
}

export async function getPanel(id: MetricId, months = 12): Promise<Panel> {
  if (!zoho) return METRICS[id](months);
  return BUILD[id](await load(new Set(NEEDS[id]), months), months);
}

export async function getTiles(): Promise<Tile[]> {
  if (!zoho) return dashboardTiles();
  return B.tiles(await load(new Set(["payments", "vendorPayments", "expenses", "banks", "invoices"]), 12));
}

export async function getDashboard(months = 12): Promise<ViewSpec> {
  const [tiles, balance, inout] = await Promise.all([getTiles(), getPanel("cash_balance", months), getPanel("cash_in_out", months)]);
  return { title: "Cash dashboard", asOf: asOf(), source, tiles, panels: [balance, inout] };
}

export async function getMetric(id: MetricId, months = 12): Promise<ViewSpec> {
  return { title: "", asOf: asOf(), source, panels: [await getPanel(id, months)] };
}

/** for the check script: one cheap call that proves login, scopes and org id */
export async function zohoStatus(): Promise<string> {
  if (!zoho) return `Zoho: not configured, using sample data. Missing in .env: ${missingSettings().join(", ")}.`;
  const j = await zoho.get("bankaccounts");
  const n = ((j.bankaccounts as unknown[]) ?? []).length;
  return `Zoho Books: connected (data centre ${cfg!.dc}), ${n} bank/cash account${n === 1 ? "" : "s"} visible.`;
}
