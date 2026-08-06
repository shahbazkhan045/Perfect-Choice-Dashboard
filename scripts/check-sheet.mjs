#!/usr/bin/env node
/**
 * Diagnoses the Google Sheets connection without starting the app.
 *
 *   node --env-file=.env.local scripts/check-sheet.mjs
 *
 * Tells you exactly which setup step is missing, rather than a raw API error.
 */

import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
const sheetId = process.env.GOOGLE_SHEET_ID;

/** 0-based column index -> A1 letter. */
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

function fail(message, hint) {
  console.error(`\n  FAILED  ${message}`);
  if (hint) console.error(`\n  ${hint}`);
  console.error('');
  process.exit(1);
}

if (!email) fail('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in .env.local');
if (!rawKey) fail('GOOGLE_PRIVATE_KEY is not set in .env.local');
if (!sheetId) fail('GOOGLE_SHEET_ID is not set in .env.local');

const key = rawKey.includes('\\n') ? rawKey.replace(/\\n/g, '\n') : rawKey;

if (!key.includes('BEGIN PRIVATE KEY')) {
  fail(
    'GOOGLE_PRIVATE_KEY does not look like a private key.',
    'Re-run: powershell -ExecutionPolicy Bypass -File scripts\\import-service-account.ps1',
  );
}

console.log(`\n  Service account : ${email}`);
console.log(`  Spreadsheet     : ${sheetId}\n`);

const auth = new JWT({
  email,
  key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

try {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'properties.title,sheets.properties(title,gridProperties)',
  });

  const title = meta.data.properties?.title;
  const tabs = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);

  console.log(`  OK  Connected to "${title}"`);
  console.log(`  OK  Tabs: ${tabs.join(', ')}\n`);

  for (const [label, envVar, fallback] of [
    ['Cash', 'SHEET_TAB_CASH', 'Cash Collection'],
    ['Cancellations', 'SHEET_TAB_CANX', 'Cancellations'],
  ]) {
    const wanted = process.env[envVar] || fallback;
    if (!tabs.includes(wanted)) {
      fail(
        `No tab named "${wanted}" (needed for ${label}).`,
        `Rename the tab, or set ${envVar} in .env.local to one of: ${tabs.join(', ')}`,
      );
    }
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${wanted.replace(/'/g, "''")}'!A1:Z`,
    });
    const count = Math.max(0, (rows.data.values?.length || 0) - 1);
    console.log(`  OK  "${wanted}" -> ${count} data row${count === 1 ? '' : 's'}`);
  }

  // Write access is required; a Viewer-only share reads fine and then fails on
  // the team's first save. Probe it now rather than discovering it later.
  //
  // The probe writes the sheet's own last grid cell back to itself: a true
  // no-op on content, but still permission-gated. Targeting a cell outside the
  // grid instead would fail with "exceeds grid limits" on an Editor share too,
  // and report a false negative.
  process.stdout.write('\n  Checking write access... ');

  const cashTab = process.env.SHEET_TAB_CASH || 'Cash Collection';
  const grid = (meta.data.sheets || []).find((s) => s.properties?.title === cashTab)
    ?.properties?.gridProperties;
  const lastRow = grid?.rowCount || 1000;
  const lastCol = grid?.columnCount || 26;
  const quoted = `'${cashTab.replace(/'/g, "''")}'`;
  const probe = `${quoted}!${colLetter(lastCol - 1)}${lastRow}`;

  try {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: probe,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const current = existing.data.values?.[0]?.[0] ?? '';

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: probe,
      valueInputOption: 'RAW',
      requestBody: { values: [[current]] },
    });
    console.log('OK (Editor)\n');
  } catch (err) {
    const m = err?.message || String(err);
    console.log('NO\n');
    if (/permission|caller does not have|forbidden|not authorized/i.test(m)) {
      fail(
        'The service account can read the sheet but not write to it.',
        `Open Share on the sheet, find ${email}, and change Viewer to EDITOR.`,
      );
    }
    fail(`Write probe failed for an unexpected reason: ${m}`);
  }

  console.log('  Everything is connected. Start the app with:  npm run dev\n');
} catch (err) {
  const message = err?.message || String(err);

  if (/permission|caller does not have|forbidden/i.test(message)) {
    fail(
      'The service account cannot open the spreadsheet.',
      `Open the sheet, click Share, add this address as EDITOR:\n\n    ${email}`,
    );
  }
  if (/not found/i.test(message)) {
    fail('No spreadsheet with that id.', 'Check GOOGLE_SHEET_ID in .env.local.');
  }
  if (/has not been used|disabled|SERVICE_DISABLED/i.test(message)) {
    fail(
      'The Google Sheets API is not enabled on this Cloud project.',
      'Console -> APIs & Services -> Library -> Google Sheets API -> Enable, then wait a minute.',
    );
  }
  if (/invalid_grant|DECODER|PEM|asn1/i.test(message)) {
    fail(
      'The private key was not accepted.',
      'Re-run: powershell -ExecutionPolicy Bypass -File scripts\\import-service-account.ps1',
    );
  }
  fail(message);
}
