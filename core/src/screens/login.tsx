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

  return (
    <div className="sl-screen relative flex min-h-dvh items-center justify-center bg-brand">
      {/* Background photo slot: upload one per company in Admin › Companies */}
      {background ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={background} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(160deg, rgba(0,0,0,0.05), rgba(0,0,0,0.45)), repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 2px, transparent 2px 28px)',
          }}
        />
      )}
      <div aria-hidden="true" className="absolute inset-0 bg-black/35" />

      <main className="relative w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl">
        <ColorModeToggle className="absolute top-2 right-2" />
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {company ? (
            <CompanyMark name={company.name} code={company.code} logoUrl={api.fileUrl(company.logoUrl)} size={56} />
          ) : null}
          <h1 className="text-2xl font-black text-ink">{BRANDING.productName}</h1>
          <p className="text-muted">{company ? company.name : BRANDING.tagline}</p>
        </div>

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
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={fieldError(send.error, 'email')}
              hint="We'll email you a 6-digit sign-in code."
            />
            <Button type="submit" busy={send.busy} className="w-full">
              Email me a code
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
            <p className="text-ink">
              If <strong className="break-all">{email}</strong> has access, a code is on its way. It expires in 10 minutes.
            </p>
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
            <Button type="submit" busy={verify.busy} className="w-full">
              Sign in
            </Button>
            <Button type="button" variant="secondary" busy={send.busy} onClick={() => void send.run()}>
              Send a new code
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                void platform.prefs.remove(PENDING_KEY);
                setStep('email');
                setCode('');
                verify.setError(null);
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-sm text-muted">Access is by invitation. Ask your administrator if you need an account.</p>
        <p className="mt-3 flex justify-center gap-4 text-sm text-muted">
          <Link href={paths.privacy()} className="underline">
            Privacy
          </Link>
          <Link href={paths.terms()} className="underline">
            Terms
          </Link>
        </p>
      </main>
    </div>
  );
}
