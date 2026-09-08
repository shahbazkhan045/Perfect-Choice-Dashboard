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

/** One absence event: a single cleaner, on a single date, for one company. */
export interface CompanyPerfRow {
  date: string;
  dateRaw: string;
  company: string;
  cleanerId: string;
  cleanerName: string;
  van: string;
}

/**
 * One row of the Company Performance tab's own per-date-per-company Absent
 * BD summary (its second, right-hand mini-table) — the team's own
 * hand/formula-maintained count and percentage for that company on that
 * date. Never derived by this app; see readWorkbook() in lib/sheets.ts for
 * exactly how it's located and parsed, and stats.ts for how it's rolled up
 * into a monthly percentage per company.
 */
export interface CompanyAbsentDaily {
  date: string;
  company: string;
  count: number;
  pct: number;
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
  /** Every absence event from the "Company Performance" tab, if present. */
  companyPerf: CompanyPerfRow[];
  /** That tab's own per-date-per-company Absent BD #/% summary, if present. */
  companyAbsentDaily: CompanyAbsentDaily[];
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
