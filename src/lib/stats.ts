import { daysBetween } from './parse';
import type { AnyRow, CanxRow, CashRow, ReminderStats } from './types';

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
    const rows = all.filter((r) => isAnswered(r));
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
