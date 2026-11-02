import { daysBetween, shiftIso } from './parse';
import { ABSENT_MONTH_FLAG, ABSENT_WEEK_FLAG, CANX_MONTH_FLAG } from './targets';
import type {
  AnyRow,
  CanxRow,
  CashRow,
  CompanyMonthlyPerf,
  CompanyPerfRow,
  OnTimeCleanerDay,
  OnTimeMonthly,
  OnTimeVanDay,
  ReminderStats,
} from './types';

/**
 * 'financeComments' is a peer of the other four, but is content-filtered
 * (which finance comments still need a reply) rather than date-filtered, and
 * is rendered by an entirely different table. applyFilter() below never
 * handles it — CashSection reads data.cash directly for that tab via
 * financeCommentsRows().
 */
export type FilterKey = 'yesterday' | 'pending' | 'updated' | 'mtd' | 'financeComments';

/**
 * A cash row is answered once a collection status exists. A cancellation row is
 * answered once a reason exists. These two predicates are the single definition
 * of "pending" — the tables, the KPI cards and the reminder email all use them,
 * so the email can never claim a different number than the screen.
 */
export function isCashAnswered(row: CashRow): boolean {
  return row.status !== '';
}

export function isCanxAnswered(row: CanxRow): boolean {
  return row.reason.trim() !== '';
}

export function isAnswered(row: AnyRow): boolean {
  return row.section === 'CASH' ? isCashAnswered(row) : isCanxAnswered(row);
}

export interface FilterResult<T> {
  rows: T[];
  /** Set when "Yesterday" had no rows and we fell back to the latest day present. */
  fallbackFrom?: string;
  fallbackTo?: string;
  /** The day actually shown, for the Yesterday filter. */
  shownDate?: string;
}

export function applyFilter<T extends AnyRow>(
  all: T[],
  filter: FilterKey,
  today: string,
  yesterday: string,
): FilterResult<T> {
  // Handled entirely outside this function — see the FilterKey comment above.
  if (filter === 'financeComments') return { rows: [] };

  if (filter === 'pending') {
    const rows = all.filter((r) => !isAnswered(r));
    rows.sort((a, b) => a.date.localeCompare(b.date) || rowLabel(a).localeCompare(rowLabel(b)));
    return { rows };
  }

  if (filter === 'updated') {
    // Scoped to the current month only. A row that's already answered isn't
    // "pending" anywhere else, so once its month ends it would otherwise sit
    // in this tab forever — the only place it should still be found is that
    // month's own row in the Month to date archive (see cashMonthSummaries /
    // canxMonthSummaries), which already holds every row for that month,
    // answered or not.
    const month = today.slice(0, 7);
    const rows = all.filter((r) => isAnswered(r) && r.date.startsWith(month));
    rows.sort((a, b) => b.date.localeCompare(a.date) || rowLabel(a).localeCompare(rowLabel(b)));
    return { rows };
  }

  if (filter === 'mtd') {
    const month = today.slice(0, 7);
    const rows = all.filter((r) => r.date.startsWith(month));
    rows.sort((a, b) => b.date.localeCompare(a.date) || rowLabel(a).localeCompare(rowLabel(b)));
    return { rows };
  }

  // Yesterday: only what still needs a reply for that day. An answered row
  // is done — it belongs in "Updated" now, not lingering here just because
  // its date still says yesterday. The fallback (when yesterday has no rows
  // at all yet, e.g. the daily export hasn't landed) still keys off every
  // row for that day, not just unanswered ones, so a day that legitimately
  // has no data at all is distinguished from a day that's simply finished.
  const hasYesterdayData = all.some((r) => r.date === yesterday);

  if (hasYesterdayData) {
    const rows = sortByLabel(all.filter((r) => r.date === yesterday && !isAnswered(r)));
    return { rows, shownDate: yesterday };
  }

  const latest = latestDate(all);
  if (!latest) return { rows: [], shownDate: yesterday };

  return {
    rows: sortByLabel(all.filter((r) => r.date === latest && !isAnswered(r))),
    fallbackFrom: yesterday,
    fallbackTo: latest,
    shownDate: latest,
  };
}

function sortByLabel<T extends AnyRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => rowLabel(a).localeCompare(rowLabel(b)));
}

function rowLabel(row: AnyRow): string {
  return row.section === 'CASH' ? row.ref : `${row.code} ${row.cleaner}`;
}

