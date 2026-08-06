#!/usr/bin/env node
/**
 * Generates the three secret access tokens and prints them ready to paste.
 *
 *   npm run tokens
 *
 * Anyone holding a link has that role, so treat the links like passwords.
 * Re-running produces new values — old links stop working once you update the
 * environment variables in Vercel and redeploy.
 */

import { randomBytes } from 'node:crypto';

const base = process.argv[2] || 'https://YOUR-APP.vercel.app';

const roles = [
  ['TOKEN_JUSTLIFE_ADMIN', 'Justlife Admin — full access, can send reminders'],
  ['TOKEN_PC_ADMIN', 'Perfect Choice Admin — can update statuses and reasons'],
  ['TOKEN_VIEWER', 'View only — can read and download, cannot change anything'],
];

const generated = roles.map(([name, description]) => ({
  name,
  description,
  value: randomBytes(24).toString('base64url'),
}));

console.log('\nEnvironment variables — add these in Vercel → Settings → Environment Variables:\n');
for (const t of generated) {
  console.log(`${t.name}=${t.value}`);
}

console.log('\n\nLinks to share:\n');
for (const t of generated) {
  console.log(`  ${t.description}`);
  console.log(`  ${base.replace(/\/+$/, '')}/?k=${t.value}\n`);
}

console.log(
  'Once the link is opened, the token moves into a private cookie and disappears\n' +
    'from the address bar, so it will not leak through screenshots or browser history.\n',
);
