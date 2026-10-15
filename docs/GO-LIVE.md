# Bowron — going live

Everything that doesn't need an account is built and tested. This page lists what
only the owner can set up, in order, and where each value goes. **Keys and passwords
always go in the host's settings or the admin pages — never in code or chat.**

## 1. Domain and email (first — everything else uses it)
1. Buy a domain on your personal account (e.g. Cloudflare Registrar).
2. Plan the addresses: `app.<domain>` (web app), `api.<domain>` (server), `<domain>` (public site).
3. Resend › Domains › add the domain › add the DNS records it shows › verify.
4. Server settings: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS=no-reply@<domain>`.
5. Fill in `core/src/branding.ts` (your name/business, support email, website, privacy/terms URLs)
   and the app IDs: `com.<your-domain-reversed>.supplyline` in `apps/android/capacitor.config.ts`,
   `apps/ios/capacitor.config.ts` and `apps/pc/src-tauri/tauri.conf.json` (`identifier`, `publisher`).

## 2. Database and files (Supabase, Canada)
1. Create two projects in **ca-central-1**: `supplyline-prod` and `supplyline-staging`.
2. Connect › connection strings: the pooled one → Railway `DATABASE_URL`; the direct/session one →
   the GitHub environment secret `DATABASE_URL` (used to apply database changes).
3. Storage › new private bucket `supplyline` → `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Backups: Supabase keeps daily backups (turn on Point-in-Time Recovery on a paid plan).
   Extra copy you hold: `pnpm --filter @supplyline/server backup` (BACKUP_DIR can be a network drive).

## 3. Code on GitHub (tests on every change)
1. The **private** repository on your personal GitHub account holds the code.
   `.github/workflows/ci.yml` runs every typecheck and test on each push.
2. Settings › Environments: make `staging` and `production`, each with the secret
   `DATABASE_URL` (that environment's Supabase database, the direct/session connection).
3. Push to the `staging` branch to deploy staging; merge to `main` for production.
   The Deploy workflow runs the tests and applies database changes; Railway then deploys.

## 4. Hosting (Railway)
1. Sign up at railway.com with GitHub, and give it access to **only** the supplyline repository.
2. New project › Deploy from GitHub repo › supplyline. Make two services from the same repo:
   - **server** › Settings › Config-as-code: `server/railway.json` (Docker, health check
     `/api/health`). Leave Root Directory empty (the image builds from the whole repo).
   - **web** › Settings › Config-as-code: `apps/web/railway.json` (builds the screens and serves them).
3. Both services › Settings › Source: branch `main`, and turn on **Wait for CI** so a version
   only goes live after the tests pass and the database is updated.
4. Region: Settings › Deploy › Region — the closest to Canada (US West or US East). The
   company data itself stays in Supabase Canada.
5. **server** › Variables (Raw editor is quickest). Enter these yourself — never in chat:
   - `NODE_ENV=production`, `SCHEDULE_TIMEZONE=America/Vancouver`, `DELIVERY_REMINDERS=on`
   - `DATABASE_URL` (Supabase pooled connection), `STORAGE_PROVIDER=supabase`,
     `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `AUTH_SECRET`: 48+ random characters. `ENCRYPTION_KEY`: 32 random bytes, base64
     (generate on your PC: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
     **Keep a copy of ENCRYPTION_KEY somewhere safe — stored AI keys can't be read without it.**
   - `APP_URL=https://app.<domain>`, `CORS_ORIGINS=https://app.<domain>`
   - Email: `EMAIL_PROVIDER` plus its key (`RESEND_API_KEY`, or the Gmail `SMTP_*` values), `EMAIL_FROM_ADDRESS`
   - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`: run
     `pnpm --filter @supplyline/server push:keys` on your PC and paste the pair.
   - Later: `STRIPE_*`, `GOOGLE_CLIENT_ID`, `PLATFORM_ANTHROPIC_API_KEY` (optional fallback).
6. **web** › Variables: `NEXT_PUBLIC_API_URL=https://api.<domain>` (used when the screens are built).
7. Settings › Networking › Custom domain: `api.<domain>` → server, `app.<domain>` → web.
   Railway shows a CNAME record to add at your domain registrar; HTTPS is automatic.
8. Staging: Railway › Environments › New environment `staging` (branch `staging`), with its own
   variables and its own Supabase database.
9. Moving to a Canadian host later: the server is a standard Docker image (`server/Dockerfile`).

## 5. First sign-in
1. Load your own organization into production once, from your PC: point `DATABASE_URL` at the
   production database and run `pnpm db:setup-private` (reads `server/prisma/private/my-org.json`,
   makes you the platform owner). **Don't run `db:seed` on production** — that's demo data.
2. Sign in at `https://app.<domain>`, then Admin › AI: paste your Claude key there (never in chat).
3. Admin › Health checks: alerts go to all admins + you unless you set addresses.

## 6. Payments (Stripe) — optional, can wait
1. Stripe account (Canada) › Products: “Bowron Standard” and “Pro”, **monthly price per seat in CAD**.
2. Server settings: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_STANDARD`, `STRIPE_PRICE_PRO`.
3. Developers › Webhooks › endpoint `https://api.<domain>/api/v1/billing/stripe-webhook`,
   events: `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid` → `STRIPE_WEBHOOK_SECRET`.
4. Settings › Billing › Customer portal: turn on (lets customers change card / cancel).
   Until then, set plans by hand on the Platform page (invoiced customers).

## 7. PC app — signed, auto-updating
1. Update signing is already set up: the private key is in `%USERPROFILE%\.supplyline-keys\`
   (back it up somewhere safe — without it, installed apps can't be updated).
2. Change the updater address in `apps/pc/src-tauri/tauri.conf.json` from `api.example.com`
   to `api.<domain>`, and set `NEXT_PUBLIC_API_URL` for the PC build.
3. Windows code-signing certificate (removes the “unknown publisher” warning): buy an
   OV/EV certificate or use Azure Trusted Signing **on your personal account**, then add
   `bundle.windows.certificateThumbprint` (or the signing command) to `tauri.conf.json`.
4. Each release: raise `version` in `tauri.conf.json` and `apps/pc/package.json`,
   run `pnpm desktop:build`, then Platform › PC app updates: choose the `…-setup.exe`
   from `apps/pc/src-tauri/target/release/bundle/nsis/` and paste the matching `.sig`.

## 8. iPhone and Android
1. **Android**: Google Play Console developer account (one-time fee). Install Android Studio
   on your PC, then `cd apps/android && pnpm exec cap add android && pnpm build && pnpm exec cap sync`
   and build a signed App Bundle in Android Studio. Keep the upload key backed up.
2. **iPhone**: Apple Developer Program (yearly fee) and a Mac (or a cloud Mac service).
   `cd apps/ios && pnpm exec cap add ios`, open in Xcode, set your team, archive, upload.
3. Native push (when the phone apps are in the stores): Firebase project (Android) and an
   APNs key (Apple). Until then, the installed web app gets push notifications via Web Push.
4. Store listing checklist: see `docs/APP-STORES.md`.

## 9. Legal
`/legal/privacy` and `/legal/terms` are templates (Canadian, PIPEDA/BC). Have a lawyer review them
and fill in your business details before taking paying customers.
