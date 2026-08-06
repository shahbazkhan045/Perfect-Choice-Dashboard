/**
 * Google's serial date epoch. Sheets counts days from 30 Dec 1899.
 */
const SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Read lazily rather than importing config.ts, so the pure formatting helpers
 * in this file stay usable from client components without dragging the whole
 * server configuration module into the browser bundle.
 */
const TIMEZONE = process.env.DASHBOARD_TIMEZONE || 'Asia/Dubai';
const DATE_TEXT_ORDER: 'DMY' | 'MDY' = process.env.DATE_TEXT_ORDER === 'MDY' ? 'MDY' : 'DMY';

/**
 * Today in the dashboard timezone as yyyy-MM-dd.
 * en-CA formats as yyyy-MM-dd, which is exactly the shape we want.
 */
export function todayIso(tz: string = TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return isoFromUtc(dt);
}

function isoFromUtc(dt: Date): string {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Resolves a sheet cell into a yyyy-MM-dd string.
 *
 * The Sheets API is read with valueRenderOption=UNFORMATTED_VALUE and
 * dateTimeRenderOption=SERIAL_NUMBER, so a genuine date cell arrives as a
 * number and carries no ambiguity at all. Only plain text falls back to
 * DATE_TEXT_ORDER — which is why this sheet can hold a mix of "01/08/2026"
 * typed as text and "08/03/2026" stored as a real date, and both land on the
 * correct day.
 */
export function toIsoDate(cell: unknown): string {
  if (typeof cell === 'number' && isFinite(cell) && cell > 0) {
    return isoFromUtc(new Date(SHEETS_EPOCH_UTC + Math.floor(cell) * 86400000));
  }

  const s = String(cell ?? '').trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
  }

  const slash = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;

    let day: number;
    let month: number;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      month = a;
      day = b;
    } else if (DATE_TEXT_ORDER === 'MDY') {
      month = a;
      day = b;
    } else {
      day = a;
      month = b;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${y}-${pad(month)}-${pad(day)}`;
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return '';
}

function pad(v: string | number): string {
  return String(v).padStart(2, '0');
}

/** yyyy-MM-dd -> DD/MM/YYYY */
export function formatDmy(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function toNumber(cell: unknown): number {
  if (typeof cell === 'number') return isFinite(cell) ? cell : 0;
  const cleaned = String(cell ?? '').replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

/**
 * Percent cells are awkward: a cell formatted as 100.00% comes back as the
 * number 1 when unformatted, but as the string "100.00%" when formatted.
 */
export function toPercent(raw: unknown, display: unknown): number {
  const disp = String(display ?? '').trim();
  if (disp.includes('%')) {
    const n = parseFloat(disp.replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : 0;
  }
  const v = toNumber(raw);
  return v <= 1 ? v * 100 : v;
}

export function clean(cell: unknown): string {
  return String(cell ?? '').trim();
}

export function nowStamp(tz: string = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/**
 * Renders an "Updated At" cell for display.
 *
 * New writes go in as text, but rows written by the earlier Apps Script version
 * are real datetime cells, which the API returns as bare serial numbers like
 * 46234.52. Those would otherwise show up in the UI as a meaningless number.
 * A serial carries no timezone, so it is formatted with UTC getters — the value
 * is already wall-clock time in the sheet's own zone.
 */
export function formatStampCell(cellValue: unknown): string {
  const s = String(cellValue ?? '').trim();
  if (!s) return '';
  if (!/^\d+(\.\d+)?$/.test(s)) return s;

  const serial = Number(s);
  if (!isFinite(serial) || serial <= 0) return s;

  const d = new Date(SHEETS_EPOCH_UTC + Math.round(serial * 86400000));
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const hasTime = serial % 1 !== 0;
  return hasTime ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}

/** Whole days between two yyyy-MM-dd strings. */
export function daysBetween(fromIso: string, toIsoStr: string): number {
  if (!fromIso || !toIsoStr) return 0;
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIsoStr.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}
