'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { usePlatform } from '@supplyline/platform';
import { BRANDING } from '../branding';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

// ---------------------------------------------------------------------------
// Billing (organization admins)
// ---------------------------------------------------------------------------
export function BillingScreen() {
  const params = useSearchParams();
  const platform = usePlatform();
  const { api } = useAuthed();
  const b = useAsync(() => api.billing.get(), [api]);
  const [seats, setSeats] = useState('');
  useEffect(() => {
    if (b.data) setSeats(String(Math.max(b.data.seats, b.data.seatsUsed)));
  }, [b.data]);
  const checkout = useAction(async (plan: 'STANDARD' | 'PRO') => {
    const r = await api.billing.checkout(plan, Math.max(1, Number(seats) || 1));
    await platform.openExternal(r.url);
  });
  const portal = useAction(async () => platform.openExternal((await api.billing.portal()).url));
  if (!b.data) return b.error ? <ErrorBanner error={b.error} /> : <PageLoading />;
  const d = b.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Billing" subtitle="Your SupplyLine plan." />
      {params.get('done') && <Notice>Thanks — your subscription is being set up. It shows here within a minute.</Notice>}
      <ErrorBanner error={checkout.error || portal.error} />
      <Card title={d.planLabel}>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted">People</dt>
            <dd className="text-ink">
              {d.seatsUsed} of {d.seats} seats
            </dd>
          </div>
          {d.trialEndsAt && (
            <div>
              <dt className="text-sm text-muted">Trial ends</dt>
              <dd className="text-ink">
                {d.trialEndsAt}
                {d.trialDaysLeft != null && ` (${d.trialDaysLeft < 0 ? 'ended' : `${d.trialDaysLeft} days left`})`}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-sm text-muted">Status</dt>
            <dd>
              <Badge tone={d.status === 'PAST_DUE' ? 'danger' : d.status === 'ACTIVE' ? 'ok' : 'neutral'}>{{ ACTIVE: 'Paid up', PAST_DUE: 'Payment failed', CANCELLED: 'Cancelled', NONE: 'No subscription' }[d.status]}</Badge>
            </dd>
          </div>
        </dl>
        {d.seatsUsed > d.seats && <p className="mt-2 text-sm text-danger">You have more people than seats — add seats when you subscribe or renew.</p>}
      </Card>
      {d.onlinePayments && d.plans.length > 0 && (
        <Card title="Subscribe">
          <div className="sm:w-48">
            <TextField label="Seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} hint="One per person who signs in." />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {d.plans.map((p) => (
              <Button key={p.key} busy={checkout.busy} onClick={() => void checkout.run(p.key as 'STANDARD')}>
                {p.label}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">You’ll pay securely on Stripe’s page; card details never touch SupplyLine.</p>
        </Card>
      )}
      {d.canManage && (
        <Button variant="secondary" busy={portal.busy} onClick={() => void portal.run()}>
          Change card, see invoices or cancel
        </Button>
      )}
      {!d.onlinePayments && (
        <Notice>
          To change your plan or seats, email{' '}
          <a className="underline" href={`mailto:${BRANDING.supportEmail}`}>
            {BRANDING.supportEmail}
          </a>
          .
        </Notice>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error log (platform owner)
// ---------------------------------------------------------------------------
export function ErrorsScreen() {
  const { api } = useAuthed();
  const [all, setAll] = useState(false);
  const list = useAsync(() => api.platform.errors(all), [api, all]);
  const [open, setOpen] = useState<string | null>(null);
  const fix = useAction(async (id: string) => {
    await api.platform.resolveError(id);
    await list.reload();
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Error log" subtitle="Unexpected errors from the server and the apps, grouped. Mark one fixed once a new version is out — it comes back if it happens again." />
      <Checkbox label="Show fixed ones too" checked={all} onChange={setAll} />
      <ErrorBanner error={list.error || fix.error} />
      {list.data?.length === 0 && <EmptyState title="No errors" />}
      {(list.data ?? []).map((e) => (
        <Card key={e.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words font-semibold text-ink">{e.message}</p>
              <p className="text-sm text-muted">
                {[e.source === 'SERVER' ? 'Server' : `App${e.app ? ` (${e.app}${e.version ? ` ${e.version}` : ''})` : ''}`, `${e.count}×`, `last ${new Date(e.lastAt).toLocaleString('en-CA')}`, e.organizationName, e.path].filter(Boolean).join(' · ')}
              </p>
            </div>
            <div className="flex gap-2">
              {e.stack && (
                <Button variant="ghost" onClick={() => setOpen(open === e.id ? null : e.id)}>
                  {open === e.id ? 'Hide details' : 'Details'}
                </Button>
              )}
              {!e.resolved && (
                <Button variant="secondary" busy={fix.busy} onClick={() => void fix.run(e.id)}>
                  Mark fixed
                </Button>
              )}
            </div>
          </div>
          {open === e.id && <pre className="mt-2 max-h-80 overflow-auto rounded bg-surface-2 p-2 text-xs text-ink">{e.stack}</pre>}
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Push notifications on this device (Web Push)
// ---------------------------------------------------------------------------
function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function PushToggle() {
  const { api, me } = useAuthed();
  const key = me.features.webPushKey;
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.getRegistration().then(async (r) => setOn(!!(await r?.pushManager.getSubscription())));
  }, [supported]);
  const toggle = useAction(async (want: boolean) => {
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
    await navigator.serviceWorker.ready;
    if (want) {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for SupplyLine. Allow them in the browser’s site settings, then try again.');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key!) });
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api.push.register({ endpoint: j.endpoint, keys: j.keys });
      setOn(true);
    } else {
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.push.unregister(sub.endpoint);
        await sub.unsubscribe();
      }
      setOn(false);
    }
  });
  if (!key) return <p className="text-sm text-muted">Push notifications aren’t set up on this server yet.</p>;
  if (!supported) return <p className="text-sm text-muted">This device can’t get push notifications from SupplyLine here. Use the bell at the top, or install SupplyLine from the browser (“Add to Home Screen”).</p>;
  return (
    <div>
      <Checkbox label="Push notifications on this device" description="Get BOL, delivery, approval and action-item alerts even when SupplyLine is closed." checked={!!on} disabled={on === null || toggle.busy} onChange={(v) => void toggle.run(v)} />
      <ErrorBanner error={toggle.error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public pages: website, privacy, terms (no sign-in)
// ---------------------------------------------------------------------------
function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-2">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link href={paths.welcome()} className="text-xl font-black text-brand-ink">
            {BRANDING.productName}
          </Link>
          <ButtonLink href={paths.login()}>Sign in</ButtonLink>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="mb-4 text-3xl font-bold text-ink">{title}</h1>
        {children}
      </main>
      <footer className="mx-auto flex max-w-4xl flex-wrap gap-4 px-4 py-6 text-sm text-muted">
        <span>
          © {new Date().getFullYear()} {BRANDING.developerName}
        </span>
        <Link href={paths.privacy()} className="underline">
          Privacy
        </Link>
        <Link href={paths.terms()} className="underline">
          Terms
        </Link>
        <a href={`mailto:${BRANDING.supportEmail}`} className="underline">
          {BRANDING.supportEmail}
        </a>
      </footer>
    </div>
  );
}

const FEATURES: [string, string][] = [
  ['Order lists from the field', 'Crews order on a phone, tablet or PC — typed, pasted from Excel, or by voice. Every list is numbered per job.'],
  ['Yard, buying and POs', 'Stock checks, quotes read by AI, purchase orders with PST/GST worked out, vendor follow-ups.'],
  ['Shipping and loads', 'Multi-stop BOLs with QR codes, a load builder that flags oversize and overweight, and a schedule.'],
  ['Receiving by photo', 'Snap the BOL or packing slip — SupplyLine matches it and flags shortages.'],
  ['Vendor invoices and billing', 'AP inbox matched to POs, approvals, holdback, customer invoices and accountant exports.'],
  ['Meetings and action items', 'Run your 70-30 meeting step by step, record it, and send the minutes with who-does-what.'],
];

export function WelcomeScreen() {
  return (
    <PublicPage title={BRANDING.tagline}>
      <p className="max-w-2xl text-lg text-muted">{BRANDING.productName} keeps materials moving for construction companies — from the crew’s order list to the yard, the truck and the site, with every document filed where your office expects it.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <ButtonLink href={paths.login()}>Sign in</ButtonLink>
        <a href={`mailto:${BRANDING.supportEmail}?subject=${encodeURIComponent(`${BRANDING.productName} demo`)}`} className="sl-btn inline-flex min-h-12 items-center rounded-lg border border-line bg-surface px-4 font-semibold text-ink">
          Book a demo
        </a>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {FEATURES.map(([t, d]) => (
          <Card key={t} title={t}>
            <p className="text-muted">{d}</p>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">Works on iPhone, Android, Windows and in any browser. Your data is stored in Canada.</p>
    </PublicPage>
  );
}

const TEMPLATE_NOTE = <Notice>Template — have a lawyer review and fill in the owner details before this is published.</Notice>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xl font-semibold text-ink">{title}</h2>
      <div className="flex flex-col gap-2 text-ink">{children}</div>
    </section>
  );
}

export function PricingScreen() {
  return (
    <PublicPage title="Pricing">
      <p className="text-ink">Plans and online sign-up are coming soon.</p>
      <p className="mt-2 text-ink">
        To start a subscription now, email{' '}
        <a className="underline" href={`mailto:${BRANDING.supportEmail}?subject=${encodeURIComponent(`${BRANDING.productName} subscription`)}`}>
          {BRANDING.supportEmail}
        </a>
        .
      </p>
    </PublicPage>
  );
}

export function PrivacyScreen() {
  return (
    <PublicPage title="Privacy policy">
      {TEMPLATE_NOTE}
      <Section title="Who we are">
        <p>
          {BRANDING.productName} is provided by {BRANDING.developerName} (“we”). Questions: <a className="underline" href={`mailto:${BRANDING.supportEmail}`}>{BRANDING.supportEmail}</a>. We follow Canada’s PIPEDA and, where they apply, provincial privacy laws (for example BC PIPA and Alberta PIPA).
        </p>
      </Section>
      <Section title="What we collect">
        <p>Account details (name, work email, phone, role), the business records your organization puts in (jobs, orders, purchase orders, BOLs, invoices, photos, documents, meeting notes and recordings), and technical logs (sign-in times, device type, app version, errors).</p>
        <p>We don’t sell personal information or use it for advertising.</p>
      </Section>
      <Section title="Why">
        <p>To run the service for your organization, keep it secure, send the emails and notifications you set up, and support you. Your organization controls its data; we process it on its behalf.</p>
      </Section>
      <Section title="Where it’s kept, and who helps us">
        <p>Data is stored in Canada. Service providers we use: database and file storage, hosting, email delivery, AI reading and voice (only when your organization turns it on and with its own key where it chooses), speech-to-text (optional), and card payments (card details go to the payment provider, never to us). A current list is available on request.</p>
      </Section>
      <Section title="How long">
        <p>For as long as your organization’s account is active, then deleted within 90 days of closing unless the law requires us to keep it. Admins can export everything at any time (Admin › Export everything).</p>
      </Section>
      <Section title="Your choices">
        <p>You can see and correct your profile, ask your organization’s admin for your data, or delete your own account from Account in the app. Contact us to make a privacy request or complaint; you can also contact the Office of the Privacy Commissioner of Canada.</p>
      </Section>
      <Section title="Security">
        <p>Encrypted connections, encrypted stored keys, one-time sign-in codes (no passwords to steal), per-organization separation, audit trails and regular backups.</p>
      </Section>
      <Section title="Changes">
        <p>We’ll post changes here and tell admins of important ones.</p>
      </Section>
    </PublicPage>
  );
}

export function TermsScreen() {
  return (
    <PublicPage title="Terms of service">
      {TEMPLATE_NOTE}
      <Section title="The service">
        <p>
          {BRANDING.productName} is a subscription service provided by {BRANDING.developerName} to businesses (“you”). By using it you agree to these terms on behalf of your organization.
        </p>
      </Section>
      <Section title="Your account and data">
        <p>You’re responsible for who you invite and what they do. Your data stays yours: you can export it at any time, and we only use it to provide and support the service. Keep sign-in emails secure.</p>
      </Section>
      <Section title="Acceptable use">
        <p>No unlawful use, no attempts to break or overload the service, no access to other organizations’ data, and no reselling without our written agreement.</p>
      </Section>
      <Section title="Subscriptions and payment">
        <p>Plans are billed per seat in Canadian dollars, monthly or as agreed, plus applicable taxes. Trials end on the date shown under Billing. You can cancel any time; the plan runs to the end of the paid period. Late payments may lead to suspension after notice.</p>
      </Section>
      <Section title="AI features">
        <p>AI reading and voice features suggest information; a person always checks before anything is saved or sent. You’re responsible for decisions made with the suggestions.</p>
      </Section>
      <Section title="Availability and support">
        <p>We aim for high availability and fix problems promptly, but the service is provided “as is” without guarantees of uninterrupted operation. Planned maintenance is announced where practical.</p>
      </Section>
      <Section title="Liability">
        <p>To the extent the law allows, our total liability is limited to the fees you paid in the 12 months before the claim, and we’re not liable for indirect or lost-profit damages.</p>
      </Section>
      <Section title="Ending">
        <p>Either side may end the subscription with notice. After it ends you have 30 days to export your data, then it’s deleted.</p>
      </Section>
      <Section title="Law">
        <p>These terms are governed by the laws of British Columbia and the federal laws of Canada that apply there.</p>
      </Section>
    </PublicPage>
  );
}