export function latestDate(rows: AnyRow[]): string {
  let latest = '';
  for (const r of rows) {
    if (r.date && r.date > latest) latest = r.date;
  }
  return latest;
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export interface CashKpis {
  total: number;
  collected: number;
  notCollected: number;
  pendingCount: number;
  collectedCount: number;
  notCollectedCount: number;
  noTicketCount: number;
  answeredCount: number;
  totalCount: number;
}

export function cashKpis(rows: CashRow[]): CashKpis {
  let total = 0;
  let collected = 0;
  let notCollected = 0;
  let pendingCount = 0;
  let collectedCount = 0;
  let notCollectedCount = 0;
  let noTicketCount = 0;

  for (const r of rows) {
    total += r.amount;
    if (r.status === 'Collected') {
      collected += r.amount;
      collectedCount += 1;
    } else if (r.status === 'Not collected') {
      notCollected += r.amount;
      notCollectedCount += 1;
      if (r.ticket !== 'Yes') noTicketCount += 1;
    } else {
      pendingCount += 1;
    }
  }

  return {
    total,
    collected,
    notCollected,
    pendingCount,
    collectedCount,
    notCollectedCount,
    noTicketCount,
    answeredCount: collectedCount + notCollectedCount,
    totalCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Finance comments
// ---------------------------------------------------------------------------

/**
 * Whether a cash row still needs the Perfect Choice team's reply on the
 * "Finance comments" tab. Finance closes a row out by writing exactly "ok",
 * or a note containing the whole word "paid" (e.g. "PAID by card, dashboard
 * updated") once they've confirmed payment another way — those two are the
 * only things that drop a row off the list; everything else, including a
 * blank comment, still needs a response.
 */
export function needsFinanceResponse(row: CashRow): boolean {
  const comment = row.financeComment.trim();
  if (!comment) return true;
  if (comment.toLowerCase() === 'ok') return false;
  if (/\bpaid\b/i.test(comment)) return false;
  return true;
}

/** Newest first, so the most recent finance activity surfaces at the top. */
export function financeCommentsRows(cash: CashRow[]): CashRow[] {
  return cash
    .filter(needsFinanceResponse)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || a.ref.localeCompare(b.ref));
}

export interface CanxKpis {
  total: number;
  pct: number;
  awaiting: number;
  provided: number;
}

export function canxKpis(rows: CanxRow[]): CanxKpis {
  const total = rows.reduce((s, r) => s + (r.count || 1), 0);
  const weighted = rows.reduce((s, r) => s + r.pct * (r.count || 1), 0);
  const awaiting = rows.filter((r) => !isCanxAnswered(r)).length;

  return {
    total,
    pct: total ? weighted / total : 0,
    awaiting,
    provided: rows.length - awaiting,
  };
}

// ---------------------------------------------------------------------------
// Monthly archive — the "Month to date" tab's summary-by-month view.
//
// Nothing here needs its own storage: every month's data already lives
// permanently in the sheet (rows are never deleted), so a summary row is
// just that month's rows grouped and totalled. The month rolling over is
// not an event this app has to react to — the grouping key is simply
// whatever month a row's own date falls in.
// ---------------------------------------------------------------------------

/** "2026-08" -> "August 2026". Timezone-free: only ever fed a yyyy-MM key. */
export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface CashMonthSummary {
  key: string;
  label: string;
  total: number;
  collected: number;
  notCollected: number;
  entryCount: number;
}

/** One row per calendar month present in the data, newest first. */
export function cashMonthSummaries(cash: CashRow[]): CashMonthSummary[] {
  const map = new Map<string, CashMonthSummary>();

  for (const r of cash) {
    if (!r.date) continue;
    const key = r.date.slice(0, 7);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: formatMonthLabel(key),
        total: 0,
        collected: 0,
        notCollected: 0,
        entryCount: 0,
      });
    }
    const m = map.get(key)!;
    m.total += r.amount;
    m.entryCount += 1;
    if (r.status === 'Collected') m.collected += r.amount;
    else if (r.status === 'Not collected') m.notCollected += r.amount;
  }

  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

export interface CanxMonthSummary {
  key: string;
  label: string;
  /** Sum of each row's count — matches the "Cancellations & releases" KPI. */
  totalCancellations: number;
  /** The team's own hand-entered rate for this month; null if not recorded. */
  pct: number | null;
}

/** One row per calendar month present in the data, newest first. */
export function canxMonthSummaries(
  canx: CanxRow[],
  monthlyPct: Record<string, number>,
): CanxMonthSummary[] {
  const map = new Map<string, CanxMonthSummary>();

  for (const r of canx) {
    if (!r.date) continue;
    const key = r.date.slice(0, 7);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: formatMonthLabel(key),
        totalCancellations: 0,
        pct: monthlyPct[key] ?? null,
      });
    }
    map.get(key)!.totalCancellations += r.count || 1;
  }

  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

// ---------------------------------------------------------------------------
// Company performance
//
// Three data sources:
//  - companyPerf: one row per (cleaner, date) roster entry — read straight
//    off "Company Performance" columns A-F. Every cleaner scheduled that
//    day gets a row; `count` is that row's own Absent BD value: 0 (present),
//    0.5 (half-day absent) or 1 (full-day absent) — NOT a flag meaning "this
//    row is an absence". Summed, never counted as a row (most rows are 0s).
//  - companyMonthly: the sheet's own per-month-per-company MTD summary
//    (columns K-Q) — the source of truth for the company KPI boxes. Never
//    recomputed here, just looked up.
//  - canx: Cancellations rows, each already carrying a `company` field
//    resolved in lib/sheets.ts (van/cleaner name -> company).
// ---------------------------------------------------------------------------

const monthOf = (iso: string): string => iso.slice(0, 7);

