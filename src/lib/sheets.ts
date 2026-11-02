import { google, type sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { SHEET_ID, TABS } from './config';
import { clean, formatStampCell, nowStamp, todayIso, toIsoDate, toNumber, toPercent } from './parse';
import type {
  CanxRow,
  CashRow,
  CompanyMonthlyPerf,
  CompanyPerfRow,
  OnTimeCleanerDay,
  OnTimeMonthly,
  OnTimeVanDay,
  Role,
  Section,
} from './types';
import { ROLE_LABELS } from './types';

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

let cachedClient: sheets_v4.Sheets | null = null;

export class SheetsConfigError extends Error {}

function serviceAccountKey(): string {
  const raw = process.env.GOOGLE_PRIVATE_KEY || '';
  // Vercel stores multi-line values with literal \n; a pasted key may be real newlines.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

export function sheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = serviceAccountKey();

  if (!email || !key) {
    throw new SheetsConfigError(
      'Google credentials are missing. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY.',
    );
  }
  if (!SHEET_ID) {
    throw new SheetsConfigError('GOOGLE_SHEET_ID is not set.');
  }

  const auth = new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

// ---------------------------------------------------------------------------
// A1 helpers
// ---------------------------------------------------------------------------

function quoteTab(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function colLetter(index0: number): string {
  let n = index0 + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Header mapping — tolerates renamed / reordered columns
// ---------------------------------------------------------------------------

type Grid = unknown[][];

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    // '%' must survive as a token, not just get stripped below — otherwise
    // "Cancellation and Releases" and "Cancellation and Releases %" collide
    // on the exact same normalized string and the header matcher silently
    // picks whichever column comes first (the count, not the percent).
    .replace(/%/g, 'pct')
    .replace(/[^a-z0-9]/g, '');
}

function indexHeaders<T extends Record<string, string[]>>(
  headerRow: unknown[],
  spec: T,
): Record<keyof T, number> {
  const normalized = headerRow.map(norm);
  const out = {} as Record<keyof T, number>;

  (Object.keys(spec) as (keyof T)[]).forEach((field) => {
    out[field] = -1;
    const candidates = spec[field];

    for (const candidate of candidates) {
      const want = norm(candidate);
      const exact = normalized.indexOf(want);
      if (exact !== -1) {
        out[field] = exact;
        return;
      }
    }
    // Second pass: prefix match, so "Reason (why not collected)" still maps to reason.
    for (const candidate of candidates) {
      const want = norm(candidate);
      const prefix = normalized.findIndex((h) => h.length > 0 && h.startsWith(want));
      if (prefix !== -1) {
        out[field] = prefix;
        return;
      }
    }
  });

  return out;
}

const CASH_SPEC = {
  date: ['Start Date', 'Date', 'Booking Date'],
  ref: ['Reference Code', 'Reference', 'Booking Code'],
  amount: ['Total Amount', 'Amount', 'Cash Amount'],
  status: ['Status', 'Collection Status'],
  ticket: ['Ticket Raised?', 'Ticket Raised', 'Ticket'],
  reason: ['Reason', 'Remarks'],
  // Finance's own column — read, never written, by this app.
  financeComment: ['Finance Comments', 'Finance Comment'],
  // The Perfect Choice team's reply to that comment — see ensureFinanceResponseColumn().
  financeResponse: ['Perfect Choice Response', 'PC Response', 'Finance Response'],
  updatedBy: ['Updated By'],
  updatedAt: ['Updated At'],
};

const CANX_SPEC = {
  date: ['Time - Master Date', 'Master Date', 'Date'],
  code: ['Appointment Code', 'Appointment'],
  cleaner: ['Cleaner Name', 'Cleaner'],
  van: ['Van Name', 'Van'],
  count: ['Cancellation and Releases', 'Count'],
  pct: ['Cancellation and Releases %', 'Cancellation %'],
  reason: ['Reason', 'Remarks'],
  screenshot: ['Screenshot', 'Screenshot URL'],
  updatedBy: ['Updated By'],
  updatedAt: ['Updated At'],
};

// Left-hand raw table only (columns A-E). The right-hand Absent BD summary
// mini-table (originally columns K-N) shares header text with columns A-B,
// so indexHeaders() can't find it — see locateAbsentDailyBlock() below.
const COMPANY_PERF_SPEC = {
  date: ['Time - Master Date', 'Master Date', 'Date'],
  company: ['Company'],
  cleanerId: ['Cleaner ID', 'Cleaner Id'],
  cleanerName: ['Cleaner Name', 'Cleaner'],
  van: ['Van Name', 'Van'],
  // Per-row Absent BD value — 0/0.5/1, NOT a per-row "is absent" flag. See
  // CompanyPerfRow in lib/types.ts.
  count: ['Absent (BD) #', 'Absent BD #', 'Absent (BD)#'],
};

const RESP_SPEC = {
  key: ['Key'],
  section: ['Section'],
  status: ['Status'],
  ticket: ['Ticket Raised', 'Ticket Raised?'],
  reason: ['Reason'],
  screenshot: ['Screenshot URL', 'Screenshot'],
  financeResponse: ['Finance Response', 'Perfect Choice Response'],
  updatedBy: ['Updated By'],
  updatedAt: ['Updated At'],
};

export const RESPONSE_HEADERS = [
  'Key',
  'Section',
  'Status',
  'Ticket Raised',
  'Reason',
  'Screenshot URL',
  'Finance Response',
  'Updated By',
  'Updated At',
];

export const AUDIT_HEADERS = [
  'Timestamp',
  'Section',
  'Key',
  'Field',
  'From',
  'To',
  'Role',
  'Actor',
];

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function cashKey(dateIso: string, ref: string): string {
  return `CASH|${dateIso}|${clean(ref)}`;
}

export function canxKey(dateIso: string, code: string, cleaner: string): string {
  return `CANX|${dateIso}|${clean(code)}|${clean(cleaner)}`;
}

// ---------------------------------------------------------------------------
// Tab bootstrap
// ---------------------------------------------------------------------------

let tabCache: { titles: Set<string>; at: number } | null = null;
const TAB_CACHE_MS = 60_000;

async function listTabs(force = false): Promise<Set<string>> {
  if (!force && tabCache && Date.now() - tabCache.at < TAB_CACHE_MS) {
    return tabCache.titles;
  }
  const api = sheetsClient();
  const res = await api.spreadsheets.get({
    spreadsheetId: SHEET_ID,
    fields: 'sheets.properties.title',
  });
  const titles = new Set(
    (res.data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean),
  );
  tabCache = { titles, at: Date.now() };
  return titles;
}

/** Creates the bookkeeping tabs on first use so setup is zero-touch. */
async function ensureTab(title: string, headers: string[]): Promise<void> {
  const titles = await listTabs();
  if (titles.has(title)) return;

  const api = sheetsClient();
  await api.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title, hidden: true } } }],
    },
  });
  await api.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${quoteTab(title)}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });
  await listTabs(true);
}

