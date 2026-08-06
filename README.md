# Justlife × Perfect Choice — Daily Confirmation Dashboard

A Next.js app, deployed on Vercel, that reads and writes the
**Perfect Choice Daily Confirmation** Google Sheet. The Perfect Choice team opens
a link, confirms cash collection and explains cancellations; everything is
written straight back into the spreadsheet.

---

## What it does

**Cash collection** — Yesterday / Pending / Updated / Month to date

| Field | Behaviour |
| --- | --- |
| Status | `Pending` → `Collected` / `Not collected` |
| Ticket raised? | Enabled **only** when status is *Not collected*. Yes / No |
| Reason | Enabled **only** when status is *Not collected*. Free text |

Marking a row *Collected* clears any ticket and reason, on the server as well as
on screen, so a stale explanation can never linger on a collected booking.

**Cancellations & releases** — same four tabs, plus a free-text reason and an
image/PDF attachment per row.

**The four tabs**

- **Yesterday** — rows dated yesterday. If yesterday isn't in the sheet yet, it
  falls back to the most recent day present and says so in a banner.
- **Pending** — everything still unanswered, any date, oldest first. Rows roll in
  here automatically as days pass.
- **Updated** — everything already answered, newest first.
- **Month to date** — the whole current month, answered or not, plus a chart.

---

## Three access levels

Access is by secret link. Nobody signs in, which matters because the Perfect
Choice team is external.

| Role | Can do |
| --- | --- |
| **Justlife Admin** | Everything, including sending the reminder email |
| **Perfect Choice Admin** | Update every status, ticket, reason and screenshot |
| **View only** | Read and download; every control is disabled |

Roles are enforced **server-side** on every write. A view-only link cannot save
even if the browser is manipulated.

When a link is first opened the token moves into an httpOnly cookie and is
stripped from the address bar, so it won't leak through screenshots, browser
history or referrer headers.

> **Treat the links like passwords.** Anyone holding one has that role.
> To revoke, regenerate the tokens and redeploy.

---

## Setup

You do **not** need Node.js installed locally — Vercel builds the app in the
cloud. Node is only needed if you want to run it on your own machine.

### 1. Google service account (gives the app access to the sheet)

1. <https://console.cloud.google.com/> → create a project (any name).
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create credentials → Service account**.
   Name it e.g. `perfect-choice-dashboard`. Skip the optional steps.
4. Open the service account → **Keys → Add key → Create new key → JSON**.
   A JSON file downloads. You need two values from it:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY`
5. **Share the spreadsheet with that `client_email` address, as Editor.**
   This is the step everyone forgets — without it every request returns
   *"The caller does not have permission"*.

No OAuth consent screen, no app verification, no admin approval. The service
account is just another collaborator on the sheet.

### 2. Reminder email — pick one transport

The app supports two, and **SMTP wins whenever `SMTP_HOST` is set**.

**Option A — SMTP (reaches external recipients immediately).**
Sends from a real mailbox, so there is no DNS work and no domain verification.

| Provider | Host | Port |
| --- | --- | --- |
| Office 365 | `smtp.office365.com` | 587 |
| Gmail / Workspace | `smtp.gmail.com` | 587 (requires an App Password) |

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=shahbaz.khan@justlife.com
SMTP_PASS=<app password or mailbox password>
REMINDER_FROM=Shahbaz <shahbaz.khan@justlife.com>
```

> `REMINDER_FROM` **must** be the mailbox you authenticate as. Office 365 and
> Gmail both reject a mismatched sender. The dashboard warns you in the reminder
> dialog if this looks wrong.

**Option B — Resend.**
<https://resend.com> → **API Keys → Create** → set `RESEND_API_KEY`.

> Resend's `onboarding@resend.dev` sender **only delivers to the address that
> owns the Resend account.** To reach the Perfect Choice team you must verify a
> sending domain (DNS records — usually a subdomain such as
> `notifications.justlife.com`) and set `REMINDER_FROM` to an address on it.

### 3. Access tokens

Already generated for you — see the values below, or regenerate any time:

```bash
powershell -ExecutionPolicy Bypass -File scripts\generate-tokens.ps1 https://your-app.vercel.app
```

(or `npm run tokens` if you have Node.)

### 4. Deploy

Push this folder to GitHub, then <https://vercel.com/new> → import the repo.
Framework detection picks up Next.js on its own.

Add every variable from [`.env.example`](.env.example) under
**Settings → Environment Variables**, then **Storage → Create Blob store →
connect to this project** (that injects `BLOB_READ_WRITE_TOKEN` automatically),
and redeploy.

### 5. Share the links

`https://your-app.vercel.app/?k=<token>` — one per role.

---

## Local development (optional, needs Node 20+)

```bash
npm install
```

Copy `.env.example` to `.env.local`, fill it in, then:

```bash
npm run dev
```

---

## How answers survive a data refresh

The visible tabs get overwritten whenever the daily export is re-pasted. So the
app treats a hidden **`_Responses`** tab as the source of truth, keyed per
booking:

```
CASH|2026-08-03|F7D14F
CANX|2026-08-03|1AC5FA|Angelica Perfect Choice HC6
```