/** First and last day of a yyyy-MM month, as an inclusive yyyy-MM-dd range. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this one
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** Companies found in the data, most-represented first. */
export function distinctCompanies(perf: CompanyPerfRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of perf) {
    if (!r.company) continue;
    counts.set(r.company, (counts.get(r.company) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([company]) => company);
}

/** Every yyyy-MM present in any source, newest first — feeds the month dropdown. */
export function companyMonthOptions(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  monthly: CompanyMonthlyPerf[],
): string[] {
  const months = new Set<string>();
  for (const r of perf) if (r.date) months.add(monthOf(r.date));
  for (const r of canx) if (r.date) months.add(monthOf(r.date));
  for (const m of monthly) months.add(m.month);
  return [...months].sort((a, b) => b.localeCompare(a));
}

export interface CompanyKpis {
  absentCount: number | null;
  absentPct: number | null;
  cancellationCount: number | null;
  cancellationPct: number | null;
  avgRating: number | null;
}

/** A straight lookup into the sheet's own MTD table — see the section header above. */
export function companyKpis(
  monthly: CompanyMonthlyPerf[],
  company: string,
  month: string,
): CompanyKpis {
  const row = monthly.find((m) => m.company === company && m.month === month);
  if (!row) {
    return {
      absentCount: null,
      absentPct: null,
      cancellationCount: null,
      cancellationPct: null,
      avgRating: null,
    };
  }
  return {
    absentCount: row.absentCount,
    absentPct: row.absentPct,
    cancellationCount: row.cancellationCount,
    cancellationPct: row.cancellationPct,
    avgRating: row.avgRating,
  };
}

// ---------------------------------------------------------------------------
// On time % — all four blocks of the "On Time %" tab, read-only.
//
// Two rules decide where every figure below comes from:
//  - A LATE COUNT is always "Not On Time #" summed from a daily block. The
//    cleaner block only lists cleaner x van x day rows below 100%, but a day
//    that's missing is a 100% day with nothing late, so the sum is exact.
//  - An ON TIME % always needs a denominator that is known to be complete.
//    For a van that's the daily block (it carries every van with exclusive
//    bookings, every day), so any date range works. For a cleaner it is only
//    the MTD block, which covers the previous and current month —
//    deliberately NOT the daily cleaner block, whose missing 100% days would
//    make a cleaner look far worse than she is. Outside those months a
//    cleaner's On Time % is unknown and renders as "—", never as a number.
// ---------------------------------------------------------------------------

/** Below this, an On Time % is flagged in the tables. */
export const ON_TIME_WARN_PCT = 85;

/** The three "On Time %" blocks, passed around together. */
export interface OnTimeData {
  vanDaily: OnTimeVanDay[];
  cleanerDaily: OnTimeCleanerDay[];
  monthly: OnTimeMonthly[];
}

/** Stand-in for when the tab is absent, so callers can skip the argument. */
export const NO_ONTIME: OnTimeData = { vanDaily: [], cleanerDaily: [], monthly: [] };

export interface OnTimeSummary {
  onTime: number;
  exclusiveBookings: number;
  pct: number;
}

/**
 * A company's On Time % for a month, summed from the Daily - Van block —
 * complete and append-only, so it covers the whole month without needing the
 * MTD table (whose TOTAL rows should agree with it, and do).
 *
 * Returns null when the company had no exclusive bookings that month at all,
 * which is the normal state for "Excl Perfect Choice": on time is only
 * measured for exclusive bookings, so the honest answer there is "not
 * tracked" and never 0%.
 */
export function companyOnTime(
  vanDaily: OnTimeVanDay[],
  company: string,
  month: string,
): OnTimeSummary | null {
  let onTime = 0;
  let exclusiveBookings = 0;
  for (const r of vanDaily) {
    if (r.company !== company || !r.date || monthOf(r.date) !== month) continue;
    onTime += r.onTime;
    exclusiveBookings += r.exclusiveBookings;
  }
  if (exclusiveBookings <= 0) return null;
  return { onTime, exclusiveBookings, pct: (onTime / exclusiveBookings) * 100 };
}

const inDateRange = (date: string, range: { from: string; to: string }) =>
  Boolean(date) && date >= range.from && date <= range.to;

/** A van's On Time % over any date range — the daily block is complete, so this always works. */
function vanOnTimePct(
  vanDaily: OnTimeVanDay[],
  van: string,
  range: { from: string; to: string },
): number | null {
  let onTime = 0;
  let exclusiveBookings = 0;
  for (const r of vanDaily) {
    if (r.van !== van || !inDateRange(r.date, range)) continue;
    onTime += r.onTime;
    exclusiveBookings += r.exclusiveBookings;
  }
  return exclusiveBookings > 0 ? (onTime / exclusiveBookings) * 100 : null;
}

/**
 * A cleaner's On Time % for a whole month, from the MTD block only (summed
 * across her vans). null whenever that month isn't one the MTD block covers.
 */
function cleanerOnTimePct(
  monthly: OnTimeMonthly[],
  cleanerName: string,
  month: string,
): number | null {
  let onTime = 0;
  let exclusiveBookings = 0;
  for (const r of monthly) {
    if (r.level !== 'cleaner' || r.month !== month || r.cleanerName !== cleanerName) continue;
    onTime += r.onTime;
    exclusiveBookings += r.exclusiveBookings;
  }
  return exclusiveBookings > 0 ? (onTime / exclusiveBookings) * 100 : null;
}

/** Late arrivals ("Not On Time #") for one cleaner or van over a date range. */
function lateCountForRange(
  onTime: OnTimeData,
  name: string,
  groupBy: DefaulterGroupBy,
  range: { from: string; to: string },
): number {
  if (groupBy === 'van') {
    return onTime.vanDaily
      .filter((r) => r.van === name && inDateRange(r.date, range))
      .reduce((s, r) => s + r.notOnTime, 0);
  }
  return onTime.cleanerDaily
    .filter((r) => r.cleanerName === name && inDateRange(r.date, range))
    .reduce((s, r) => s + r.notOnTime, 0);
}

// ---------------------------------------------------------------------------
// Weekly buckets for the Defaulters "Weekly" tab — Monday-to-Sunday weeks
// starting from a fixed anchor date, through the week containing "today".
// Nothing is stored: a week is just its date range, computed on the fly.
// ---------------------------------------------------------------------------

/** The first Monday tracked, per the original request. */
export const WEEKLY_ANCHOR = '2026-07-06';

export interface WeekBucket {
  /** The Monday's yyyy-MM-dd — unique, used as the dropdown value. */
  key: string;
  /** e.g. "06 Jul – 12 Jul 2026". */
  label: string;
  start: string;
  end: string;
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function formatWeekLabel(startIso: string, endIso: string): string {
  // Built manually (day-then-month) rather than via toLocaleString, which
  // for en-US puts the month first — the rest of the app's dates always
  // read day-first (see formatDmy in parse.ts), so this matches.
  const fmt = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number);
    return `${String(d).padStart(2, '0')} ${SHORT_MONTHS[m - 1]}`;
  };
  return `${fmt(startIso)} – ${fmt(endIso)} ${endIso.slice(0, 4)}`;
}

