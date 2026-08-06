import { NextResponse, type NextRequest } from 'next/server';
import { AuthError, describeActor, requireRole } from '@/lib/auth';
import { saveEntry, type EntryPatch } from '@/lib/sheets';
import { failure } from '@/lib/http';
import type { Section } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CASH_STATUSES = new Set(['', 'Collected', 'Not collected']);
const TICKETS = new Set(['', 'Yes', 'No']);
const MAX_REASON = 1000;

export async function POST(req: NextRequest) {
  try {
    const role = await requireRole({ edit: true });
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return failure('The request body could not be read.', 400);
    }

    const section = body.section as Section;
    if (section !== 'CASH' && section !== 'CANX') {
      return failure('Unknown section.', 400);
    }

    const key = String(body.key ?? '').trim();
    if (!key || !key.startsWith(`${section}|`)) {
      return failure('That entry could not be identified. Refresh the page and try again.', 400);
    }

    // Only fields actually present are written; everything else is left alone.
    const patch: EntryPatch = {};

    if ('status' in body) {
      const status = String(body.status ?? '').trim();
      if (section !== 'CASH') return failure('Only cash entries have a collection status.', 400);
      if (!CASH_STATUSES.has(status)) return failure('Invalid collection status.', 400);
      patch.status = status;
    }

    if ('ticket' in body) {
      const ticket = String(body.ticket ?? '').trim();
      if (section !== 'CASH') return failure('Only cash entries have a ticket flag.', 400);
      if (!TICKETS.has(ticket)) return failure('Invalid ticket value.', 400);
      patch.ticket = ticket;
    }

    if ('reason' in body) {
      const reason = String(body.reason ?? '').trim();
      if (reason.length > MAX_REASON) {
        return failure(`Please keep the reason under ${MAX_REASON} characters.`, 400);
      }
      patch.reason = reason;
    }

    if ('screenshot' in body) {
      const url = String(body.screenshot ?? '').trim();
      if (url && !/^https?:\/\//i.test(url)) {
        return failure('A screenshot link must start with http:// or https://', 400);
      }
      patch.screenshot = url;
    }

    if (!Object.keys(patch).length) {
      return failure('Nothing to update.', 400);
    }

    const result = await saveEntry({
      section,
      key,
      patch,
      actor: describeActor(role, body.actorName),
      role,
    });

    return NextResponse.json({ ok: true, entry: result });
  } catch (err) {
    if (err instanceof AuthError) return failure(err.message, err.status);
    return failure(err);
  }
}
