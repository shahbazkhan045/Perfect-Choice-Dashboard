import { NextResponse, type NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { AuthError, describeActor, requireRole } from '@/lib/auth';
import { saveEntry } from '@/lib/sheets';
import { failure } from '@/lib/http';
import type { Section } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);

export async function POST(req: NextRequest) {
  try {
    const role = await requireRole({ edit: true });

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return failure(
        'Screenshot storage is not connected yet. In Vercel, open Storage → create a Blob store → connect it to this project, then redeploy.',
        500,
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    const section = String(form.get('section') ?? '') as Section;
    const key = String(form.get('key') ?? '').trim();

    if (!(file instanceof File)) return failure('No file was received.', 400);
    if (section !== 'CASH' && section !== 'CANX') return failure('Unknown section.', 400);
    if (!key.startsWith(`${section}|`)) {
      return failure('That entry could not be identified. Refresh and try again.', 400);
    }
    if (file.size === 0) return failure('That file is empty.', 400);
    if (file.size > MAX_BYTES) {
      return failure(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 8 MB.`, 400);
    }
    if (!ALLOWED.has(file.type)) {
      return failure('Please attach a PNG, JPG, WEBP, GIF or PDF.', 400);
    }

    // addRandomSuffix keeps the caller from overwriting an unrelated upload by
    // crafting a key, and keeps the original filename readable in the URL.
    const safeName = (file.name || 'screenshot').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    const folder = key.replace(/[^a-zA-Z0-9|_-]/g, '_');

    const blob = await put(`perfect-choice/${folder}/${safeName}`, file, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.type,
    });

    const entry = await saveEntry({
      section,
      key,
      patch: { screenshot: blob.url },
      actor: describeActor(role, form.get('actorName')),
      role,
    });

    return NextResponse.json({ ok: true, url: blob.url, entry });
  } catch (err) {
    if (err instanceof AuthError) return failure(err.message, err.status);
    return failure(err);
  }
}
