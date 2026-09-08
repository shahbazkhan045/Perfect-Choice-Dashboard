import { daysBetween } from './parse';
import type {
  AnyRow,
  CanxRow,
  CashRow,
  CompanyAbsentDaily,
  CompanyPerfRow,
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
// Two data sources, joined by name rather than by any shared key:
//  - companyPerf: one row per (cleaner, date) roster entry — read straight
//    off "Company Performance" columns A-F. Every cleaner scheduled that
//    day gets a row; `count` is that row's own Absent BD value: 0 (present),
//    0.5 (half-day absent) or 1 (full-day absent) — NOT a flag meaning "this
//    row is an absence". A company's Absent BD total is sum(count), never a
//    row count — most rows are 0s (someone present that day) and counting
//    rows instead of summing was the original bug: it reported >4000
//    "absences" for a company whose real total was ~140. Verified against
//    the sheet's own per-date-per-company mini table: sum(count) for every
//    (date, company) pair in the raw rows matches that mini table's own
//    Absent BD # column exactly.
//  - canx: Cancellations rows, each already carrying a `company` field
//    resolved in lib/sheets.ts (van/cleaner name -> company).
// ---------------------------------------------------------------------------

const monthOf = (iso: string): string => iso.slice(0, 7);

/** Companies found in the data, most-represented first. */
export function distinctCompanies(perf: CompanyPerfRow[]): string[] {
  const counts = new Map<string, number>();
  for (const r of perf) {
    if (!r.company) continue;
    counts.set(r.company, (counts.get(r.company) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([company]) => company);
}

/** Every yyyy-MM present in either source, newest first — feeds the month dropdown. */
export function companyMonthOptions(perf: CompanyPerfRow[], canx: CanxRow[]): string[] {
  const months = new Set<string>();
  for (const r of perf) if (r.date) months.add(monthOf(r.date));
  for (const r of canx) if (r.date) months.add(monthOf(r.date));
  return [...months].sort((a, b) => b.localeCompare(a));
}

/**
 * A company's Absent BD % for one month, reconstructed from the sheet's own
 * per-date-per-company figures (companyAbsentDaily) rather than guessed.
 *
 * Each daily entry already IS a percentage — count/denominator — but the
 * denominator (roster size that day) is never given directly, only implied.
 * It can still be recovered exactly: denominator = count / (pct/100). Once
 * every day in the month has its denominator recovered this way, the
 * correct monthly percentage is sum(counts) / sum(denominators) — a proper
 * weighted average, not a naive mean of the daily percentages (which would
 * over-weight low-roster days). Returns null when the month has no entries
 * for this company at all (nothing recorded yet, or the mini-table doesn't
 * reach that far back).
 */
export function companyMonthlyAbsentPct(
  daily: CompanyAbsentDaily[],
  company: string,
  month: string,
): number | null {
  let numerator = 0;
  let denominator = 0;
  let seen = false;

  for (const d of daily) {
    if (d.company !== company || monthOf(d.date) !== month) continue;
    seen = true;
    numerator += d.count;
    if (d.pct > 0) denominator += d.count / (d.pct / 100);
  }

  if (!seen) return null;
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

export interface CompanyKpis {
  absentCount: number;
  absentPct: number | null;
  cancellationCount: number;
  /**
   * The sheet's own overall monthly cancellation rate — the exact same
   * figure the Cancellations & releases tab shows as "Total cancellation
   * rate" for that month (canxMonthlyPct). This is NOT company-specific —
   * the sheet only ever records one rate per month, for everyone — so both
   * companies show the same number here by design; it's shown per company
   * only because that's where the rest of that company's figures live.
   * Null until the team records that month's rate.
   */
  cancellationPct: number | null;
}

export function companyKpis(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  daily: CompanyAbsentDaily[],
  canxMonthlyPct: Record<string, number>,
  company: string,
  month: string,
): CompanyKpis {
  const absentCount = perf
    .filter((r) => r.company === company && r.date && monthOf(r.date) === month)
    .reduce((s, r) => s + r.count, 0);

  const cancellationCount = canx
    .filter((r) => r.company === company && r.date && monthOf(r.date) === month)
    .reduce((s, r) => s + (r.count || 1), 0);

  return {
    absentCount,
    absentPct: companyMonthlyAbsentPct(daily, company, month),
    cancellationCount,
    cancellationPct: canxMonthlyPct[month] ?? null,
  };
}

export type DefaulterMetric = 'absent' | 'cancellations';
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
}

/**
 * Every cleaner (or every van), both companies combined, for one month —
 * both Absent BD and Cancellations are always computed together; `metric`
 * only picks which one the list is ranked by (ties broken by the other
 * metric, then by name).
 */
export function defaultersList(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  month: string,
  groupBy: DefaulterGroupBy,
  metric: DefaulterMetric,
): DefaulterEntry[] {
  const rows = new Map<string, DefaulterEntry>();

  const blank = (key: string, secondary: string, company: string): DefaulterEntry => ({
    key,
    name: key,
    secondary,
    company,
    absentCount: 0,
    cancellationCount: 0,
  });

  for (const r of perf) {
    if (!r.date || monthOf(r.date) !== month || !r.count) continue; // 0 = present, not an absence
    const key = groupBy === 'cleaner' ? r.cleanerName : r.van;
    if (!key) continue;
    const entry = rows.get(key) ?? blank(key, groupBy === 'cleaner' ? r.van : r.company, r.company);
    entry.absentCount += r.count;
    if (groupBy === 'cleaner' && r.van) entry.secondary = r.van; // most recent van wins
    rows.set(key, entry);
  }

  for (const r of canx) {
    if (!r.date || monthOf(r.date) !== month) continue;
    const key = groupBy === 'cleaner' ? r.cleaner : r.van;
    if (!key) continue;
    const entry = rows.get(key) ?? blank(key, groupBy === 'cleaner' ? r.van : r.company, r.company);
    entry.cancellationCount += r.count || 1;
    if (!entry.company && r.company) entry.company = r.company;
    if (groupBy === 'cleaner' && r.van && !entry.secondary) entry.secondary = r.van;
    rows.set(key, entry);
  }

  return [...rows.values()]
    .filter((e) => e.absentCount > 0 || e.cancellationCount > 0)
    .sort((a, b) => {
      const [primaryA, primaryB, secondaryA, secondaryB] =
        metric === 'absent'
          ? [a.absentCount, b.absentCount, a.cancellationCount, b.cancellationCount]
          : [a.cancellationCount, b.cancellationCount, a.absentCount, b.absentCount];
      return primaryB - primaryA || secondaryB - secondaryA || a.name.localeCompare(b.name);
    });
}

export interface CompanyCleanerRollupFilters {
  dateFrom?: string;
  dateTo?: string;
  cleanerName?: string;
  van?: string;
}

export interface CompanyCleanerRollupRow {
  cleanerId: string;
  cleanerName: string;
  van: string;
  absentCount: number;
  /**
   * This cleaner's share of the company's total absences for the month
   * (narrowed by the Date range too, if one's set — "what % of that
   * stretch belongs to this cleaner" is still a meaningful question).
   * Deliberately NOT narrowed by the Cleaner name / Van filters below:
   * those exist to help find a row, not to shrink the population a
   * percentage is taken against — filtering down to one cleaner would
   * otherwise always show ~100% and the number would stop meaning
   * anything.
   */
  absentShare: number;
  cancellationCount: number;
  /** Most recent date this cleaner appears in scope — the table's sort key. */
  lastDate: string;
}

/**
 * One row per cleaner (not per event) for the selected company + month,
 * narrowed further by the filter row above the table. "In date sequence"
 * (per the original request) means sorted by each cleaner's most recent
 * activity date, oldest first.
 */
export function companyCleanerRollup(
  perf: CompanyPerfRow[],
  canx: CanxRow[],
  company: string,
  month: string,
  filters: CompanyCleanerRollupFilters,
): CompanyCleanerRollupRow[] {
  const cleanerTerm = (filters.cleanerName || '').trim().toLowerCase();
  const vanTerm = (filters.van || '').trim().toLowerCase();

  const inBaseScope = (date: string) => {
    if (!date || monthOf(date) !== month) return false;
    if (filters.dateFrom && date < filters.dateFrom) return false;
    if (filters.dateTo && date > filters.dateTo) return false;
    return true;
  };

  // The share denominator — company + month + date range only, so it stays
  // stable while the Cleaner name / Van filters narrow the visible rows.
  const totalAbsent = perf
    .filter((r) => r.company === company && inBaseScope(r.date))
    .reduce((s, r) => s + r.count, 0);

  const perfInScope = perf.filter((r) => {
    if (r.company !== company || !inBaseScope(r.date)) return false;
    if (cleanerTerm && !r.cleanerName.toLowerCase().includes(cleanerTerm)) return false;
    if (vanTerm && !r.van.toLowerCase().includes(vanTerm)) return false;
    return true;
  });

  const canxInScope = canx.filter((r) => {
    if (r.company !== company || !inBaseScope(r.date)) return false;
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
      van: r.van,
      absentCount: 0,
      absentShare: 0,
      cancellationCount: 0,
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
      van: r.van,
      absentCount: 0,
      absentShare: 0,
      cancellationCount: 0,
      lastDate: '',
    };
    row.cancellationCount += r.count || 1;
    if (r.date > row.lastDate) {
      row.lastDate = r.date;
      row.van = r.van || row.van;
    }
    rows.set(key, row);
  }

  for (const row of rows.values()) {
    row.absentShare = totalAbsent > 0 ? (row.absentCount / totalAbsent) * 100 : 0;
  }

  return [...rows.values()].sort(
    (a, b) => a.lastDate.localeCompare(b.lastDate) || a.cleanerName.localeCompare(b.cleanerName),
  );
}

/** Distinct, sorted names for the searchable Cleaner name / Van name dropdowns. */
export function distinctCleanerNames(perf: CompanyPerfRow[], company: string): string[] {
  return [...new Set(perf.filter((r) => r.company === company).map((r) => r.cleanerName))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

export function distinctVanNames(perf: CompanyPerfRow[], company: string): string[] {
  return [...new Set(perf.filter((r) => r.company === company).map((r) => r.van))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Reminder email figures
// ---------------------------------------------------------------------------

/**
 * Counts everything still outstanding, regardless of date — that is what the
 * partner actually has to action, not just what happened yesterday.
 */
export function reminderStats(cash: CashRow[], canx: CanxRow[], today: string): ReminderStats {
  const pendingCash = cash.filter((r) => !isCashAnswered(r));
  const notCollected = cash.filter((r) => r.status === 'Not collected');
  const awaitingReason = canx.filter((r) => !isCanxAnswered(r));

  let oldest = '';
  for (const r of [...pendingCash, ...awaitingReason]) {
    if (!r.date) continue;
    if (!oldest || r.date < oldest) oldest = r.date;
  }

  return {
    pendingCashCount: pendingCash.length,
    pendingCashAmount: pendingCash.reduce((s, r) => s + r.amount, 0),
    uncollectedAmount: notCollected.reduce((s, r) => s + r.amount, 0),
    collectedAmount: cash
      .filter((r) => r.status === 'Collected')
      .reduce((s, r) => s + r.amount, 0),
    notCollectedCount: notCollected.length,
    noTicketCount: notCollected.filter((r) => r.ticket !== 'Yes').length,
    awaitingReasonCount: awaitingReason.length,
    reasonsProvidedCount: canx.length - awaitingReason.length,
    totalCanx: canx.length,
    oldestPending: oldest,
    oldestAgeDays: oldest ? Math.max(0, daysBetween(oldest, today)) : 0,
  };
}

/** Days a row has been sitting unanswered, for the ageing badges. */
export function ageInDays(row: AnyRow, today: string): number {
  if (!row.date || isAnswered(row)) return 0;
  return Math.max(0, daysBetween(row.date, today));
}
