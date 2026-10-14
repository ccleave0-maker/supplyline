'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { BRANDING } from '../branding';
import type { PublicBranding } from '../models';
import Link from 'next/link';
import { paths } from '../routes';
import { ColorModeToggle } from '../ui/color-mode';
import { Button, CompanyMark, ErrorBanner, TextField } from '../ui/components';
import { fieldError, useAction } from '../ui/hooks';
import { useSession } from '../ui/session';
import { applyTheme } from '../ui/theme';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, o: Record<string, unknown>): void;
        };
      };
    };
  }
}

function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const render = () => {
      if (!window.google || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => onToken(r.credential) });
      window.google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
    };
    if (window.google) return render();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [clientId, onToken]);
  return <div ref={ref} className="flex min-h-12 justify-center" />;
}

const PENDING_KEY = 'login-pending';
/** Codes last 10 minutes; after that start again from the email step. */
function parsePending(raw: string | null): { email: string; at: number } | null {
  try {
    const p = raw ? (JSON.parse(raw) as { email?: unknown; at?: unknown }) : null;
    if (!p || typeof p.email !== 'string' || typeof p.at !== 'number' || Date.now() - p.at > 10 * 60_000) return null;
    return { email: p.email, at: p.at };
  } catch {
    return null;
  }
}