/** Every Mon-Sun week from WEEKLY_ANCHOR through the week containing `today`, newest first. */
export function weekBuckets(today: string): WeekBucket[] {
  const out: WeekBucket[] = [];
  let start = WEEKLY_ANCHOR;
  while (start <= today) {
    const end = shiftIso(start, 6);
    out.push({ key: start, label: formatWeekLabel(start, end), start, end });
    start = shiftIso(start, 7);
  }
  return out.reverse();
}

export type DefaulterMetric = 'absent' | 'cancellations' | 'late';
export type DefaulterGroupBy = 'cleaner' | 'van';

export interface DefaulterEntry {
  key: string;
  /** Cleaner name or van name, depending on groupBy. */
  name: string;
  /** Van (grouped by cleaner) or company (grouped by van) — shown as context. */
  secondary: string;
  company: string;
  absentCount: number;
  cancellationCount: number;
  /** Late arrivals in the period — "Not On Time #" from the daily blocks. */
  lateCount: number;
  /** On Time % for the period, or null when the denominator isn't known. */
  onTimePct: number | null;
}

/**
 * Every cleaner (or every van), both companies combined, within an
 * inclusive date range — both Absent BD and Cancellations are always
 * computed together; `metric` only picks which one the list is ranked by
 * (ties broken by the other metric, then by name). Used for both the
 * Monthly tab (range = that month) and the Weekly tab (range = one week).
 */
export function defaultersList(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  range: { from: string; to: string },
  groupBy: DefaulterGroupBy,
  metric: DefaulterMetric,
  onTime: OnTimeData = NO_ONTIME,
  month?: string,
): DefaulterEntry[] {
  const inRange = (date: string) => Boolean(date) && date >= range.from && date <= range.to;
  const rows = new Map<string, DefaulterEntry>();

  const blank = (key: string, secondary: string, company: string): DefaulterEntry => ({
    key,
    name: key,
    secondary,
    company,
    absentCount: 0,
    cancellationCount: 0,
    lateCount: 0,
    onTimePct: null,
  });

  for (const r of perf) {
    if (!inRange(r.date) || !r.count) continue; // 0 = present, not an absence
    const key = groupBy === 'cleaner' ? r.cleanerName : r.van;
    if (!key) continue;
    const entry = rows.get(key) ?? blank(key, groupBy === 'cleaner' ? r.van : r.company, r.company);
    entry.absentCount += r.count;
    if (groupBy === 'cleaner' && r.van) entry.secondary = r.van; // most recent van wins
    rows.set(key, entry);
  }

  for (const r of canx) {
    if (!inRange(r.date)) continue;
    const key = groupBy === 'cleaner' ? r.cleaner : r.van;
    if (!key) continue;
    const entry = rows.get(key) ?? blank(key, groupBy === 'cleaner' ? r.van : r.company, r.company);
    entry.cancellationCount += r.count || 1;
    if (!entry.company && r.company) entry.company = r.company;
    if (groupBy === 'cleaner' && r.van && !entry.secondary) entry.secondary = r.van;
    rows.set(key, entry);
  }

  // The on-time blocks carry their own Company column, so unlike
  // Cancellations they need no van -> company lookup. A van or cleaner that
  // was only ever late (never absent, never cancelled) belongs in this list
  // too, so these rows can create an entry of their own.
  for (const r of groupBy === 'van' ? onTime.vanDaily : onTime.cleanerDaily) {
    if (!inRange(r.date)) continue;
    const key = groupBy === 'van' ? r.van : (r as OnTimeCleanerDay).cleanerName;
    if (!key) continue;
    const entry = rows.get(key) ?? blank(key, groupBy === 'cleaner' ? r.van : r.company, r.company);
    entry.lateCount += r.notOnTime;
    if (!entry.company && r.company) entry.company = r.company;
    if (groupBy === 'cleaner' && r.van && !entry.secondary) entry.secondary = r.van;
    rows.set(key, entry);
  }

  for (const entry of rows.values()) {
    entry.onTimePct =
      groupBy === 'van'
        ? vanOnTimePct(onTime.vanDaily, entry.name, range)
        : month
          ? cleanerOnTimePct(onTime.monthly, entry.name, month)
          : null;
  }

  return [...rows.values()]
    .filter((e) => e.absentCount > 0 || e.cancellationCount > 0 || e.lateCount > 0)
    .sort((a, b) => {
      const [primaryA, primaryB, secondaryA, secondaryB] =
        metric === 'absent'
          ? [a.absentCount, b.absentCount, a.cancellationCount, b.cancellationCount]
          : metric === 'cancellations'
            ? [a.cancellationCount, b.cancellationCount, a.absentCount, b.absentCount]
            : [a.lateCount, b.lateCount, a.absentCount, b.absentCount];
      return primaryB - primaryA || secondaryB - secondaryA || a.name.localeCompare(b.name);
    });
}

/** Monthly convenience wrapper around defaultersList. */
export function defaultersListForMonth(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  month: string,
  groupBy: DefaulterGroupBy,
  metric: DefaulterMetric,
  onTime: OnTimeData = NO_ONTIME,
): DefaulterEntry[] {
  return defaultersList(perf, canx, monthRange(month), groupBy, metric, onTime, month);
}

