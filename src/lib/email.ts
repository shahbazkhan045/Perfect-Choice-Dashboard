import { Resend } from 'resend';
import nodemailer from 'nodemailer';
import { CURRENCY, REMINDER, SMTP, activeTransport, appBaseUrl, type MailTransport } from './config';
import { formatDmy } from './parse';
import { tokenForRole } from './auth';
import type { ReminderStats } from './types';

export class EmailConfigError extends Error {}

export function money(n: number): string {
  const fixed = (Math.round(n * 100) / 100).toFixed(2);
  const [whole, decimals] = fixed.split('.');
  return `${CURRENCY} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimals}`;
}

/** The dashboard link embedded in the email — always the editable partner link. */
export function partnerLink(): string {
  const token = tokenForRole('PC_ADMIN');
  const base = appBaseUrl();
  return token ? `${base}/?k=${encodeURIComponent(token)}` : base;
}

interface SummaryRow {
  label: string;
  value: string;
  attention: boolean;
}

function summaryRows(stats: ReminderStats): SummaryRow[] {
  const rows: SummaryRow[] = [
    {
      label: 'Cash entries pending confirmation',
      value: String(stats.pendingCashCount),
      attention: stats.pendingCashCount > 0,
    },
    {
      label: 'Cash awaiting confirmation',
      value: money(stats.pendingCashAmount),
      attention: stats.pendingCashAmount > 0,
    },
    {
      label: 'Uncollected cash',
      value: money(stats.uncollectedAmount),
      attention: stats.uncollectedAmount > 0,
    },
    {
      label: 'Confirmed collected',
      value: money(stats.collectedAmount),
      attention: false,
    },
    {
      label: 'Not-collected entries without a ticket',
      value: String(stats.noTicketCount),
      attention: stats.noTicketCount > 0,
    },
    {
      label: 'Cancellations / releases awaiting a reason',
      value: String(stats.awaitingReasonCount),
      attention: stats.awaitingReasonCount > 0,
    },
  ];

  if (stats.oldestPending) {
    const age = stats.oldestAgeDays;
    rows.push({
      label: 'Oldest item still open',
      value: `${formatDmy(stats.oldestPending)}${age ? ` · ${age} day${age === 1 ? '' : 's'} ago` : ''}`,
      attention: age >= 2,
    });
  }

  return rows;
}

