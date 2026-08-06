import { NextResponse } from 'next/server';
import { AuthError, requireRole } from '@/lib/auth';
import { readWorkbook } from '@/lib/sheets';
import { buildReminderHtml, partnerLink, sendReadiness, sendReminderEmail } from '@/lib/email';
import { reminderStats } from '@/lib/stats';
import { REMINDER } from '@/lib/config';
import { todayIso } from '@/lib/parse';
import { failure } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function currentStats() {
  const { cash, canx } = await readWorkbook();
  return reminderStats(cash, canx, todayIso());
}

/** Preview — shows the admin exactly what will be sent, before sending it. */
export async function GET() {
  try {
    await requireRole({ remind: true });
    const readiness = sendReadiness();
    const stats = await currentStats();

    return NextResponse.json({
      to: REMINDER.to,
      cc: REMINDER.cc,
      from: REMINDER.from,
      replyTo: REMINDER.replyTo,
      subject: REMINDER.subject,
      html: buildReminderHtml(stats),
      link: partnerLink(),
      stats,
      ready: readiness.ready,
      transport: readiness.transport,
      blockedReason: readiness.reason,
      warning: readiness.warning,
    });
  } catch (err) {
    if (err instanceof AuthError) return failure(err.message, err.status);
    return failure(err);
  }
}

export async function POST() {
  try {
    await requireRole({ remind: true });
    const stats = await currentStats();
    const result = await sendReminderEmail(stats);
    return NextResponse.json({ ok: true, ...result, stats });
  } catch (err) {
    if (err instanceof AuthError) return failure(err.message, err.status);
    return failure(err);
  }
}