// ---------------------------------------------------------------------------
// Per-cleaner / per-van history — so a defaulter's current-period numbers
// can be read alongside her recent past, answering "is this a one-off or
// chronic?" without leaving the table. Monthly shows the selected month plus
// the one before it; Weekly shows the selected week plus the two before it —
// both oldest first, ending at whatever period is currently selected.
// ---------------------------------------------------------------------------

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** `count` month keys ending at (and including) `month`, oldest first. */
function recentMonths(month: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftMonth(month, -i));
  return out;
}

function weekBucketFor(mondayIso: string): WeekBucket {
  const end = shiftIso(mondayIso, 6);
  return { key: mondayIso, label: formatWeekLabel(mondayIso, end), start: mondayIso, end };
}

/** `count` Monday keys ending at (and including) `weekKey`, oldest first. */
function recentWeekKeys(weekKey: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftIso(weekKey, -7 * i));
  return out;
}

function countsForRange(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  name: string,
  groupBy: DefaulterGroupBy,
  range: { from: string; to: string },
  onTime: OnTimeData,
): { absentCount: number; cancellationCount: number; lateCount: number } {
  const inRange = (date: string) => Boolean(date) && date >= range.from && date <= range.to;
  const absentCount = perf
    .filter((r) => inRange(r.date) && (groupBy === 'cleaner' ? r.cleanerName === name : r.van === name))
    .reduce((s, r) => s + r.count, 0);
  const cancellationCount = canx
    .filter((r) => inRange(r.date) && (groupBy === 'cleaner' ? r.cleaner === name : r.van === name))
    .reduce((s, r) => s + (r.count || 1), 0);
  return {
    absentCount,
    cancellationCount,
    lateCount: lateCountForRange(onTime, name, groupBy, range),
  };
}

export interface HistoryPoint {
  label: string;
  absentCount: number;
  cancellationCount: number;
  lateCount: number;
}

/**
 * A cleaner's or van's Absent BD + Cancellations for `month` and the
 * `count - 1` months before it, current month FIRST (index 0) — the rest
 * is context, not a timeline to read left-to-right.
 */
export function cleanerMonthlyHistory(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  name: string,
  groupBy: DefaulterGroupBy,
  month: string,
  count = 4,
  onTime: OnTimeData = NO_ONTIME,
): HistoryPoint[] {
  return recentMonths(month, count)
    .map((m) => ({
      label: formatMonthLabel(m),
      ...countsForRange(perf, canx, name, groupBy, monthRange(m), onTime),
    }))
    .reverse();
}

/**
 * A cleaner's or van's Absent BD + Cancellations for the week `weekKey`
 * and the `count - 1` weeks before it, current week FIRST (index 0) — same
 * ordering as cleanerMonthlyHistory, for consistency between the two tabs.
 */
export function cleanerWeeklyHistory(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  name: string,
  groupBy: DefaulterGroupBy,
  weekKey: string,
  count = 3,
  onTime: OnTimeData = NO_ONTIME,
): HistoryPoint[] {
  return recentWeekKeys(weekKey, count)
    .map((k) => {
      const bucket = weekBucketFor(k);
      return {
        label: bucket.label,
        ...countsForRange(perf, canx, name, groupBy, { from: bucket.start, to: bucket.end }, onTime),
      };
    })
    .reverse();
}

export interface VanCleanerBreakdown {
  cleanerId: string;
  cleanerName: string;
  absentCount: number;
  cancellationCount: number;
  /** Late arrivals on THIS van — these sum to the van's own Not On Time # for the period. */
  lateCount: number;
}

/**
 * Every cleaner who worked a given van within a date range, ranked by
 * `metric` (highest first) — the "who's actually behind this van's
 * number" breakdown shown alongside a van's history.
 */
export function vanCleanerBreakdown(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  van: string,
  range: { from: string; to: string },
  metric: DefaulterMetric,
  onTime: OnTimeData = NO_ONTIME,
): VanCleanerBreakdown[] {
  const inRange = (date: string) => Boolean(date) && date >= range.from && date <= range.to;
  const rows = new Map<string, VanCleanerBreakdown>();

  for (const r of perf) {
    if (r.van !== van || !inRange(r.date) || !r.cleanerName) continue;
    const key = r.cleanerId || r.cleanerName;
    const row = rows.get(key) ?? {
      cleanerId: r.cleanerId,
      cleanerName: r.cleanerName,
      absentCount: 0,
      cancellationCount: 0,
      lateCount: 0,
    };
    row.absentCount += r.count;
    rows.set(key, row);
  }

  for (const r of canx) {
    if (r.van !== van || !inRange(r.date) || !r.cleaner) continue;
    // Cancellations never carries a cleaner ID, so it's matched by name.
    const existingKey = [...rows.keys()].find((k) => rows.get(k)!.cleanerName === r.cleaner);
    const key = existingKey ?? r.cleaner;
    const row = rows.get(key) ?? {
      cleanerId: '',
      cleanerName: r.cleaner,
      absentCount: 0,
      cancellationCount: 0,
      lateCount: 0,
    };
    row.cancellationCount += r.count || 1;
    rows.set(key, row);
  }

  // The daily cleaner block carries a van of its own, so a cleaner's late
  // arrivals land on the van she was actually driving that day.
  for (const r of onTime.cleanerDaily) {
    if (r.van !== van || !inRange(r.date) || !r.cleanerName) continue;
    const existingKey =
      (r.cleanerId && rows.has(r.cleanerId) ? r.cleanerId : undefined) ??
      [...rows.keys()].find((k) => rows.get(k)!.cleanerName === r.cleanerName);
    const key = existingKey ?? (r.cleanerId || r.cleanerName);
    const row = rows.get(key) ?? {
      cleanerId: r.cleanerId,
      cleanerName: r.cleanerName,
      absentCount: 0,
      cancellationCount: 0,
      lateCount: 0,
    };
    row.lateCount += r.notOnTime;
    rows.set(key, row);
  }

  return [...rows.values()]
    .filter((r) => r.absentCount > 0 || r.cancellationCount > 0 || r.lateCount > 0)
    .sort((a, b) => {
      const [primaryA, primaryB] =
        metric === 'absent'
          ? [a.absentCount, b.absentCount]
          : metric === 'cancellations'
            ? [a.cancellationCount, b.cancellationCount]
            : [a.lateCount, b.lateCount];
      return primaryB - primaryA || a.cleanerName.localeCompare(b.cleanerName);
    });
}

