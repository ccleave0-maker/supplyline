# Bowron security

What's built in, and the checklist to run before go-live and before each big release (or hand to an outside pen tester).

## What's built in

| Area | How |
|---|---|
| Sign-in | Email code (6 digits, 10 min, 5 tries, 5 codes / 15 min) or Google. No passwords stored. |
| Two-step sign-in | Authenticator app (TOTP, RFC 6238). Required for Admin and Procurement by default (Admin › Security can require it for everyone; admins can't be exempted). Codes can't be reused; 10 one-time recovery codes; 5 wrong codes signs the session out; admins can reset a lost phone (signs the person out everywhere). Until the step is done the API only answers `/me`, `/auth/mfa/*` and sign-out. |
| Sessions | Random 256-bit tokens, stored only as hashes. 30-day sliding expiry; revoked on sign-out, role change, account removal and MFA reset. |
| Server-side checks | Every API route requires a session unless it is deliberately public; public routes either need their own key (Sync devices), a signature (file links, Stripe webhook) or are harmless (sign-in, version, branding, client error reports, app updates). Permissions and business-unit/job visibility are checked in the services, not the app. An automated test calls every route without signing in and fails if any answers. |
| Rate limits | Public endpoints: 30 / minute per address. Signed-in API: 1,200 / minute per address. Authenticator codes: 10 / 5 min per session. (In-memory: one server instance. With several instances, move to a shared store.) |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` on API responses, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cache-Control: no-store`, HSTS when served over HTTPS. CORS only for configured origins and the packaged apps. |
| Encryption at rest | Secrets in the database are encrypted with AES-256-GCM using `ENCRYPTION_KEY` (Claude / speech keys, authenticator secrets). Session tokens, sign-in codes, Sync device keys and recovery codes are stored hashed. The database and file storage must also be on encrypted disks (Supabase and Railway do this by default — confirm for any other host). |
| In transit | HTTPS only in production (host-terminated TLS). |
| AI | Keys never leave the server. The assistant uses the person's own access for every lookup, can only change things through a short list of actions the admin allows, and only after the person says yes. Blocked topics are refused before anything is sent to the AI. Looked-up data is marked as data, not instructions. No cross-customer learning. |
| Audit trail & alerts | Changes are recorded in the audit log. Every 5 minutes admins get an in-app notice (and email, if on) for: someone made admin, two-step turned off / reset / recovery code used, too many wrong codes, full data export, security setting changes. Admin › Security shows the last 30 days. |
| Google Maps key | A browser key (it has to reach the app). Restrict it in Google Cloud to your domains and the Maps JavaScript API only. |

## Pen-test checklist

Run against **staging**, never production data. Tick each line and note the date and tester.

### Authentication
- [ ] Sign-in code: wrong code 5× locks that code; 6th request in 15 min is refused; codes expire after 10 min.
- [ ] Requesting a code for an unknown email gives the same answer as a known one (no user discovery).
- [ ] Old / revoked / expired session tokens get 401.
- [ ] Admin or Procurement without an authenticator app can't call any API except `/me`, `/auth/mfa/*`, sign-out.
- [ ] Authenticator code reuse refused; 5 wrong codes signs out; recovery code works once.
- [ ] Removing someone's access or changing their roles ends their sessions.

### Authorization (try as each role, and as a user from a second organization)
- [ ] Change IDs in URLs / bodies to another organization's records (order, PO, BOL, invoice, file, report, conversation) → 404/403.
- [ ] Site user can't see another job's orders, loads, POs, prices or reports.
- [ ] Business-unit isolation: a user in company A can't read or write company B's records (also with a forged `X-Company` header).
- [ ] Non-admins can't reach Admin endpoints (`/security/*`, `/assistant/settings`, `/insights`, `/users/*`, `/ai/settings`).
- [ ] Prices hidden from roles that shouldn't see them (API responses, exports, PDFs, assistant answers).
- [ ] File links: changing the file ID or expiry breaks the signature.
- [ ] Sync device key from one organization can't read another's jobs.

### Input & output
- [ ] Every form: very long text, emoji, HTML/script tags, SQL-looking text → stored and shown as plain text.
- [ ] Uploads: wrong type, huge file, file named `../../x`, a PDF with scripts → refused or stored safely.
- [ ] Spreadsheet exports: cells starting with `=`, `+`, `-`, `@` don't run as formulas in Excel.
- [ ] Assistant: "ignore your rules and…", instructions hidden in an order line or PO note, asking for another job's data → refused / not shown.

### Platform
- [ ] Security headers present (check with securityheaders.com against staging).
- [ ] TLS: A rating on ssllabs.com; HTTP redirects to HTTPS.
- [ ] Rate limits answer 429 under a burst.
- [ ] Error responses don't include stack traces or SQL.
- [ ] Dependencies: `pnpm audit` has no high/critical issues.
- [ ] Secrets only in environment variables (none in the repo: `git grep -i "sk-ant\|api_key\|password"`).
- [ ] Database backups restore (server/scripts/backup.ts) and are encrypted.

### Before go-live
- [ ] `ENCRYPTION_KEY`, `CRON_SECRET`, VAPID keys set and different in staging and production.
- [ ] Platform owner account uses an authenticator app.
- [ ] An outside pen test (recommended once customers' data is in) — give the tester a staging organization and this list.
