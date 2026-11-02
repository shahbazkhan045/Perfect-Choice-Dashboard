import { readWorkbook } from '../src/lib/sheets';
import { cashAgeing, inAgeBucket, isPendingThisMonth, ageInDays, reminderStats } from '../src/lib/stats';

// The sheet's newest cash month, so the check runs against real rows.
const { cash, canx } = await readWorkbook();
const months = [...new Set(cash.map((r) => r.date.slice(0, 7)).filter(Boolean))].sort();
const month = months[months.length - 1];
const asOf = `${month}-31`;

const buckets = cashAgeing(cash, asOf);
const pending = cash.filter((r) => isPendingThisMonth(r, asOf));

console.log(`cash months in sheet: ${months.join(', ')}`);
console.log(`checking as of ${asOf} — ${pending.length} pending entries that month\n`);
for (const b of buckets) {
  console.log(`  ${b.label.padEnd(10)} ${String(b.count).padStart(3)} entries   AED ${b.amount.toFixed(2)}`);
}

const sumCount = buckets.reduce((s, b) => s + b.count, 0);
const sumAmount = buckets.reduce((s, b) => s + b.amount, 0);
const pendingAmount = pending.reduce((s, r) => s + r.amount, 0);

const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
};

check('every pending entry lands in exactly one bucket', sumCount === pending.length,
  `${sumCount} vs ${pending.length}`);
check('bucket amounts sum to the pending total', Math.abs(sumAmount - pendingAmount) < 0.005,
  `${sumAmount.toFixed(2)} vs ${pendingAmount.toFixed(2)}`);
check('no entry matches two buckets', pending.every((r) =>
  buckets.filter((b) => inAgeBucket(r, b.id, asOf)).length === 1));
check('bucket boundaries are 1-3 / 4-7 / 8+', pending.every((r) => {
  const age = ageInDays(r, asOf);
  const want = age <= 3 ? 'fresh' : age <= 7 ? 'week' : 'stale';
  return inAgeBucket(r, want as never, asOf);
}));

// Same scoping as the reminder email, which is the whole point.
const stats = reminderStats(cash, canx, asOf);
check('matches the reminder email\'s own pending count', stats.pendingCashCount === sumCount,
  `${stats.pendingCashCount} vs ${sumCount}`);
check('matches the reminder email\'s own pending amount',
  Math.abs(stats.pendingCashAmount - sumAmount) < 0.005,
  `${stats.pendingCashAmount.toFixed(2)} vs ${sumAmount.toFixed(2)}`);
