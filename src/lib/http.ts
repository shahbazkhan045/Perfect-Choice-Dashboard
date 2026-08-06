import { NextResponse } from 'next/server';
import { SheetsConfigError } from './sheets';
import { EmailConfigError } from './email';

/**
 * Turns a thrown value into a JSON error the UI can display.
 * Configuration problems are shown verbatim because they are actionable and
 * contain no secrets; anything else is logged and reported generically.
 */
export function failure(err: unknown, status = 500): NextResponse {
  if (typeof err === 'string') {
    return NextResponse.json({ error: err }, { status });
  }

  if (err instanceof SheetsConfigError || err instanceof EmailConfigError) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error('[dashboard]', err);

  // Google's own errors are usually the most useful thing we can show.
  if (/permission|forbidden|not found|caller does not have|unable to parse range/i.test(message)) {
    return NextResponse.json({ error: `Google Sheets: ${message}` }, { status: 502 });
  }

  return NextResponse.json(
    { error: 'Something went wrong on the server. Please try again, or contact the Justlife team.' },
    { status },
  );
}
