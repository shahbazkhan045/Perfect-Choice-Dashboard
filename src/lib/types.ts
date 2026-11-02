export type Role = 'JUSTLIFE_ADMIN' | 'PC_ADMIN' | 'VIEWER';

export type Section = 'CASH' | 'CANX';

export const ROLE_LABELS: Record<Role, string> = {
  JUSTLIFE_ADMIN: 'Justlife Admin',
  PC_ADMIN: 'Perfect Choice Admin',
  VIEWER: 'View only',
};

export type CashStatus = '' | 'Collected' | 'Not collected';
export type TicketRaised = '' | 'Yes' | 'No';

export interface CashRow {
  key: string;
  section: 'CASH';
  /** yyyy-MM-dd, resolved from either a real date cell or text. */
  date: string;
  /** Exactly what the sheet displays, kept for tooltips. */
  dateRaw: string;
  ref: string;
  amount: number;
  status: CashStatus;
  ticket: TicketRaised;
  reason: string;
  /**
   * Read-only. The finance team's own note, typed directly into the sheet's
   * "Finance Comments" column — never written by this app.
   */
  financeComment: string;
  /**
   * Writable. The Perfect Choice team's reply to that finance comment —
   * "Yes" if it turned out to be collected, or the reason it wasn't.
   */
  financeResponse: string;
  updatedBy: string;
  updatedAt: string;
}

export interface CanxRow {
  key: string;
  section: 'CANX';
  date: string;
  dateRaw: string;
  code: string;
  cleaner: string;
  van: string;
  count: number;
  pct: number;
  reason: string;
  screenshot: string;
  updatedBy: string;
  updatedAt: string;
  /**
   * Which company this cancellation belongs to — derived, not a sheet
   * column. Looked up against the "Company Performance" tab's own
   * van-name -> company (and, failing that, cleaner-name -> company)
   * mapping, since Cancellations itself never records a company. Blank
   * when neither the van nor the cleaner is found there.
   */
  company: string;
}

export type AnyRow = CashRow | CanxRow;

// ---------------------------------------------------------------------------
// Company performance
// ---------------------------------------------------------------------------

/**
 * One roster entry: a single cleaner, on a single date, for one company —
 * NOT necessarily an absence. Every cleaner scheduled that day gets a row.
 */
export interface CompanyPerfRow {
  date: string;
  dateRaw: string;
  company: string;
  cleanerId: string;
  cleanerName: string;
  van: string;
  /**
   * This row's own Absent BD value: 0 (present), 0.5 (half-day absent) or 1
   * (full-day absent). A company's Absent BD total is sum(count) across its
   * rows for the period — never a row count, since most rows are 0s.
   */
  count: number;
}

/**
 * One row of the Company Performance tab's own per-month-per-company MTD
 * summary (its right-hand table, columns K-Q: "Time - Year Month" /
 * Company / Absent BD # / Absent BD % / Cancellation and Releases /
 * Cancellation and Releases % / Avg Rating) — the team's own
 * hand/formula-maintained figures. Read directly, never recomputed by this
 * app; see readWorkbook() in lib/sheets.ts for exactly how it's located.
 * `cancellationCount` / `cancellationPct` are null when the sheet hasn't
 * filled them in yet (e.g. the current month, still in progress).
 */
export interface CompanyMonthlyPerf {
  /** yyyy-MM */
  month: string;
  company: string;
  absentCount: number;
  absentPct: number;
  cancellationCount: number | null;
  cancellationPct: number | null;
  /** Average customer rating for the month (column Q); null when blank. */
  avgRating: number | null;
}

// ---------------------------------------------------------------------------
// On time % — the "On Time %" tab, four side-by-side blocks, all read-only.
// On Time % = On Time # / Exclusive Bookings, so only exclusive bookings are
// measured at all; a company with none (Excl Perfect Choice) has no rows here
// and must read as "Not tracked" rather than 0%.
// ---------------------------------------------------------------------------

/** Daily - Van block (columns A:H): every van with exclusive bookings, one row per day. */
export interface OnTimeVanDay {
  /** yyyy-MM-dd */
  date: string;
  dateRaw: string;
  company: string;
  van: string;
  /** How many cleaners were on that van that day. */
  cleaners: number;
  exclusiveBookings: number;
  onTime: number;
  notOnTime: number;
  onTimePct: number;
}

/**
 * Daily - Cleaner block (columns J:R). Only cleaner x van x day combinations
 * BELOW 100% appear here, so `notOnTime` summed over a range is a complete
 * late-arrival count (a missing day is a 100% day) — but `exclusiveBookings`
 * is NOT, which is why a cleaner's On Time % never comes from this block.
 */
export interface OnTimeCleanerDay {
  date: string;
  dateRaw: string;
  company: string;
  cleanerId: string;
  cleanerName: string;
  van: string;
  exclusiveBookings: number;
  onTime: number;
  notOnTime: number;
  onTimePct: number;
}

/**
 * The two MTD blocks: per van (columns T:Z) and per cleaner x van (AB:AJ),
 * for the previous and current month only. In the van block a Van Name of
 * "TOTAL" is the company's own whole-month figure, kept as level 'company'.
 */
export interface OnTimeMonthly {
  /** yyyy-MM */
  month: string;
  company: string;
  level: 'company' | 'van' | 'cleaner';
  cleanerId: string;
  cleanerName: string;
  van: string;
  exclusiveBookings: number;
  onTime: number;
  notOnTime: number;
  onTimePct: number;
}

export interface DashboardData {
  role: Role;
  roleLabel: string;
  canEdit: boolean;
  canRemind: boolean;
  currency: string;
  /** yyyy-MM-dd in the dashboard timezone. */
  today: string;
  yesterday: string;
  syncedAt: string;
  cash: CashRow[];
  canx: CanxRow[];
  /**
   * The team's own overall cancellation rate, hand-entered in the sheet —
   * see readWorkbook() in lib/sheets.ts for exactly where. `null` until
   * that row exists. This is canxMonthlyPct's entry for the current month.
   */
  canxTotalPct: number | null;
  /**
   * month key (yyyy-MM) -> overall Cancellation & Release % for that month,
   * both companies combined — from the Company Performance MTD table, with
   * a hand-entered Cancellations total row as fallback. See readWorkbook().
   */
  canxMonthlyPct: Record<string, number>;
  /** Every roster entry from the "Company Performance" tab, if present. */
  companyPerf: CompanyPerfRow[];
  /** That tab's own per-month-per-company MTD summary, if present. */
  companyMonthly: CompanyMonthlyPerf[];
  /** "On Time %" tab, Daily - Van block — [] when the tab is absent or empty. */
  onTimeVanDaily: OnTimeVanDay[];
  /** "On Time %" tab, Daily - Cleaner block (below-100% rows only). */
  onTimeCleanerDaily: OnTimeCleanerDay[];
  /** "On Time %" tab, both MTD blocks combined — see OnTimeMonthly.level. */
  onTimeMonthly: OnTimeMonthly[];
}

export interface ReminderStats {
  pendingCashCount: number;
  pendingCashAmount: number;
  uncollectedAmount: number;
  collectedAmount: number;
  notCollectedCount: number;
  noTicketCount: number;
  awaitingReasonCount: number;
  reasonsProvidedCount: number;
  totalCanx: number;
  oldestPending: string;
  oldestAgeDays: number;
}