async function assertSourceTabs(): Promise<void> {
  const titles = await listTabs();
  const missing = [TABS.CASH, TABS.CANX].filter((t) => !titles.has(t));
  if (missing.length) {
    throw new SheetsConfigError(
      `The spreadsheet has no tab named ${missing.map((m) => `"${m}"`).join(' or ')}. ` +
        `Found: ${[...titles].join(', ')}. Fix the names, or set SHEET_TAB_CASH / SHEET_TAB_CANX.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface ResponseEntry {
  row: number;
  status: string;
  ticket: string;
  reason: string;
  screenshot: string;
  financeResponse: string;
  updatedBy: string;
  updatedAt: string;
}

interface RawWorkbook {
  cash: { raw: Grid; display: Grid };
  canx: { raw: Grid; display: Grid };
  companyPerf: { raw: Grid; display: Grid };
  onTime: { raw: Grid; display: Grid };
  responses: { raw: Grid };
}

const EMPTY_PAIR = { raw: [] as Grid, display: [] as Grid };

async function fetchWorkbook(): Promise<RawWorkbook> {
  await assertSourceTabs();
  await ensureTab(TABS.RESPONSES, RESPONSE_HEADERS);

  // Optional tabs — their absence should never break Cash Collection or
  // Cancellations, so each is only requested when actually present. Ranges
  // are assembled with their own names so the result indices stay correct
  // however many of the optional tabs happen to exist.
  const tabs = await listTabs();
  const api = sheetsClient();

  // Both grids are wanted for these: UNFORMATTED for the real values,
  // FORMATTED so toPercent() can read the sheet's own "0.00%" rendering.
  type GridPairName = 'cash' | 'canx' | 'companyPerf' | 'onTime';
  const displayRanges: { name: GridPairName; range: string }[] = [
    { name: 'cash', range: `${quoteTab(TABS.CASH)}!A1:Z` },
    { name: 'canx', range: `${quoteTab(TABS.CANX)}!A1:Z` },
  ];
  if (tabs.has(TABS.COMPANY_PERF)) {
    displayRanges.push({ name: 'companyPerf', range: `${quoteTab(TABS.COMPANY_PERF)}!A1:Z` });
  }
  if (tabs.has(TABS.ONTIME)) {
    // Wider than the A1:Z the other tabs use — the fourth block runs to AJ.
    displayRanges.push({ name: 'onTime', range: `${quoteTab(TABS.ONTIME)}!A1:AJ` });
  }
  const ranges = [...displayRanges.map((r) => r.range), `${quoteTab(TABS.RESPONSES)}!A1:Z`];

  const [unformatted, formatted] = await Promise.all([
    api.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    }),
    api.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: displayRanges.map((r) => r.range),
      valueRenderOption: 'FORMATTED_VALUE',
    }),
  ]);

  const u = unformatted.data.valueRanges || [];
  const f = formatted.data.valueRanges || [];

  const out: RawWorkbook = {
    cash: { ...EMPTY_PAIR },
    canx: { ...EMPTY_PAIR },
    companyPerf: { ...EMPTY_PAIR },
    onTime: { ...EMPTY_PAIR },
    responses: { raw: (u[displayRanges.length]?.values as Grid) || [] },
  };
  displayRanges.forEach((r, i) => {
    out[r.name] = {
      raw: (u[i]?.values as Grid) || [],
      display: (f[i]?.values as Grid) || [],
    };
  });
  return out;
}

function parseResponses(grid: Grid): Map<string, ResponseEntry> {
  const map = new Map<string, ResponseEntry>();
  if (grid.length < 2) return map;

  const idx = indexHeaders(grid[0], RESP_SPEC);
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] || [];
    const key = clean(row[idx.key]);
    if (!key) continue;
    map.set(key, {
      row: r + 1,
      status: idx.status >= 0 ? clean(row[idx.status]) : '',
      ticket: idx.ticket >= 0 ? clean(row[idx.ticket]) : '',
      reason: idx.reason >= 0 ? clean(row[idx.reason]) : '',
      screenshot: idx.screenshot >= 0 ? clean(row[idx.screenshot]) : '',
      financeResponse: idx.financeResponse >= 0 ? clean(row[idx.financeResponse]) : '',
      updatedBy: idx.updatedBy >= 0 ? clean(row[idx.updatedBy]) : '',
      updatedAt: idx.updatedAt >= 0 ? formatStampCell(row[idx.updatedAt]) : '',
    });
  }
  return map;
}

function cell(grid: Grid, r: number, c: number): unknown {
  if (c < 0) return '';
  return grid[r]?.[c] ?? '';
}

function normaliseStatus(value: string): CashRow['status'] {
  const v = value.toLowerCase().replace(/[^a-z]/g, '');
  if (v === 'collected') return 'Collected';
  if (v === 'notcollected' || v === 'uncollected') return 'Not collected';
  return '';
}

function normaliseTicket(value: string): CashRow['ticket'] {
  const v = value.toLowerCase().trim();
  if (v === 'yes' || v === 'y' || v === 'true') return 'Yes';
  if (v === 'no' || v === 'n' || v === 'false') return 'No';
  return '';
}

export interface WorkbookResult {
  cash: CashRow[];
  canx: CanxRow[];
  /**
   * The true overall cancellation rate, hand-maintained by the team — see
   * canxMonthlyPct below for exactly how. This is just canxMonthlyPct's
   * entry for the CURRENT month (Asia/Dubai "today"), kept as its own field
   * because it predates the monthly archive and the always-visible "Total
   * cancellation rate" KPI card reads it directly. `null` until this month
   * has an entry.
   */
  canxTotalPct: number | null;
  /**
   * month key (yyyy-MM) -> the team's hand-entered cancellation rate for
   * that month, e.g. { "2026-08": 0.38 }.
   *
   * A "total row" is any row with every identifying column blank and only
   * the percent column filled in (columns A-E blank, F has a value) — the
   * same convention as before, just no longer restricted to being the
   * literal last row of the sheet. Scanning top to bottom, each total row is
   * attributed to whichever month the nearest PRECEDING real data row
   * belongs to. That's what makes this a durable monthly archive rather
   * than a single always-overwritten cell: the team leaves August's row
   * exactly where it is when September starts, and adds a new blank row
   * further down (after September's own data) whenever they want to record
   * September's rate. Nothing needs to move — a row's meaning is fixed by
   * its position in the sheet, and new rows only ever get appended below.
   * Per-row percentages elsewhere in this column are each ~100% (see
   * canxKpis in stats.ts) and are never mistaken for this value, since those
   * rows always carry an appointment code.
   */
  canxMonthlyPct: Record<string, number>;
  companyPerf: CompanyPerfRow[];
  companyMonthly: CompanyMonthlyPerf[];
  onTimeVanDaily: OnTimeVanDay[];
  onTimeCleanerDaily: OnTimeCleanerDay[];
  onTimeMonthly: OnTimeMonthly[];
}

// ---------------------------------------------------------------------------
// Company performance
// ---------------------------------------------------------------------------

function parseCompanyPerf(grid: Grid, display: Grid): CompanyPerfRow[] {
  const out: CompanyPerfRow[] = [];
  if (grid.length < 2) return out;

  const idx = indexHeaders(grid[0], COMPANY_PERF_SPEC);
  if (idx.date < 0) return out;

  for (let r = 1; r < grid.length; r++) {
    const date = toIsoDate(cell(grid, r, idx.date));
    const cleanerName = clean(cell(grid, r, idx.cleanerName));
    const company = clean(cell(grid, r, idx.company));
    if (!date && !cleanerName) continue; // a blank spacer row, or the right-hand summary block leaking through

    out.push({
      date,
      dateRaw: clean(cell(display, r, idx.date)),
      company,
      cleanerId: clean(cell(grid, r, idx.cleanerId)),
      cleanerName,
      van: clean(cell(grid, r, idx.van)),
      count: toNumber(cell(grid, r, idx.count)),
    });
  }
  return out;
}

/**
 * The MTD summary table sits to the right of the raw per-event table,
 * columns K-Q: "Time - Year Month" / Company / Absent BD # / Absent BD % /
 * Cancellation and Releases / Cancellation and Releases % / Avg Rating.
 * Unlike the raw table's headers, "Time - Year Month" is unique in the row
 * (no collision to worry about), so it's just located directly; the other
 * columns are read as fixed offsets from it, matching the sheet's layout.
 * Returns [] if the table isn't there — the company KPI boxes just show
 * "not set in sheet" everywhere in that case.
 */
function parseCompanyMonthlyPerf(raw: Grid, display: Grid): CompanyMonthlyPerf[] {
  const header = raw[0] || [];
  const kCol = header.findIndex((h) => norm(h) === norm('Time - Year Month'));
  if (kCol < 0) return [];

  const companyCol = kCol + 1;
  const absentCol = kCol + 2;
  const absentPctCol = kCol + 3;
  const canxCol = kCol + 4;
  const canxPctCol = kCol + 5;
  const ratingCol = kCol + 6;

  const present = (v: unknown) => v !== '' && v !== null && v !== undefined;

  const out: CompanyMonthlyPerf[] = [];
  for (let r = 1; r < raw.length; r++) {
    const date = toIsoDate(cell(raw, r, kCol));
    const company = clean(cell(raw, r, companyCol));
    if (!date || !company) continue;

    const canxRaw = cell(raw, r, canxCol);
    const canxPresent = present(canxRaw);
    const ratingRaw = cell(raw, r, ratingCol);

    out.push({
      month: date.slice(0, 7),
      company,
      absentCount: toNumber(cell(raw, r, absentCol)),
      absentPct: toPercent(cell(raw, r, absentPctCol), cell(display, r, absentPctCol)),
      cancellationCount: canxPresent ? toNumber(canxRaw) : null,
      cancellationPct: canxPresent
        ? toPercent(cell(raw, r, canxPctCol), cell(display, r, canxPctCol))
        : null,
      avgRating: present(ratingRaw) ? toNumber(ratingRaw) : null,
    });
  }
  return out;
}

/**
 * The overall Cancellation & Release % per month, both companies combined,
 * rebuilt from the per-company rows of the MTD table. Each row's % is
 * count / bookings-assigned, so the denominator is recoverable as
 * count / (pct/100); the combined rate is sum(counts) / sum(denominators) —
 * a properly weighted total, not an average of the two companies' rates.
 * Rows with no cancellations (or a 0%) carry no recoverable denominator and
 * add nothing to the numerator, so they're skipped. A month with nothing
 * usable gets no entry, leaving any hand-entered total row in place.
 */
function cancellationPctByMonth(rows: CompanyMonthlyPerf[]): Record<string, number> {
  const acc: Record<string, { count: number; assigned: number }> = {};
  for (const r of rows) {
    if (!r.cancellationCount || !r.cancellationPct || r.cancellationPct <= 0) continue;
    const a = (acc[r.month] ??= { count: 0, assigned: 0 });
    a.count += r.cancellationCount;
    a.assigned += r.cancellationCount / (r.cancellationPct / 100);
  }
  const out: Record<string, number> = {};
  for (const [month, a] of Object.entries(acc)) {
    if (a.assigned > 0) out[month] = (a.count / a.assigned) * 100;
  }
  return out;
}

// ---------------------------------------------------------------------------
// On time %
// ---------------------------------------------------------------------------

/**
 * The "On Time %" tab holds four tables side by side, each separated from the
 * next by one empty column, and they deliberately reuse header text across
 * blocks ("Company", "Van Name", "On Time %" all appear up to four times).
 * indexHeaders() can't tell those apart, so a block is located the same way
 * parseCompanyMonthlyPerf locates the MTD table: find the n-th occurrence of
 * the block's own FIRST header, then read the rest at fixed offsets. Each
 * offset's header is checked against what's expected and a block that doesn't
 * line up is skipped with a warning rather than throwing — the tab is
 * refilled by a separate Apps Script, so a layout change there must degrade
 * to "no on-time data" and never take the dashboard down.
 */
function locateBlock(
  header: unknown[],
  labels: readonly string[],
  occurrence: number,
  what: string,
): number {
  let seen = 0;
  let start = -1;
  for (let c = 0; c < header.length; c++) {
    if (norm(header[c]) === norm(labels[0])) {
      seen++;
      if (seen === occurrence) {
        start = c;
        break;
      }
    }
  }
  if (start < 0) return -1;

  const mismatch = labels.findIndex((label, i) => norm(header[start + i]) !== norm(label));
  if (mismatch > 0) {
    console.warn(
      `[sheets] "${TABS.ONTIME}" ${what}: expected "${labels[mismatch]}" at column ` +
        `${colLetter(start + mismatch)}, found "${clean(header[start + mismatch])}" — block skipped.`,
    );
    return -1;
  }
  return start;
}

const ONTIME_VAN_DAY_HEADERS = [
  'Time - Master Date', 'Company', 'Van Name', 'Cleaners',
  'Exclusive Bookings', 'On Time #', 'Not On Time #', 'On Time %',
] as const;

const ONTIME_CLEANER_DAY_HEADERS = [
  'Time - Master Date', 'Company', 'Cleaner ID', 'Cleaner Name', 'Van Name',
  'Exclusive Bookings', 'On Time #', 'Not On Time #', 'On Time %',
] as const;

const ONTIME_VAN_MONTH_HEADERS = [
  'Time - Year Month', 'Company', 'Van Name',
  'Exclusive Bookings', 'On Time #', 'Not On Time #', 'On Time %',
] as const;

const ONTIME_CLEANER_MONTH_HEADERS = [
  'Time - Year Month', 'Company', 'Cleaner ID', 'Cleaner Name', 'Van Name',
  'Exclusive Bookings', 'On Time #', 'Not On Time #', 'On Time %',
] as const;

/** The van name used in the MTD van block for a company's whole-month total. */
const ONTIME_TOTAL_SENTINEL = 'TOTAL';

function parseOnTimeVanDaily(raw: Grid, display: Grid): OnTimeVanDay[] {
  const start = locateBlock(raw[0] || [], ONTIME_VAN_DAY_HEADERS, 1, 'Daily - Van');
  if (start < 0) return [];

  const out: OnTimeVanDay[] = [];
  for (let r = 1; r < raw.length; r++) {
    const date = toIsoDate(cell(raw, r, start));
    const company = clean(cell(raw, r, start + 1));
    const van = clean(cell(raw, r, start + 2));
    if (!date || !company || !van) continue;

    out.push({
      date,
      dateRaw: clean(cell(display, r, start)),
      company,
      van,
      cleaners: toNumber(cell(raw, r, start + 3)),
      exclusiveBookings: toNumber(cell(raw, r, start + 4)),
      onTime: toNumber(cell(raw, r, start + 5)),
      notOnTime: toNumber(cell(raw, r, start + 6)),
      onTimePct: toPercent(cell(raw, r, start + 7), cell(display, r, start + 7)),
    });
  }
  return out;
}

function parseOnTimeCleanerDaily(raw: Grid, display: Grid): OnTimeCleanerDay[] {
  const start = locateBlock(raw[0] || [], ONTIME_CLEANER_DAY_HEADERS, 2, 'Daily - Cleaner');
  if (start < 0) return [];

  const out: OnTimeCleanerDay[] = [];
  for (let r = 1; r < raw.length; r++) {
    const date = toIsoDate(cell(raw, r, start));
    const company = clean(cell(raw, r, start + 1));
    const cleanerName = clean(cell(raw, r, start + 3));
    if (!date || !company || !cleanerName) continue;

    out.push({
      date,
      dateRaw: clean(cell(display, r, start)),
      company,
      cleanerId: clean(cell(raw, r, start + 2)),
      cleanerName,
      van: clean(cell(raw, r, start + 4)),
      exclusiveBookings: toNumber(cell(raw, r, start + 5)),
      onTime: toNumber(cell(raw, r, start + 6)),
      notOnTime: toNumber(cell(raw, r, start + 7)),
      onTimePct: toPercent(cell(raw, r, start + 8), cell(display, r, start + 8)),
    });
  }
  return out;
}

/** Both MTD blocks, concatenated — van-level (plus company TOTAL rows) then cleaner-level. */
function parseOnTimeMonthly(raw: Grid, display: Grid): OnTimeMonthly[] {
  const header = raw[0] || [];
  const out: OnTimeMonthly[] = [];

  const vanStart = locateBlock(header, ONTIME_VAN_MONTH_HEADERS, 1, 'MTD - Van');
  if (vanStart >= 0) {
    for (let r = 1; r < raw.length; r++) {
      const date = toIsoDate(cell(raw, r, vanStart));
      const company = clean(cell(raw, r, vanStart + 1));
      const van = clean(cell(raw, r, vanStart + 2));
      if (!date || !company || !van) continue;

      const isTotal = van.toUpperCase() === ONTIME_TOTAL_SENTINEL;
      out.push({
        month: date.slice(0, 7),
        company,
        level: isTotal ? 'company' : 'van',
        cleanerId: '',
        cleanerName: '',
        van: isTotal ? '' : van,
        exclusiveBookings: toNumber(cell(raw, r, vanStart + 3)),
        onTime: toNumber(cell(raw, r, vanStart + 4)),
        notOnTime: toNumber(cell(raw, r, vanStart + 5)),
        onTimePct: toPercent(cell(raw, r, vanStart + 6), cell(display, r, vanStart + 6)),
      });
    }
  }

  const cleanerStart = locateBlock(header, ONTIME_CLEANER_MONTH_HEADERS, 2, 'MTD - Cleaner');
  if (cleanerStart >= 0) {
    for (let r = 1; r < raw.length; r++) {
      const date = toIsoDate(cell(raw, r, cleanerStart));
      const company = clean(cell(raw, r, cleanerStart + 1));
      const cleanerName = clean(cell(raw, r, cleanerStart + 3));
      if (!date || !company || !cleanerName) continue;

      out.push({
        month: date.slice(0, 7),
        company,
        level: 'cleaner',
        cleanerId: clean(cell(raw, r, cleanerStart + 2)),
        cleanerName,
        van: clean(cell(raw, r, cleanerStart + 4)),
        exclusiveBookings: toNumber(cell(raw, r, cleanerStart + 5)),
        onTime: toNumber(cell(raw, r, cleanerStart + 6)),
        notOnTime: toNumber(cell(raw, r, cleanerStart + 7)),
        onTimePct: toPercent(cell(raw, r, cleanerStart + 8), cell(display, r, cleanerStart + 8)),
      });
    }
  }

  return out;
}

/**
 * Cancellations has no "Company" column of its own, so each row's company
 * is looked up against Company Performance's own van-name -> company map,
 * falling back to cleaner-name -> company when the van isn't found there.
 * Real data confirms this reaches every row (van name is the more reliable
 * key; cleaner name catches the few it misses).
 */
function buildCompanyMaps(rows: CompanyPerfRow[]): {
  vanToCompany: Map<string, string>;
  cleanerToCompany: Map<string, string>;
} {
  const vanToCompany = new Map<string, string>();
  const cleanerToCompany = new Map<string, string>();
  for (const r of rows) {
    if (r.van && r.company && !vanToCompany.has(r.van)) vanToCompany.set(r.van, r.company);
    if (r.cleanerName && r.company && !cleanerToCompany.has(r.cleanerName)) {
      cleanerToCompany.set(r.cleanerName, r.company);
    }
  }
  return { vanToCompany, cleanerToCompany };
}

export async function readWorkbook(): Promise<WorkbookResult> {
  const wb = await fetchWorkbook();
  const responses = parseResponses(wb.responses.raw);

  const companyPerf = parseCompanyPerf(wb.companyPerf.raw, wb.companyPerf.display);
  const companyMonthly = parseCompanyMonthlyPerf(wb.companyPerf.raw, wb.companyPerf.display);
  const onTimeVanDaily = parseOnTimeVanDaily(wb.onTime.raw, wb.onTime.display);
  const onTimeCleanerDaily = parseOnTimeCleanerDaily(wb.onTime.raw, wb.onTime.display);
  const onTimeMonthly = parseOnTimeMonthly(wb.onTime.raw, wb.onTime.display);
  const { vanToCompany, cleanerToCompany } = buildCompanyMaps(companyPerf);
  const companyForCanx = (van: string, cleaner: string): string =>
    vanToCompany.get(van) || cleanerToCompany.get(cleaner) || '';

  // ---- Cash ----
  const cash: CashRow[] = [];
  if (wb.cash.raw.length >= 2) {
    const idx = indexHeaders(wb.cash.raw[0], CASH_SPEC);
    if (idx.date < 0 || idx.ref < 0) {
      throw new SheetsConfigError(
        `"${TABS.CASH}" needs at least a "Start Date" and "Reference Code" column.`,
      );
    }
    for (let r = 1; r < wb.cash.raw.length; r++) {
      const ref = clean(cell(wb.cash.raw, r, idx.ref));
      const date = toIsoDate(cell(wb.cash.raw, r, idx.date));
      if (!ref && !date) continue;

      const key = cashKey(date, ref);
      const resp = responses.get(key);

      cash.push({
        key,
        section: 'CASH',
        date,
        dateRaw: clean(cell(wb.cash.display, r, idx.date)),
        ref,
        amount: toNumber(cell(wb.cash.raw, r, idx.amount)),
        status: normaliseStatus(resp?.status ?? clean(cell(wb.cash.raw, r, idx.status))),
        ticket: normaliseTicket(resp?.ticket ?? clean(cell(wb.cash.raw, r, idx.ticket))),
        reason: resp?.reason || clean(cell(wb.cash.raw, r, idx.reason)),
        // Finance's own note — always read straight from the sheet. Nothing
        // in _Responses ever overrides it; this app never writes this column.
        financeComment: clean(cell(wb.cash.raw, r, idx.financeComment)),
        financeResponse: resp?.financeResponse || clean(cell(wb.cash.raw, r, idx.financeResponse)),
        updatedBy: resp?.updatedBy || clean(cell(wb.cash.raw, r, idx.updatedBy)),
        updatedAt: resp?.updatedAt || clean(cell(wb.cash.display, r, idx.updatedAt)),
      });
    }
  }

  // ---- Cancellations ----
  const canx: CanxRow[] = [];
  const canxMonthlyPct: Record<string, number> = {};

  if (wb.canx.raw.length >= 2) {
    const idx = indexHeaders(wb.canx.raw[0], CANX_SPEC);
    if (idx.date < 0 || idx.code < 0) {
      throw new SheetsConfigError(
        `"${TABS.CANX}" needs at least a master date and "Appointment Code" column.`,
      );
    }

    // Tracks which month "owns" a total row as we scan top to bottom — the
    // month of the most recent real data row seen so far. See canxMonthlyPct
    // above for why this makes a total row's position (not its content) the
    // thing that fixes its meaning.
    let currentDataMonth = '';

    for (let r = 1; r < wb.canx.raw.length; r++) {
      const code = clean(cell(wb.canx.raw, r, idx.code));
      const date = toIsoDate(cell(wb.canx.raw, r, idx.date));

      if (!code && !date) {
        // Candidate total row: every identifying column blank.
        const pctCell = idx.pct >= 0 ? cell(wb.canx.raw, r, idx.pct) : '';
        const pctPresent = pctCell !== '' && pctCell !== null && pctCell !== undefined;
        if (pctPresent && currentDataMonth) {
          // Last one wins if a month somehow gets more than one — that's
          // the most recently written value for that month.
          canxMonthlyPct[currentDataMonth] = toPercent(pctCell, cell(wb.canx.display, r, idx.pct));
        }
        continue; // never a visible row, same as before
      }

      if (date) currentDataMonth = date.slice(0, 7);

      const cleaner = clean(cell(wb.canx.raw, r, idx.cleaner));
      const van = clean(cell(wb.canx.raw, r, idx.van));
      const key = canxKey(date, code, cleaner);
      const resp = responses.get(key);

      canx.push({
        key,
        section: 'CANX',
        date,
        dateRaw: clean(cell(wb.canx.display, r, idx.date)),
        code,
        cleaner,
        van,
        count: idx.count >= 0 ? toNumber(cell(wb.canx.raw, r, idx.count)) || 1 : 1,
        pct: toPercent(cell(wb.canx.raw, r, idx.pct), cell(wb.canx.display, r, idx.pct)),
        reason: resp?.reason || clean(cell(wb.canx.raw, r, idx.reason)),
        screenshot: resp?.screenshot || clean(cell(wb.canx.raw, r, idx.screenshot)),
        updatedBy: resp?.updatedBy || clean(cell(wb.canx.raw, r, idx.updatedBy)),
        updatedAt: resp?.updatedAt || clean(cell(wb.canx.display, r, idx.updatedAt)),
        company: companyForCanx(van, cleaner),
      });
    }
  }

  // The Company Performance MTD table is the maintained source for the
  // monthly rate; a hand-entered total row in Cancellations only fills a
  // month that table doesn't cover.
  Object.assign(canxMonthlyPct, cancellationPctByMonth(companyMonthly));

  const canxTotalPct = canxMonthlyPct[todayIso().slice(0, 7)] ?? null;

  return {
    cash,
    canx,
    canxTotalPct,
    canxMonthlyPct,
    companyPerf,
    companyMonthly,
    onTimeVanDaily,
    onTimeCleanerDaily,
    onTimeMonthly,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface EntryPatch {
  status?: string;
  ticket?: string;
  reason?: string;
  screenshot?: string;
  financeResponse?: string;
}

export interface SaveResult {
  key: string;
  status: string;
  ticket: string;
  reason: string;
  screenshot: string;
  financeResponse: string;
  updatedBy: string;
  updatedAt: string;
}

/**
 * Writes an answer to `_Responses` (the durable, key-addressed record) and
 * mirrors it into the visible tab. `_Responses` is authoritative precisely so
 * that re-pasting the daily export over "Cash Collection" cannot destroy work
 * the Perfect Choice team already did.
 */
export async function saveEntry(args: {
  section: Section;
  key: string;
  patch: EntryPatch;
  actor: string;
  role: Role;
}): Promise<SaveResult> {
  const { section, key, patch, actor, role } = args;
  const api = sheetsClient();

  await ensureTab(TABS.RESPONSES, RESPONSE_HEADERS);

  const respRange = `${quoteTab(TABS.RESPONSES)}!A1:Z`;
  const respRes = await api.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: respRange,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const respGrid = (respRes.data.values as Grid) || [];

  const headerRow = respGrid[0]?.length ? respGrid[0] : RESPONSE_HEADERS;
  const idx = indexHeaders(headerRow, RESP_SPEC);
  const existing = parseResponses(respGrid).get(key);

  const before = {
    status: existing?.status ?? '',
    ticket: existing?.ticket ?? '',
    reason: existing?.reason ?? '',
    screenshot: existing?.screenshot ?? '',
    financeResponse: existing?.financeResponse ?? '',
  };

  const next = {
    status: patch.status !== undefined ? clean(patch.status) : before.status,
    ticket: patch.ticket !== undefined ? clean(patch.ticket) : before.ticket,
    reason: patch.reason !== undefined ? clean(patch.reason) : before.reason,
    screenshot: patch.screenshot !== undefined ? clean(patch.screenshot) : before.screenshot,
    financeResponse:
      patch.financeResponse !== undefined ? clean(patch.financeResponse) : before.financeResponse,
  };

  // Collected cash cannot carry a ticket or a why-it-failed reason.
  if (section === 'CASH' && next.status === 'Collected') {
    next.ticket = '';
    next.reason = '';
  }

  const stamp = nowStamp();
  const width = Math.max(headerRow.length, RESPONSE_HEADERS.length);
  const rowValues: string[] = new Array(width).fill('');
  const put = (i: number, v: string) => {
    if (i >= 0 && i < width) rowValues[i] = v;
  };
  put(idx.key, key);
  put(idx.section, section);
  put(idx.status, next.status);
  put(idx.ticket, next.ticket);
  put(idx.reason, next.reason);
  put(idx.screenshot, next.screenshot);
  put(idx.financeResponse, next.financeResponse);
  put(idx.updatedBy, actor);
  put(idx.updatedAt, stamp);

  if (existing) {
    await api.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${quoteTab(TABS.RESPONSES)}!A${existing.row}:${colLetter(width - 1)}${existing.row}`,
      valueInputOption: 'RAW',
      requestBody: { values: [rowValues] },
    });
  } else {
    await api.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: respRange,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowValues] },
    });
  }

  // Mirroring and auditing are convenience layers — never fail the save on
  // them. But "never fail" doesn't mean "never find out": a rejection here
  // (e.g. a protected range on the source tab silently blocking the mirror)
  // used to vanish with zero trace. Logging it costs nothing and is how this
  // exact failure mode — Cash Collection columns A-H protected against the
  // service account — got diagnosed.
  const settled = await Promise.allSettled([
    mirrorToSourceTab(section, key, next, actor, stamp),
    appendAudit(section, key, before, next, role, actor, stamp),
  ]);
  const stepNames = ['mirrorToSourceTab', 'appendAudit'];
  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      console.error(`[saveEntry] ${stepNames[i]} failed for ${key}:`, s.reason);
    }
  });

  return { key, ...next, updatedBy: actor, updatedAt: stamp };
}