export function buildReminderHtml(stats: ReminderStats): string {
  const link = partnerLink();
  const rows = summaryRows(stats)
    .map(
      (r, i) => `
        <tr style="background:${i % 2 ? '#f8fafc' : '#ffffff'}">
          <td style="padding:11px 16px;border-bottom:1px solid #e2e8f0;color:#334155;font-size:14px">${escapeHtml(r.label)}</td>
          <td style="padding:11px 16px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-size:14px;color:${r.attention ? '#b91c1c' : '#0f172a'}">${escapeHtml(r.value)}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px 12px;background:#f1f5f9">
  <div style="font:15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;max-width:640px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px 30px;border:1px solid #e2e8f0">

    <div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#1d6fd0;margin-bottom:22px">
      Justlife &times; Perfect Choice
    </div>

    <p style="margin:0 0 16px">Dear Team,</p>
    <p style="margin:0 0 16px">I hope you&rsquo;re doing well.</p>
    <p style="margin:0 0 16px">The daily operational dashboard has now been updated with the latest <b>Cash Collection</b> and <b>Cancellation &amp; Release</b> data.</p>
    <p style="margin:0 0 10px">Kindly review the dashboard and update the required information at your earliest convenience, including:</p>

    <ul style="margin:0 0 22px;padding-left:20px;color:#334155">
      <li style="margin-bottom:4px">Cash collection status</li>
      <li style="margin-bottom:4px">Reasons for any uncollected cash</li>
      <li style="margin-bottom:4px">Ticket status (if applicable)</li>
      <li>Cancellation / release reasons</li>
    </ul>

    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 0 26px">
      ${rows}
    </table>

    <p style="margin:0 0 28px">
      <a href="${escapeAttr(link)}" style="display:inline-block;background:#1d6fd0;color:#ffffff;text-decoration:none;padding:13px 30px;border-radius:9px;font-weight:600;font-size:15px">Open the dashboard</a>
    </p>

    <p style="margin:0 0 16px">Your timely updates help us maintain accurate operational records and ensure any pending issues are resolved quickly.</p>
    <p style="margin:0 0 22px">Thank you for your support and cooperation.</p>
    <p style="margin:0">Best regards,<br><b>${escapeHtml(REMINDER.signoff)}</b></p>
  </div>
</body></html>`;
}

export function buildReminderText(stats: ReminderStats): string {
  const lines = [
    'Dear Team,',
    '',
    "I hope you're doing well.",
    '',
    'The daily operational dashboard has now been updated with the latest Cash Collection and Cancellation & Release data.',
    '',
    'Kindly review the dashboard and update the required information at your earliest convenience, including:',
    '  - Cash collection status',
    '  - Reasons for any uncollected cash',
    '  - Ticket status (if applicable)',
    '  - Cancellation / release reasons',
    '',
    ...summaryRows(stats).map((r) => `${r.label}: ${r.value}`),
    '',
    `Open the dashboard: ${partnerLink()}`,
    '',
    'Your timely updates help us maintain accurate operational records and ensure any pending issues are resolved quickly.',
    '',
    'Thank you for your support and cooperation.',
    '',
    'Best regards,',
    REMINDER.signoff,
  ];
  return lines.join('\n');
}

export interface SendResult {
  id: string | null;
  to: string[];
  cc: string[];
  subject: string;
  via: MailTransport;
}

export interface Readiness {
  ready: boolean;
  transport: MailTransport | null;
  reason: string;
  /** Non-blocking: the send is allowed, but something is probably misconfigured. */
  warning: string;
}

/** Whether a reminder could actually be sent right now. */
export function sendReadiness(): Readiness {
  const transport = activeTransport();

  if (!transport) {
    return {
      ready: false,
      transport: null,
      reason:
        'No mail transport is configured. Set SMTP_HOST (plus SMTP_USER / SMTP_PASS) to send from your own mailbox, or RESEND_API_KEY to send through Resend.',
      warning: '',
    };
  }
  if (!REMINDER.to.length) {
    return {
      ready: false,
      transport,
      reason: 'No recipients configured. Set REMINDER_TO to the Perfect Choice team addresses.',
      warning: '',
    };
  }

  let warning = '';

  // Office 365 and Gmail both reject a From that is not the mailbox you
  // authenticated as, so a leftover resend.dev sender will fail at send time.
  if (transport === 'smtp' && /resend\.dev/i.test(REMINDER.from)) {
    warning =
      'REMINDER_FROM is still the Resend test sender. When sending over SMTP it must be the mailbox you authenticate as, e.g. "Shahbaz <shahbaz.khan@justlife.com>", or the mail server will refuse it.';
  } else if (transport === 'resend' && /resend\.dev/i.test(REMINDER.from)) {
    warning =
      'Using the Resend test sender: it only delivers to the address that owns the Resend account. Verify a sending domain, or set SMTP_HOST to send from your own mailbox.';
  }

  return { ready: true, transport, reason: '', warning };
}

export async function sendReminderEmail(stats: ReminderStats): Promise<SendResult> {
  const { ready, transport, reason } = sendReadiness();
  if (!ready || !transport) throw new EmailConfigError(reason);

  const html = buildReminderHtml(stats);
  const text = buildReminderText(stats);

  const id = transport === 'smtp' ? await sendViaSmtp(html, text) : await sendViaResend(html, text);

  return { id, to: REMINDER.to, cc: REMINDER.cc, subject: REMINDER.subject, via: transport };
}

async function sendViaSmtp(html: string, text: string): Promise<string | null> {
  const transporter = nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.secure,
    // An unauthenticated relay is legitimate on an internal host, so only
    // attach credentials when a username was actually supplied.
    ...(SMTP.user ? { auth: { user: SMTP.user, pass: SMTP.pass } } : {}),
  });

  try {
    const info = await transporter.sendMail({
      from: REMINDER.from,
      to: REMINDER.to.join(', '),
      ...(REMINDER.cc.length ? { cc: REMINDER.cc.join(', ') } : {}),
      ...(REMINDER.replyTo ? { replyTo: REMINDER.replyTo } : {}),
      subject: REMINDER.subject,
      html,
      text,
    });
    return info.messageId ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`The mail server rejected the message: ${message}`);
  } finally {
    transporter.close();
  }
}

async function sendViaResend(html: string, text: string): Promise<string | null> {
  const resend = new Resend(process.env.RESEND_API_KEY as string);

  const { data, error } = await resend.emails.send({
    from: REMINDER.from,
    to: REMINDER.to,
    ...(REMINDER.cc.length ? { cc: REMINDER.cc } : {}),
    ...(REMINDER.replyTo ? { replyTo: REMINDER.replyTo } : {}),
    subject: REMINDER.subject,
    html,
    text,
  });

  if (error) {
    // Resend only delivers to the account owner until a domain is verified,
    // and the raw error for that case is not obvious. Say what it means.
    const hint = /testing|verify a domain|own email/i.test(error.message)
      ? ' Resend only delivers to your own account address until you verify a sending domain — configure SMTP_HOST instead to reach the team now.'
      : '';
    throw new Error(`Resend rejected the message: ${error.message}${hint}`);
  }

  return data?.id ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
