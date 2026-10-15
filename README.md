# Bowron

Construction procurement, from order to site. One codebase, four apps (web, PC, iPhone, Android), one server and database.

```
core/       business logic, data models, API client, shared screens (no device calls)
platform/   device-feature interfaces (camera, files, print, push, location, share, storage)
server/     versioned API (/api/v1), Prisma + PostgreSQL, email, file storage
apps/web    browser + installable PWA        (dev: http://localhost:3000)
apps/pc     Windows/Mac desktop (Tauri)      (dev: http://localhost:3001)
apps/ios    iPhone/iPad (Capacitor)          (dev: http://localhost:3002)
apps/android Android incl. Samsung (Capacitor) (dev: http://localhost:3003)
```

## Run it on your PC

Needs Node.js 22+, pnpm and PostgreSQL (already installed on the development PC).

```powershell
cd C:\Users\cclea\supplyline
pnpm install
pnpm db:migrate          # create/update database tables
pnpm db:seed             # demo organization (fictional companies, @example.com users)
pnpm db:setup-private    # your organization, from server/prisma/private/my-org.json
pnpm dev                 # server on :4000 + web app on :3000
```

Open http://localhost:3000, enter an email (for example `admin@example.com` or your own owner email) and use the 6-digit code shown on screen. In development, emails are printed in the terminal instead of being sent.

Other commands: `pnpm test` (all tests), `pnpm typecheck`, `pnpm build`, `pnpm sync:routes` (after adding a screen to `core/src/routes.json`).

## Your private data

`server/prisma/private/my-org.json` holds your real companies and emails. It is ignored by git and never ships with the product. Drop logos and login photos into `server/prisma/private/images/` named `<CODE>-logo.png` and `<CODE>-background.jpg`, then run `pnpm db:setup-private` again — or upload them in the app under Companies.

## Configuration

All keys live in `server/.env` (copy `server/.env.example`) or the admin pages — never in code. Placeholder product details (developer name, support email, app IDs) are in `core/src/branding.ts`, `apps/*/capacitor.config.ts` and `apps/pc/src-tauri/tauri.conf.json`.