export interface CompanyCleanerRollupFilters {
  /** '' or undefined = both companies. */
  company?: string;
  dateFrom?: string;
  dateTo?: string;
  cleanerName?: string;
  van?: string;
}

export interface CompanyCleanerRollupRow {
  cleanerId: string;
  cleanerName: string;
  company: string;
  van: string;
  absentCount: number;
  /**
   * This cleaner's share of the filtered scope's total absences for the
   * month (narrowed by the Company filter and Date range too, if set —
   * "what % of that company / stretch belongs to this cleaner" is still a
   * meaningful question). Deliberately NOT narrowed by the Cleaner name /
   * Van filters: those exist to help find a row, not to shrink the
   * population a percentage is taken against — filtering down to one
   * cleaner would otherwise always show ~100% and the number would stop
   * meaning anything.
   */
  absentShare: number;
  cancellationCount: number;
  /** Late arrivals in scope, from the daily cleaner block. */
  lateCount: number;
  /**
   * On Time % for the selected month, from the MTD cleaner block — null
   * outside the months it covers. Deliberately not narrowed by the Date range
   * filter, since the MTD block only knows whole months.
   */
  onTimePct: number | null;
  /** Most recent date this cleaner appears in scope — the table's sort key. */
  lastDate: string;
}

/**
 * One row per cleaner (not per event) for the selected month, narrowed
 * further by the filter row above the table (Company, Date range, Cleaner
 * name, Van name — all optional; no Company filter means both companies
 * combined). "In date sequence" (per the original request) means sorted by
 * each cleaner's most recent activity date, oldest first.
 */
export function companyCleanerRollup(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  month: string,
  filters: CompanyCleanerRollupFilters,
  onTime: OnTimeData = NO_ONTIME,
): CompanyCleanerRollupRow[] {
  const cleanerTerm = (filters.cleanerName || '').trim().toLowerCase();
  const vanTerm = (filters.van || '').trim().toLowerCase();
  const companyFilter = filters.company || '';

  const inBaseScope = (date: string, company: string) => {
    if (companyFilter && company !== companyFilter) return false;
    if (!date || monthOf(date) !== month) return false;
    if (filters.dateFrom && date < filters.dateFrom) return false;
    if (filters.dateTo && date > filters.dateTo) return false;
    return true;
  };

  // The share denominator — Company filter + month + date range only, so it
  // stays stable while the Cleaner name / Van filters narrow the visible rows.
  const totalAbsent = perf
    .filter((r) => inBaseScope(r.date, r.company))
    .reduce((s, r) => s + r.count, 0);

  const perfInScope = perf.filter((r) => {
    if (!inBaseScope(r.date, r.company)) return false;
    if (cleanerTerm && !r.cleanerName.toLowerCase().includes(cleanerTerm)) return false;
    if (vanTerm && !r.van.toLowerCase().includes(vanTerm)) return false;
    return true;
  });

  const canxInScope = canx.filter((r) => {
    if (!inBaseScope(r.date, r.company)) return false;
    if (cleanerTerm && !r.cleaner.toLowerCase().includes(cleanerTerm)) return false;
    if (vanTerm && !r.van.toLowerCase().includes(vanTerm)) return false;
    return true;
  });

  const rows = new Map<string, CompanyCleanerRollupRow>();
  const nameFor = (id: string, name: string) => id || name; // keys by id when we have one

  for (const r of perfInScope) {
    const key = nameFor(r.cleanerId, r.cleanerName);
    const row = rows.get(key) ?? {
      cleanerId: r.cleanerId,
      cleanerName: r.cleanerName,
      company: r.company,
      van: r.van,
      absentCount: 0,
      absentShare: 0,
      cancellationCount: 0,
      lateCount: 0,
      onTimePct: null,
      lastDate: '',
    };
    row.absentCount += r.count;
    if (r.date > row.lastDate) {
      row.lastDate = r.date;
      row.van = r.van || row.van; // most recent van wins when a cleaner has moved vans
    }
    rows.set(key, row);
  }

  for (const r of canxInScope) {
    if (!r.cleaner) continue;
    // Cancellations never carries a cleaner ID, so it's matched by name —
    // fine here since the per-cleaner id-vs-name key collision this would
    // risk (two different ids sharing a name) hasn't shown up in practice.
    const existingKey = [...rows.keys()].find(
      (k) => rows.get(k)!.cleanerName === r.cleaner,
    );
    const key = existingKey ?? r.cleaner;
    const row = rows.get(key) ?? {
      cleanerId: '',
      cleanerName: r.cleaner,
      company: r.company,
      van: r.van,
      absentCount: 0,
      absentShare: 0,
      cancellationCount: 0,
      lateCount: 0,
      onTimePct: null,
      lastDate: '',
    };
    row.cancellationCount += r.count || 1;
    if (r.date > row.lastDate) {
      row.lastDate = r.date;
      row.van = r.van || row.van;
    }
    rows.set(key, row);
  }

  // Late arrivals respect exactly the same filters as the rest of the table.
  for (const r of onTime.cleanerDaily) {
    if (!inBaseScope(r.date, r.company) || !r.cleanerName) continue;
    if (cleanerTerm && !r.cleanerName.toLowerCase().includes(cleanerTerm)) continue;
    if (vanTerm && !r.van.toLowerCase().includes(vanTerm)) continue;

    const existingKey =
      (r.cleanerId && rows.has(r.cleanerId) ? r.cleanerId : undefined) ??
      [...rows.keys()].find((k) => rows.get(k)!.cleanerName === r.cleanerName);
    const key = existingKey ?? (r.cleanerId || r.cleanerName);
    const row = rows.get(key) ?? {
      cleanerId: r.cleanerId,
      cleanerName: r.cleanerName,
      company: r.company,
      van: r.van,
      absentCount: 0,
      absentShare: 0,
      cancellationCount: 0,
      lateCount: 0,
      onTimePct: null,
      lastDate: '',
    };
    row.lateCount += r.notOnTime;
    if (r.date > row.lastDate) {
      row.lastDate = r.date;
      row.van = r.van || row.van;
    }
    rows.set(key, row);
  }

  for (const row of rows.values()) {
    row.absentShare = totalAbsent > 0 ? (row.absentCount / totalAbsent) * 100 : 0;
    row.onTimePct = cleanerOnTimePct(onTime.monthly, row.cleanerName, month);
  }

  return [...rows.values()].sort(
    (a, b) => a.lastDate.localeCompare(b.lastDate) || a.cleanerName.localeCompare(b.cleanerName),
  );
}

