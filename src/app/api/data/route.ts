import { NextResponse } from 'next/server';
import { AuthError, canEdit, canRemind, requireRole } from '@/lib/auth';
import { readWorkbook } from '@/lib/sheets';
import { CURRENCY } from '@/lib/config';
import { nowStamp, shiftIso, todayIso } from '@/lib/parse';
import { ROLE_LABELS, type DashboardData } from '@/lib/types';
import { failure } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const role = await requireRole();
    const { cash, canx, canxTotalPct } = await readWorkbook();
    const today = todayIso();

    const payload: DashboardData = {
      role,
      roleLabel: ROLE_LABELS[role],
      canEdit: canEdit(role),
      canRemind: canRemind(role),
      currency: CURRENCY,
      today,
      yesterday: shiftIso(today, -1),
      syncedAt: nowStamp(),
      cash,
      canx,
      canxTotalPct,
    };

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err) {
    if (err instanceof AuthError) return failure(err.message, err.status);
    return failure(err);
  }
}