async function mirrorToSourceTab(
  section: Section,
  key: string,
  next: Required<EntryPatch>,
  actor: string,
  stamp: string,
): Promise<void> {
  const api = sheetsClient();
  const isCash = section === 'CASH';
  const tab = isCash ? TABS.CASH : TABS.CANX;

  const res = await api.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${quoteTab(tab)}!A1:Z`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const grid = (res.data.values as Grid) || [];
  if (grid.length < 2) return;

  // Widened to Record<string, number>: the two specs have different key sets,
  // and the union type would reject every field that is not common to both.
  const spec: Record<string, string[]> = isCash ? CASH_SPEC : CANX_SPEC;
  const idx: Record<string, number> = indexHeaders(grid[0], spec);

  let targetRow = -1;
  for (let r = 1; r < grid.length; r++) {
    const date = toIsoDate(cell(grid, r, idx.date));
    const rowKey = isCash
      ? cashKey(date, clean(cell(grid, r, idx.ref)))
      : canxKey(date, clean(cell(grid, r, idx.code)), clean(cell(grid, r, idx.cleaner)));
    if (rowKey === key) {
      targetRow = r + 1;
      break;
    }
  }
  if (targetRow === -1) return;

  const writes: { col: number; value: string }[] = isCash
    ? [
        { col: idx.status, value: next.status },
        { col: idx.ticket, value: next.ticket },
        { col: idx.reason, value: next.reason },
        { col: idx.financeResponse, value: next.financeResponse },
      ]
    : [
        { col: idx.reason, value: next.reason },
        { col: (idx as Record<string, number>).screenshot, value: next.screenshot },
      ];

  writes.push({ col: idx.updatedBy, value: actor });
  writes.push({ col: idx.updatedAt, value: stamp });

  const data = writes
    .filter((w) => w.col >= 0)
    .map((w) => ({
      range: `${quoteTab(tab)}!${colLetter(w.col)}${targetRow}`,
      values: [[w.value]],
    }));

  if (!data.length) return;

  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

async function appendAudit(
  section: Section,
  key: string,
  before: Required<EntryPatch>,
  after: Required<EntryPatch>,
  role: Role,
  actor: string,
  stamp: string,
): Promise<void> {
  const changed = (['status', 'ticket', 'reason', 'screenshot', 'financeResponse'] as const)
    .filter((f) => (before[f] || '') !== (after[f] || ''))
    .map((f) => [stamp, section, key, f, before[f] || '', after[f] || '', ROLE_LABELS[role], actor]);

  if (!changed.length) return;

  await ensureTab(TABS.AUDIT, AUDIT_HEADERS);
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${quoteTab(TABS.AUDIT)}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: changed },
  });
}
