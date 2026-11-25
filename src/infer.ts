// Turn a plain table (what Claude can easily write) into a Panel the picker can draw,
// and check it against our own data when the question matches a catalog metric.

import type { Conflict, Panel, Role, Series, Tile, Unit } from "./spec.js";

export interface Column {
  name: string;
  unit?: Unit;
}
export type Cell = string | number | null;
export type Hint = "trend" | "breakdown" | "share" | "progress" | "funnel" | "table" | "tiles";

export interface Table {
  title: string;
  sub?: string;
  columns: Column[];
  rows: Cell[][];
  hint?: Hint;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-11", "2026-11-30", "Nov 2026", "November 26", "11/2026" -> "2026-11"; otherwise null */
export function toMonth(v: Cell): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+'?(\d{2}|\d{4})$/);
  if (m && MONTHS.includes(m[1])) return `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, "0")}`;
  return null;
}
const isTimeLabel = (v: Cell) => toMonth(v) !== null || (typeof v === "string" && /^(q[1-4]\s*\d{4}|\d{4}\s*q[1-4]|fy\s*\d{2,4}|\d{4}|w(ee)?k\s*\d+)$/i.test(v.trim()));

/** "$1,234", "12%", "1.2k", 42 -> number; anything else -> null */
export function toNumber(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[,$\s]/g, "").replace(/^\((.*)\)$/, "-$1").replace(/−/g, "-");
  const m = s.match(/^(-?\d+(?:\.\d+)?)([km])?%?$/i);
  if (!m) return null;
  return Number(m[1]) * (m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1);
}

function unitOf(c: Column, values: Cell[]): Unit {
  if (c.unit) return c.unit;
  const n = c.name.toLowerCase();
  const sample = values.find((v) => typeof v === "string");
  if (/%|percent|rate|share|margin/.test(n) || (typeof sample === "string" && sample.trim().endsWith("%"))) return "percent";
  if (/\$|usd|revenue|cash|amount|balance|cost|spend|invoice|paid|owed|ar\b|ap\b|sales|profit|income|expense/.test(n) || (typeof sample === "string" && sample.includes("$"))) return "usd";
  if (/days?\b|dso|dpo/.test(n)) return "days";
  return "count";
}

const roleOf = (name: string): Role => {
  const n = name.toLowerCase();
  if (/plan|target|budget|goal|quota/.test(n)) return "plan";
  if (/forecast|projected|predicted|expected|estimate/.test(n)) return "forecast";
  return "actual";
};
const LEVEL = /balance|cash on hand|outstanding|open a\/?[rp]|cumulative|to date|ytd|headcount|backlog|runway/i;
const BUCKET = /^(not due|current|\d+\s*[-–]\s*\d+|\d+\+|over \d+|>\s*\d+)/i;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "table";

