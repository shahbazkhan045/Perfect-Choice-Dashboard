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
  /** month key (yyyy-MM) -> hand-entered cancellation rate for that month. */
  canxMonthlyPct: Record<string, number>;
  /** Every roster entry from the "Company Performance" tab, if present. */
  companyPerf: CompanyPerfRow[];
  /** That tab's own per-month-per-company MTD summary, if present. */
  companyMonthly: CompanyMonthlyPerf[];
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