Every save writes there first, then mirrors into `Cash Collection` /
`Cancellations` so the spreadsheet still reads correctly on its own. Re-pasting
raw data wipes the mirrored columns but never the answers — they reappear on the
next load. This matches the `_Responses` tab your sheet already had.

A hidden **`_Audit`** tab records every field change: timestamp, key, old value,
new value, role and who. Both tabs are created automatically on first use.

## How dates are read

The app reads cells with `UNFORMATTED_VALUE` + `SERIAL_NUMBER`, so a genuine
date cell arrives as a serial number and carries no ambiguity at all. Only a
cell typed as *text* falls back to `DATE_TEXT_ORDER` (default `DMY`, so
`01/08/2026` would mean 1 August).

Everything then displays as `DD/MM/YYYY`. Hovering a date shows the original
sheet text, so you can always see what the spreadsheet itself renders.

> **Watch the spreadsheet's locale.** As of August 2026 every date in this sheet
> is a real date cell and the spreadsheet locale renders them **MM/DD/YYYY** —
> so `01/08/2026` in the sheet is **8 January**, not 1 August. If the daily
> export writes dates as DD/MM, pasting it into an MM/DD-locale sheet silently
> shifts the day and month, and rows land in the wrong month.
>
> This was repaired on 6 August 2026: spreadsheet locale set to `en_GB`, the two
> date columns given an explicit `dd/mm/yyyy` pattern, and 13 already-swapped
> rows corrected (6 in Cash Collection, 7 in Cancellations).

If it happens again — a fresh paste lands in the wrong month — run:

```bash
node --env-file=.env.local scripts/fix-swapped-dates.mjs
```

That is a **dry run**: it prints every row it would change and writes nothing.
It only proposes a row when its current date sits outside the sheet's operating
window *and* swapping day/month brings it inside, so a correctly-dated row can
never be "corrected". Add `--apply` to write.

Note that the spreadsheet **locale** and an explicit **number format** are two
different things, and the format wins. Changing locale alone leaves existing
columns displaying mm/dd/yyyy; `--format` is what fixes the display.

## Reminder email

Admin only. **Send reminder** opens a preview of the exact message with live
figures — pending entries, uncollected cash, entries missing a ticket,
cancellations awaiting a reason, and the oldest open item — showing who it will
go to and which transport will carry it, then sends. Those figures come from the
same functions that drive the on-screen cards (`src/lib/stats.ts`), so the email
can never disagree with the dashboard.

---

## Project layout

```
src/
  app/
    page.tsx              role from cookie, or the access-link gate
    globals.css           all styling, light + dark
    api/data/route.ts     GET   everything the dashboard renders
    api/entry/route.ts    POST  save one field, validated + role-checked
    api/upload/route.ts   POST  screenshot → Vercel Blob → sheet
    api/reminder/route.ts GET preview · POST send
  components/             Dashboard, CashSection, CanxSection, chart, primitives
  lib/
    auth.ts               token → role, constant-time compare, guards
    sheets.ts             Google Sheets read/write, header mapping, audit
    stats.ts              filters + KPIs, shared by UI and email
    parse.ts              date / number / percent coercion
    email.ts              reminder template + Resend
  middleware.ts           ?k=… → httpOnly cookie, strips the URL

scripts/
  generate-tokens.ps1        make three new secret access links
  import-service-account.ps1 load a Google key JSON into .env.local
  check-sheet.mjs            diagnose the Sheets connection  (npm run check)
  fix-swapped-dates.mjs      repair day/month-swapped date cells
```

## Handy commands

```bash
npm run dev      # run locally on http://localhost:3000
npm run check    # is the sheet reachable and writable?
npm run build    # what Vercel runs
npm run tokens   # generate three fresh access links
```

## Known limitations

- **Concurrent edits**: two people answering the *same row* within a second of
  each other — last write wins. Different rows are unaffected. There is no
  cross-request lock on Vercel the way there was in Apps Script.
- **Duplicate rows**: two rows sharing a date, reference (and cleaner) resolve to
  one key and therefore share one answer.

## Verification status

Type-check and production build pass on Node 24. The app was run locally and
exercised against a fixture holding the real spreadsheet contents:

- Access gate, and `?k=` moving into an httpOnly cookie with the URL stripped
- All three roles — view-only and partner links are rejected **server-side**
  (403) on forged API calls, not just disabled in the UI
- Yesterday fallback banner, filter counts, KPI cards, ageing badges
- `08/03/2026` (a real date cell) correctly resolving to 3 August
- Ticket / reason unlocking only for *Not collected*
- Failed saves rolling the row back and surfacing the server's message
- Month-to-date chart, and the reminder email rendering with live figures
- **A real reminder send over SMTP**, against a local mail server. The message
  arrived as multipart text+HTML with all four addresses in the SMTP envelope
  (so the Cc genuinely receives it), correct From / Reply-To / Subject, and the
  live figures in the body.

**Not exercised**, because they need real credentials: the Google Sheets
read/write round trip, Resend delivery, Blob upload, and authenticated SMTP
against Office 365 / Gmail. Add the environment variables and those paths run
for the first time.
