#!/usr/bin/env node
/**
 * Repairs date cells whose day and month were swapped when a DD/MM export was
 * pasted into an MM/DD-locale spreadsheet.
 *
 *   node --env-file=.env.local scripts/fix-swapped-dates.mjs            # dry run
 *   node --env-file=.env.local scripts/fix-swapped-dates.mjs --apply    # write
 *   node --env-file=.env.local scripts/fix-swapped-dates.mjs --apply --locale --format
 *
 * --locale sets the spreadsheet to en_GB so future DD/MM pastes parse correctly.
 * --format sets the date columns to a dd/mm/yyyy pattern. Both are needed: an
 * explicit number format overrides the locale, so changing locale alone leaves
 * existing columns still displaying mm/dd/yyyy. --format is display-only and
 * never alters a stored value.
 *
 * A row is only ever proposed when BOTH hold:
 *   1. its current date falls OUTSIDE the sheet's real operating window, and
 *   2. swapping day and month lands it INSIDE that window.
 *
 * So a correctly-dated row can never be "corrected", and an ambiguous one is
 * left alone rather than guessed at.
 */

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const SET_LOCALE = process.argv.includes('--locale');
const SET_FORMAT = process.argv.includes('--format');

const windowArg = process.argv.find((a) => a.startsWith('--from='));
const FROM = windowArg ? windowArg.slice(7) : '2026-07-31';
const TO = new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.DASHBOARD_TIMEZONE || 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const EPOCH = Date.UTC(1899, 11, 30);

const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function serialToIso(serial) {
  return iso(new Date(EPOCH + Math.floor(serial) * 86400000));
}

function isoToSerial(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 86400000);
}

/** Swaps day and month, returning null when the result is not a real date. */
function swapDayMonth(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (d < 1 || d > 12) return null; // day cannot become a month
  const candidate = new Date(Date.UTC(y, d - 1, m));
  if (candidate.getUTCMonth() !== d - 1 || candidate.getUTCDate() !== m) return null;
  return iso(candidate);
}

const inWindow = (s) => s >= FROM && s <= TO;

function colLetter(i) {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const TABS = [
  { name: process.env.SHEET_TAB_CASH || 'Cash Collection', dateHeader: 'start date', label: 'Cash' },
  {
    name: process.env.SHEET_TAB_CANX || 'Cancellations',
    dateHeader: 'time - master date',
    label: 'Cancellations',
  },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

console.log(`\n  Operating window : ${FROM} .. ${TO}`);
console.log(`  Mode             : ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no changes)'}\n`);

let totalPlanned = 0;

for (const tab of TABS) {
  const quoted = `'${tab.name.replace(/'/g, "''")}'`;

  const [raw, shown] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${quoted}!A1:Z`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${quoted}!A1:Z`,
      valueRenderOption: 'FORMATTED_VALUE',
    }),
  ]);

  const grid = raw.data.values || [];
  const disp = shown.data.values || [];
  if (grid.length < 2) continue;

  const headers = grid[0].map(norm);
  const col = headers.indexOf(norm(tab.dateHeader));
  if (col === -1) {
    console.log(`  ${tab.label}: no "${tab.dateHeader}" column, skipped\n`);
    continue;
  }

  const changes = [];
  for (let r = 1; r < grid.length; r++) {
    const cell = grid[r]?.[col];
    if (typeof cell !== 'number') continue; // text dates are not this bug

    const current = serialToIso(cell);
    if (inWindow(current)) continue;

    const swapped = swapDayMonth(current);
    if (!swapped || !inWindow(swapped)) continue;

    changes.push({
      row: r + 1,
      shows: disp[r]?.[col] ?? '',
      from: current,
      to: swapped,
      ref: grid[r]?.[1] ?? '',
    });
  }

  console.log(`  ${tab.label} — ${changes.length} row${changes.length === 1 ? '' : 's'} to correct`);
  for (const c of changes) {
    console.log(
      `    row ${String(c.row).padStart(3)}  ${String(c.ref).padEnd(10)} shows ${c.shows.padEnd(12)} ${c.from}  ->  ${c.to}`,
    );
  }
  console.log('');

  totalPlanned += changes.length;

  if (APPLY && SET_FORMAT) {
    // Display-only. An explicit pattern beats the spreadsheet locale, so this
    // is what actually makes the column read as DD/MM for a human.
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: 'sheets.properties(title,sheetId,gridProperties.rowCount)',
    });
    const props = (meta.data.sheets || []).find((s) => s.properties?.title === tab.name)?.properties;

    if (props?.sheetId != null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: props.sheetId,
                  startRowIndex: 1,
                  endRowIndex: props.gridProperties?.rowCount || 1000,
                  startColumnIndex: col,
                  endColumnIndex: col + 1,
                },
                cell: {
                  userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } },
                },
                fields: 'userEnteredFormat.numberFormat',
              },
            },
          ],
        },
      });
      console.log(`    ${tab.label} date column now displays dd/mm/yyyy`);
    }
  }

  if (APPLY && changes.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        // RAW + serial keeps the cell a real date and preserves its number format.
        valueInputOption: 'RAW',
        data: changes.map((c) => ({
          range: `${quoted}!${colLetter(col)}${c.row}`,
          values: [[isoToSerial(c.to)]],
        })),
      },
    });
    console.log(`    written to ${tab.label}\n`);
  }
}

if (SET_LOCALE && APPLY) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          updateSpreadsheetProperties: {
            properties: { locale: 'en_GB' },
            fields: 'locale',
          },
        },
      ],
    },
  });
  console.log('  Spreadsheet locale set to en_GB (dates now display and paste as DD/MM/YYYY)\n');
}

if (!APPLY) {
  console.log(
    totalPlanned
      ? `  ${totalPlanned} row(s) would change. Re-run with --apply --locale to write.\n`
      : '  Nothing to correct.\n',
  );
} else {
  console.log(`  Done. ${totalPlanned} row(s) corrected.\n`);
}
