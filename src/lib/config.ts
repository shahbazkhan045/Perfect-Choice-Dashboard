/**
 * Central configuration. Everything secret comes from environment variables —
 * see .env.example for the full list.
 */

export const TABS = {
  CASH: process.env.SHEET_TAB_CASH || 'Cash Collection',
  CANX: process.env.SHEET_TAB_CANX || 'Cancellations',
  RESPONSES: process.env.SHEET_TAB_RESPONSES || '_Responses',
  AUDIT: process.env.SHEET_TAB_AUDIT || '_Audit',
} as const;

export const TIMEZONE = process.env.DASHBOARD_TIMEZONE || 'Asia/Dubai';
export const CURRENCY = process.env.DASHBOARD_CURRENCY || 'AED';

/**
 * How to read date cells stored as TEXT. Real date cells come back from the
 * Sheets API as serial numbers and are unambiguous, so they always win; this
 * only decides whether the text "01/08/2026" means 1 Aug or 1 Jan.
 */
export const DATE_TEXT_ORDER: 'DMY' | 'MDY' =
  process.env.DATE_TEXT_ORDER === 'MDY' ? 'MDY' : 'DMY';

export const SHEET_ID = process.env.GOOGLE_SHEET_ID || '';

export const REMINDER = {
  to: splitList(process.env.REMINDER_TO),
  cc: splitList(process.env.REMINDER_CC),
  from: process.env.REMINDER_FROM || 'Perfect Choice Dashboard <onboarding@resend.dev>',
  replyTo: process.env.REMINDER_REPLY_TO || '',
  subject:
    process.env.REMINDER_SUBJECT ||
    'Action required — Daily Cash Collection & Cancellation updates',
  signoff: process.env.REMINDER_SIGNOFF || 'Shahbaz',
};

export const SMTP = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  /**
   * Implicit TLS on 465, STARTTLS on 587/25. Office 365 and Gmail both want
   * 587, so the port is the right thing to derive this from unless overridden.
   */
  get secure(): boolean {
    if (process.env.SMTP_SECURE) return process.env.SMTP_SECURE === 'true';
    return this.port === 465;
  },
};

export type MailTransport = 'smtp' | 'resend';

/**
 * SMTP wins when configured. It sends from a real mailbox, so it reaches
 * external recipients without the domain verification Resend requires.
 */
export function activeTransport(): MailTransport | null {
  if (SMTP.host) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

/** Public base URL of the deployment, used for the button inside the email. */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}