export function LoginScreen() {
  const router = useRouter();
  const platform = usePlatform();
  const { api, status, signIn, lastCompanyId } = useSession();
  const [branding, setBranding] = useState<PublicBranding | null>(null);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Remember a code that's on its way, so leaving to check email (or the phone closing the
  // app in the background) comes back to the code box instead of the email step.
  useEffect(() => {
    void platform.prefs.get(PENDING_KEY).then((raw) => {
      const p = parsePending(raw);
      if (!p) return;
      setEmail(p.email);
      setStep('code');
    });
  }, [platform]);

  useEffect(() => {
    if (status === 'authenticated') router.replace(paths.home());
  }, [status, router]);

  useEffect(() => {
    if (status === 'loading') return;
    api
      .branding(lastCompanyId)
      .then((b) => {
        setBranding(b);
        applyTheme(b.company?.themeColor);
      })
      .catch(() => applyTheme(null));
  }, [api, lastCompanyId, status]);

  const send = useAction(async () => {
    const r = await api.auth.requestCode(email);
    setDevCode(r.devCode ?? null);
    setStep('code');
    await platform.prefs.set(PENDING_KEY, JSON.stringify({ email, at: Date.now() }));
    setTimeout(() => codeRef.current?.focus(), 50);
  });

  const verify = useAction(async () => {
    const result = await api.auth.verifyCode(email, code);
    await platform.prefs.remove(PENDING_KEY);
    await signIn(result);
    router.replace(paths.home());
  });

  const google = useAction(async (idToken: string) => {
    const result = await api.auth.google(idToken);
    await signIn(result);
    router.replace(paths.home());
  });

  const company = branding?.company ?? null;
  const background = api.fileUrl(company?.loginBackgroundUrl);

  const highlights = [
    { title: 'Order to site, one thread', body: 'Order lists, POs, loads and receiving stay linked, so everyone sees the same truth.' },
    { title: 'Chases itself', body: 'ETA reminders, supplier follow-ups and late-delivery alerts go out on their own.' },
    { title: 'Built for the field', body: 'Scan, snap and sign on any phone, even with one bar of signal.' },
  ];

  return (
    <div className="flex min-h-dvh bg-surface">
      {/* Brand panel (larger screens). A company's own login photo shows through when one is uploaded. */}
      <aside className="relative hidden w-[55%] overflow-hidden text-white lg:flex lg:flex-col" style={{ background: '#0b1220' }}>
        {background ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        ) : null}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage: [
              'radial-gradient(60% 50% at 15% 10%, color-mix(in srgb, var(--brand) 55%, transparent), transparent 70%)',
              'radial-gradient(50% 45% at 90% 95%, color-mix(in srgb, var(--brand) 30%, transparent), transparent 70%)',
              'linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px)',
              'linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)',
            ].join(','),
            backgroundSize: 'auto, auto, 44px 44px, 44px 44px',
          }}
        />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(11,18,32,0) 40%, rgba(11,18,32,0.85) 100%)' }} />

        <div className="relative flex flex-1 flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            {company ? (
              <CompanyMark name={company.name} code={company.code} logoUrl={api.fileUrl(company.logoUrl)} size={40} />
            ) : (
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-lg font-black text-brand-fg shadow-lg">
                {BRANDING.productName.slice(0, 1)}
              </span>
            )}
            <span className="text-xl font-black tracking-tight">{BRANDING.productName}</span>
          </div>

          <div className="max-w-2xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm font-medium text-white/80 backdrop-blur">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand" /> Construction procurement
            </p>
            <h2 className="text-4xl leading-[1.1] font-black tracking-tight text-balance xl:text-[2.75rem]">
              Every order, PO and load.
              <br />
              <span className="text-white/60">One line from yard to site.</span>
            </h2>
            <ul className="mt-10 flex max-w-xl flex-col gap-6">
              {highlights.map((h) => (
                <li key={h.title} className="flex gap-4">
                  <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-bold ring-1 ring-white/15">
                    ✓
                  </span>
                  <span>
                    <span className="block font-semibold">{h.title}</span>
                    <span className="block text-white/65">{h.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-white/45">
            © {new Date().getFullYear()} {BRANDING.productName}
          </p>
        </div>
      </aside>

      {/* Sign-in */}
      <div className="sl-screen relative flex flex-1 flex-col lg:border-l lg:border-line">
        {/* Phones and tablets: a brand band in place of the side panel */}
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-56 lg:hidden" style={{ background: 'radial-gradient(90% 100% at 20% 0%, color-mix(in srgb, var(--brand) 35%, transparent), transparent 75%)' }} />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2 lg:invisible">
            {company ? (
              <CompanyMark name={company.name} code={company.code} logoUrl={api.fileUrl(company.logoUrl)} size={32} />
            ) : (
              <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand font-black text-brand-fg">
                {BRANDING.productName.slice(0, 1)}
              </span>
            )}
            <span className="font-black tracking-tight text-ink">{BRANDING.productName}</span>
          </div>
          <ColorModeToggle />
        </div>

        <main className="relative mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-black tracking-tight text-ink">{step === 'email' ? 'Welcome back' : 'Check your email'}</h1>
          <p className="mt-2 mb-8 text-muted">
            {step === 'email' ? (company ? `Sign in to ${company.name}.` : 'Sign in with your work email. No password needed.') : (
              <>
                If <strong className="break-all text-ink">{email}</strong> has access, a 6-digit code is on its way. It expires in 10 minutes.
              </>
            )}
          </p>

          <ErrorBanner error={step === 'email' ? send.error : verify.error ?? google.error} />

          {step === 'email' ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void send.run();
              }}
            >
              <TextField
                label="Work email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                placeholder="you@company.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={fieldError(send.error, 'email')}
              />
              <Button type="submit" busy={send.busy} className="w-full shadow-lg shadow-black/10">
                Continue with email →
              </Button>
              {branding?.googleClientId && platform.info.app === 'web' && (
                <>
                  <div className="flex items-center gap-3 text-sm text-muted" aria-hidden="true">
                    <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
                  </div>
                  <GoogleButton clientId={branding.googleClientId} onToken={(t) => void google.run(t)} />
                </>
              )}
            </form>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void verify.run();
              }}
            >
              {devCode && (
                <p className="rounded-lg bg-warn-bg p-3 text-warn-ink">
                  Development mode — your code is <strong className="tracking-widest">{devCode}</strong>
                </p>
              )}
              <TextField
                ref={codeRef}
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                error={fieldError(verify.error, 'code')}
                className="text-center text-2xl tracking-[0.5em]"
              />
              <Button type="submit" busy={verify.busy} className="w-full shadow-lg shadow-black/10">
                Sign in
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" busy={send.busy} className="flex-1" onClick={() => void send.run()}>
                  Send a new code
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    void platform.prefs.remove(PENDING_KEY);
                    setStep('email');
                    setCode('');
                    verify.setError(null);
                  }}
                >
                  Different email
                </Button>
              </div>
            </form>
          )}

          <p className="mt-8 text-sm text-muted">Access is by invitation. Ask your administrator if you need an account.</p>

          <Link
            href={paths.pricing()}
            className="sl-btn group mt-6 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 p-4 text-ink"
          >
            <span>
              <span className="block font-semibold">New to {BRANDING.productName}?</span>
              <span className="block text-sm text-muted">See pricing and start a subscription</span>
            </span>
            <span aria-hidden="true" className="text-xl text-brand-ink transition-transform group-hover:translate-x-1">
              →
            </span>
          </Link>
        </main>

        <footer className="relative flex justify-center gap-6 text-sm text-muted">
          <Link href={paths.privacy()} className="hover:text-ink">
            Privacy
          </Link>
          <Link href={paths.terms()} className="hover:text-ink">
            Terms
          </Link>
          <span className="lg:hidden">
            © {new Date().getFullYear()} {BRANDING.productName}
          </span>
        </footer>
      </div>
    </div>
  );
}
