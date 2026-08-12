#!/usr/bin/env node
/**
 * One-time migration for the Finance Comments feature. Adds:
 *   - "Perfect Choice Response" as a new column at the end of "Cash Collection"
 *   - "Finance Response" as a new column at the end of "_Responses"
 *
 * Idempotent — safe to re-run. If a header with that name already exists
 * (by the app's own normalisation rule) it's left untouched, so this can't
 * duplicate the column on a second run.
 *
 *   node --env-file=.env.local scripts/add-finance-response-column.mjs
 */

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Mirrors src/lib/sheets.ts's norm() so "already exists" checks agree with
// what the app itself would match.
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/%/g, 'pct')
    .replace(/[^a-z0-9]/g, '');
}

function colLetter(index0) {
  let n = index0 + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

async function ensureColumn(tabName, headerName, aliases) {
  const quoted = `'${tabName.replace(/'/g, "''")}'`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${quoted}!A1:Z1`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const header = res.data.values?.[0] || [];
  const normalized = header.map(norm);

  const already = aliases.some((a) => normalized.includes(norm(a)));
  if (already) {
    console.log(`  ${tabName}: already has a matching column, nothing to do.`);
    return;
  }

  const nextCol = header.length; // 0-based index of the first empty column
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${quoted}!${colLetter(nextCol)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [[headerName]] },
  });
  console.log(`  ${tabName}: added "${headerName}" in column ${colLetter(nextCol)}.`);
}

console.log('Finance Comments migration\n');
await ensureColumn('Cash Collection', 'Perfect Choice Response', [
  'Perfect Choice Response',
  'PC Response',
  'Finance Response',
]);
await ensureColumn('_Responses', 'Finance Response', ['Finance Response', 'Perfect Choice Response']);
console.log('\nDone.');