export function inferPanel(t: Table): Panel | { tiles: Tile[] } {
  if (!t.columns.length) throw new Error("table has no columns");
  for (const [i, r] of t.rows.entries()) if (r.length !== t.columns.length) throw new Error(`row ${i + 1} has ${r.length} cells for ${t.columns.length} columns`);
  const col = (i: number) => t.rows.map((r) => r[i]);
  const numeric = t.columns.map((_, i) => t.rows.length > 0 && col(i).every((v) => v === null || toNumber(v) !== null) && col(i).some((v) => v !== null));
  const nums = t.columns.map((c, i) => ({ c, i })).filter(({ i }) => numeric[i]);
  const texts = t.columns.map((c, i) => ({ c, i })).filter(({ i }) => !numeric[i]);
  const base = { id: slug(t.title), title: t.title, sub: t.sub };
  const asTable = (): Panel => ({
    ...base, shape: "table", unit: "count",
    columns: t.columns.map((c, i) => ({ key: `c${i}`, label: c.name, unit: numeric[i] ? unitOf(c, col(i)) : undefined })),
    rows: t.rows.map((r) => Object.fromEntries(r.map((v, i) => [`c${i}`, numeric[i] ? toNumber(v) : v]))),
  });

  if (t.hint === "table" || nums.length === 0 || t.rows.length === 0) return asTable();

  // a single row of numbers is a set of headline figures
  if (t.hint === "tiles" || (t.rows.length === 1 && texts.length === 0)) {
    return { tiles: nums.map(({ c, i }) => ({ label: c.name, value: toNumber(t.rows[0][i]) ?? 0, unit: unitOf(c, col(i)) })) };
  }

  const label = texts[0];
  // plan / forecast columns ("Budget", "Target") take the unit of the actual column they sit next to
  const actualUnit = nums.filter(({ c }) => roleOf(c.name) === "actual").map(({ c, i }) => unitOf(c, col(i)))[0];
  const unitAt = ({ c, i }: { c: Column; i: number }) => (!c.unit && roleOf(c.name) !== "actual" && actualUnit ? actualUnit : unitOf(c, col(i)));
  const units = new Set(nums.map(unitAt));
  const unit = [...units][0];
  if (!label) return asTable();
  const x = col(label.i).map((v) => String(v ?? "Not recorded"));
  const series = (keep: typeof nums): Series[] => keep.map(({ c, i }) => ({ name: c.name, role: roleOf(c.name), values: col(i).map(toNumber) }));

  // actual vs target per row
  const target = nums.find(({ c }) => roleOf(c.name) === "plan");
  const actual = nums.find(({ c }) => roleOf(c.name) === "actual");
  const time = x.every(isTimeLabel);
  if ((t.hint === "progress" || (!time && target && actual)) && target && actual) {
    const proj = nums.find(({ c }) => roleOf(c.name) === "forecast");
    return { ...base, shape: "progress", unit: unitAt(actual), rows: t.rows.map((r) => ({ label: String(r[label.i]), actual: toNumber(r[actual.i]) ?? 0, target: toNumber(r[target.i]) ?? 0, projected: proj ? toNumber(r[proj.i]) ?? undefined : undefined })) };
  }

  // one axis only: mixed units can't share a chart, so they read better as a table
  if (units.size > 1) return asTable();

  if (t.hint === "funnel") return { ...base, shape: "funnel", unit, rows: t.rows.map((r) => ({ label: String(r[label.i]), value: toNumber(r[nums[0].i]) ?? 0 })) };

  if (t.hint === "trend" || (t.hint === undefined && time)) {
    const xs = x.map((v) => toMonth(v) ?? v);
    const level = nums.some(({ c }) => LEVEL.test(c.name)) || LEVEL.test(t.title);
    return { ...base, shape: "trend", measure: level ? "level" : "flow", unit, x: xs, series: series(nums) };
  }

  const vals = col(nums[0].i).map(toNumber);
  const sum = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
  const looksShare = /share|split|mix|breakdown|by type|composition/i.test(t.title) || (unit === "percent" && Math.abs(sum - 100) <= 1.5);
  if (nums.length === 1 && (t.hint === "share" || looksShare) && vals.every((v) => v !== null && v >= 0)) {
    return { ...base, shape: "share", unit, x, values: vals as number[] };
  }

  return { ...base, shape: "breakdown", unit, x, series: series(nums).map((s) => ({ ...s, role: undefined })), ordered: x.every((l) => BUCKET.test(l.trim())) };
}

// ---------- conflict check ----------

const key = (s: string) => toMonth(s) ?? s.toLowerCase().replace(/&/g, "and").replace(/\b(inc|llc|ltd|co|corp)\b\.?/g, "").replace(/[^a-z0-9]+/g, "");

/** label -> value from our panel's main series */
export function valuesOf(p: Panel): Map<string, number> {
  const m = new Map<string, number>();
  if (p.shape === "trend" || p.shape === "breakdown") {
    const s = p.series.find((x) => (x.role ?? "actual") === "actual") ?? p.series[0];
    p.x.forEach((x, i) => s.values[i] !== null && m.set(key(x), s.values[i] as number));
  } else if (p.shape === "share") p.x.forEach((x, i) => m.set(key(x), p.values[i]));
  else if (p.shape === "progress") p.rows.forEach((r) => m.set(key(r.label), r.actual));
  else if (p.shape === "funnel") p.rows.forEach((r) => m.set(key(r.label), r.value));
  return m;
}

/** Compare Claude's table (first text column -> first number column) with ours. Tolerance: 1% or 1 unit. */
export function compare(t: Table, ours: Panel): { conflicts: Conflict[]; matched: number; unmatched: string[] } {
  const theirs = valuesOf(ours);
  const li = t.rows[0]?.findIndex((v) => toNumber(v) === null) ?? -1;
  const ni = t.rows[0]?.findIndex((v, i) => i !== li && toNumber(v) !== null) ?? -1;
  const out = { conflicts: [] as Conflict[], matched: 0, unmatched: [] as string[] };
  if (li < 0 || ni < 0) return out;
  for (const r of t.rows) {
    const label = String(r[li]);
    const claude = toNumber(r[ni]);
    const mine = theirs.get(key(label));
    if (claude === null) continue;
    if (mine === undefined) { out.unmatched.push(label); continue; }
    out.matched++;
    if (Math.abs(claude - mine) > Math.max(1, Math.abs(mine) * 0.01)) out.conflicts.push({ label, claude, ours: mine });
  }
  return out;
}