/** Distinct, sorted names for the searchable Cleaner name / Van name dropdowns. */
export function distinctCleanerNames(perf: CompanyPerfRow[], company?: string): string[] {
  const scoped = company ? perf.filter((r) => r.company === company) : perf;
  return [...new Set(scoped.map((r) => r.cleanerName))].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export function distinctVanNames(perf: CompanyPerfRow[], company?: string): string[] {
  const scoped = company ? perf.filter((r) => r.company === company) : perf;
  return [...new Set(scoped.map((r) => r.van))].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Reminder email figures
// ---------------------------------------------------------------------------

/**
 * Scoped to the current month only — once a month ends it's closed, its
 * totals already live in the Month to date archive, and it should stop
 * being counted as something the partner still has to action today. A
 * cash entry or cancellation from last month that's still unanswered
 * won't show up here; it shows up in that month's Month to date row
 * instead. Mirrors the same "current month only" rule the Updated tab
 * uses (see applyFilter's 'updated' branch above).
 */
export function reminderStats(cash: CashRow[], canx: CanxRow[], today: string): ReminderStats {
  const month = today.slice(0, 7);
  const cashThisMonth = cash.filter((r) => r.date.startsWith(month));
  const canxThisMonth = canx.filter((r) => r.date.startsWith(month));

  const pendingCash = cashThisMonth.filter((r) => !isCashAnswered(r));
  const notCollected = cashThisMonth.filter((r) => r.status === 'Not collected');
  const awaitingReason = canxThisMonth.filter((r) => !isCanxAnswered(r));

  let oldest = '';
  for (const r of [...pendingCash, ...awaitingReason]) {
    if (!r.date) continue;
    if (!oldest || r.date < oldest) oldest = r.date;
  }

  return {
    pendingCashCount: pendingCash.length,
    pendingCashAmount: pendingCash.reduce((s, r) => s + r.amount, 0),
    uncollectedAmount: notCollected.reduce((s, r) => s + r.amount, 0),
    collectedAmount: cashThisMonth
      .filter((r) => r.status === 'Collected')
      .reduce((s, r) => s + r.amount, 0),
    notCollectedCount: notCollected.length,
    noTicketCount: notCollected.filter((r) => r.ticket !== 'Yes').length,
    awaitingReasonCount: awaitingReason.length,
    reasonsProvidedCount: canxThisMonth.length - awaitingReason.length,
    totalCanx: canxThisMonth.length,
    oldestPending: oldest,
    oldestAgeDays: oldest ? Math.max(0, daysBetween(oldest, today)) : 0,
  };
}

/** Days a row has been sitting unanswered, for the ageing badges. */
export function ageInDays(row: AnyRow, today: string): number {
  if (!row.date || isAnswered(row)) return 0;
  return Math.max(0, daysBetween(row.date, today));
}

// ---------------------------------------------------------------------------
// Defaulter thresholds
//
// Which rows get flagged, and which of those are REPEAT offenders — the same
// cleaner or van having been over threshold the month before as well. The
// thresholds themselves live in lib/targets.ts so there is one place to
// change them; these only decide whether a row crosses them.
// ---------------------------------------------------------------------------

export interface ThresholdFlags {
  absent: boolean;
  cancellations: boolean;
  onTime: boolean;
  /** True when any of the three is over — i.e. the row is worth looking at. */
  any: boolean;
}

export function thresholdFlags(
  entry: { absentCount: number; cancellationCount: number; onTimePct: number | null },
  period: 'monthly' | 'weekly',
): ThresholdFlags {
  const absent =
    entry.absentCount >= (period === 'weekly' ? ABSENT_WEEK_FLAG : ABSENT_MONTH_FLAG);
  // Cancellations are only given a monthly threshold; a week is too short a
  // window for the count to mean much on its own.
  const cancellations = period === 'monthly' && entry.cancellationCount >= CANX_MONTH_FLAG;
  const onTime = entry.onTimePct != null && entry.onTimePct < ON_TIME_WARN_PCT;
  return { absent, cancellations, onTime, any: absent || cancellations || onTime };
}

/**
 * The keys that were ALREADY over threshold in the month before `month` —
 * what the "Repeat" tag is driven by. Built from a single pass of the
 * previous month through the very same defaultersList the table itself
 * uses, so the tag can never disagree with the numbers underneath it.
 * Asking per row instead would rescan every source array once per cleaner,
 * which at ~965 cleaners is millions of comparisons for the same answer.
 */
export function repeatOffenders(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  month: string,
  groupBy: DefaulterGroupBy,
  onTime: OnTimeData = NO_ONTIME,
): Set<string> {
  const out = new Set<string>();
  if (!month) return out;
  const previous = shiftMonth(month, -1);
  for (const e of defaultersListForMonth(perf, canx, previous, groupBy, 'absent', onTime)) {
    if (thresholdFlags(e, 'monthly').any) out.add(e.key);
  }
  return out;
}

/** "Oct" — for the compact "vs Oct" comparison line under a KPI. */
export function shortMonthLabel(monthKey: string): string {
  const m = Number(monthKey.split('-')[1]);
  return SHORT_MONTHS[m - 1] ?? monthKey;
}

// ---------------------------------------------------------------------------
// Cash ageing
//
// How long the still-unconfirmed cash has been waiting. Scoped to the current
// month exactly like reminderStats, so this strip and the reminder email can
// never tell the partner two different stories about the same pile of cash.
// ---------------------------------------------------------------------------

export type AgeBucketId = 'fresh' | 'week' | 'stale';

export interface AgeingBucket {
  id: AgeBucketId;
  label: string;
  /** Inclusive age range in days; `maxDays` null means open-ended. */
  minDays: number;
  maxDays: number | null;
  count: number;
  amount: number;
}

const AGE_BUCKETS: { id: AgeBucketId; label: string; minDays: number; maxDays: number | null }[] = [
  { id: 'fresh', label: '1–3 days', minDays: 0, maxDays: 3 },
  { id: 'week', label: '4–7 days', minDays: 4, maxDays: 7 },
  { id: 'stale', label: '8+ days', minDays: 8, maxDays: null },
];

/** True when this row is the kind of pending cash the ageing strip counts. */
export function isPendingThisMonth(row: CashRow, today: string): boolean {
  return !row.status && Boolean(row.date) && monthOf(row.date) === monthOf(today);
}

export function cashAgeing(cash: CashRow[], today: string): AgeingBucket[] {
  const out: AgeingBucket[] = AGE_BUCKETS.map((b) => ({ ...b, count: 0, amount: 0 }));
  for (const row of cash) {
    if (!isPendingThisMonth(row, today)) continue;
    const age = ageInDays(row, today);
    const bucket = out.find((b) => age >= b.minDays && (b.maxDays == null || age <= b.maxDays));
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += row.amount;
  }
  return out;
}

/** Does this row fall in the named bucket? Used to filter the Pending list. */
export function inAgeBucket(row: CashRow, bucketId: AgeBucketId, today: string): boolean {
  const bucket = AGE_BUCKETS.find((b) => b.id === bucketId);
  if (!bucket) return true;
  const age = ageInDays(row, today);
  return age >= bucket.minDays && (bucket.maxDays == null || age <= bucket.maxDays);
}

// ---------------------------------------------------------------------------
// Company performance, day by day
// ---------------------------------------------------------------------------

export interface CompanyDayPoint {
  /** yyyy-MM-dd */
  date: string;
  absentCount: number;
  cancellationCount: number;
  /** null on a day with no exclusive bookings — not 0%. */
  onTimePct: number | null;
}

/**
 * One point per day of `month` for a single company, for the Overview trend
 * chart. Every day in the month gets a point so the x-axis is a real
 * calendar rather than only the days something went wrong; days after today
 * are left out, since an empty future day would read as a perfect one.
 */
export function companyDailySeries(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  onTime: OnTimeData,
  company: string,
  month: string,
  today: string,
): CompanyDayPoint[] {
  if (!month || !company) return [];
  const { from, to } = monthRange(month);
  const last = to < today ? to : today;
  if (last < from) return [];

  const points = new Map<string, CompanyDayPoint>();
  for (let d = from; d <= last; d = shiftIso(d, 1)) {
    points.set(d, { date: d, absentCount: 0, cancellationCount: 0, onTimePct: null });
  }

  for (const r of perf) {
    if (r.company !== company) continue;
    const point = points.get(r.date);
    if (point) point.absentCount += r.count;
  }

  for (const r of canx) {
    if (r.company !== company) continue;
    const point = points.get(r.date);
    if (point) point.cancellationCount += r.count || 1;
  }

  // On time comes from the van block, which is complete for every day it
  // covers, so a day's rate is the sum of its vans — not an average of them.
  const onTimeTotals = new Map<string, { onTime: number; exclusive: number }>();
  for (const r of onTime.vanDaily) {
    if (r.company !== company || !points.has(r.date)) continue;
    const acc = onTimeTotals.get(r.date) ?? { onTime: 0, exclusive: 0 };
    acc.onTime += r.onTime;
    acc.exclusive += r.exclusiveBookings;
    onTimeTotals.set(r.date, acc);
  }
  for (const [date, acc] of onTimeTotals) {
    if (acc.exclusive > 0) points.get(date)!.onTimePct = (acc.onTime / acc.exclusive) * 100;
  }

  return [...points.values()];
}
