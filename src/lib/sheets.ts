import { google, type sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { SHEET_ID, TABS } from './config';
import { clean, formatStampCell, nowStamp, toIsoDate, toNumber, toPercent } from './parse';
import type { CanxRow, CashRow, Role, Section } from './types';
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

const RESP_SPEC = {
  key: ['Key'],
  section: ['Section'],
  status: ['Status'],
  ticket: ['Ticket Raised', 'Ticket Raised?'],
  reason: ['Reason'],
  screenshot: ['Screenshot URL', 'Screenshot'],
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
  updatedBy: string;
  updatedAt: string;
}

interface RawWorkbook {
  cash: { raw: Grid; display: Grid };
  canx: { raw: Grid; display: Grid };
  responses: { raw: Grid };
}

async function fetchWorkbook(): Promise<RawWorkbook> {
  await assertSourceTabs();
  await ensureTab(TABS.RESPONSES, RESPONSE_HEADERS);

  const api = sheetsClient();
  const ranges = [
    `${quoteTab(TABS.CASH)}!A1:Z`,
    `${quoteTab(TABS.CANX)}!A1:Z`,
    `${quoteTab(TABS.RESPONSES)}!A1:Z`,
  ];

  const [unformatted, formatted] = await Promise.all([
    api.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    }),
    api.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: ranges.slice(0, 2),
      valueRenderOption: 'FORMATTED_VALUE',
    }),
  ]);

  const u = unformatted.data.valueRanges || [];
  const f = formatted.data.valueRanges || [];

  return {
    cash: { raw: (u[0]?.values as Grid) || [], display: (f[0]?.values as Grid) || [] },
    canx: { raw: (u[1]?.values as Grid) || [], display: (f[1]?.values as Grid) || [] },
    responses: { raw: (u[2]?.values as Grid) || [] },
  };
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

export async function readWorkbook(): Promise<{ cash: CashRow[]; canx: CanxRow[] }> {
  const wb = await fetchWorkbook();
  const responses = parseResponses(wb.responses.raw);

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
        updatedBy: resp?.updatedBy || clean(cell(wb.cash.raw, r, idx.updatedBy)),
        updatedAt: resp?.updatedAt || clean(cell(wb.cash.display, r, idx.updatedAt)),
      });
    }
  }

  // ---- Cancellations ----
  const canx: CanxRow[] = [];
  if (wb.canx.raw.length >= 2) {
    const idx = indexHeaders(wb.canx.raw[0], CANX_SPEC);
    if (idx.date < 0 || idx.code < 0) {
      throw new SheetsConfigError(
        `"${TABS.CANX}" needs at least a master date and "Appointment Code" column.`,
      );
    }
    for (let r = 1; r < wb.canx.raw.length; r++) {
      const code = clean(cell(wb.canx.raw, r, idx.code));
      const date = toIsoDate(cell(wb.canx.raw, r, idx.date));
      if (!code && !date) continue;

      const cleaner = clean(cell(wb.canx.raw, r, idx.cleaner));
      const key = canxKey(date, code, cleaner);
      const resp = responses.get(key);

      canx.push({
        key,
        section: 'CANX',
        date,
        dateRaw: clean(cell(wb.canx.display, r, idx.date)),
        code,
        cleaner,
        van: clean(cell(wb.canx.raw, r, idx.van)),
        count: idx.count >= 0 ? toNumber(cell(wb.canx.raw, r, idx.count)) || 1 : 1,
        pct: toPercent(cell(wb.canx.raw, r, idx.pct), cell(wb.canx.display, r, idx.pct)),
        reason: resp?.reason || clean(cell(wb.canx.raw, r, idx.reason)),
        screenshot: resp?.screenshot || clean(cell(wb.canx.raw, r, idx.screenshot)),
        updatedBy: resp?.updatedBy || clean(cell(wb.canx.raw, r, idx.updatedBy)),
        updatedAt: resp?.updatedAt || clean(cell(wb.canx.display, r, idx.updatedAt)),
      });
    }
  }

  return { cash, canx };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface EntryPatch {
  status?: string;
  ticket?: string;
  reason?: string;
  screenshot?: string;
}

export interface SaveResult {
  key: string;
  status: string;
  ticket: string;
  reason: string;
  screenshot: string;
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
  };

  const next = {
    status: patch.status !== undefined ? clean(patch.status) : before.status,
    ticket: patch.ticket !== undefined ? clean(patch.ticket) : before.ticket,
    reason: patch.reason !== undefined ? clean(patch.reason) : before.reason,
    screenshot: patch.screenshot !== undefined ? clean(patch.screenshot) : before.screenshot,
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

  // Mirroring and auditing are convenience layers — never fail the save on them.
  await Promise.allSettled([
    mirrorToSourceTab(section, key, next, actor, stamp),
    appendAudit(section, key, before, next, role, actor, stamp),
  ]);

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
  const changed = (['status', 'ticket', 'reason', 'screenshot'] as const)
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
