'use client';

import { useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { DEFAULT_SECURITY, ROLE_LABELS, ROLES, type MfaSetup, type SecuritySettings } from '../models';
import { BRANDING } from '../branding';
import { Badge, Button, Card, Checkbox, ErrorBanner, Notice, PageHeader, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed, useSession } from '../ui/session';

/** Set up an authenticator app: scan, type the code, save the recovery codes. */
function MfaSetupSteps({ onDone }: { onDone: () => void | Promise<void> }) {
  const platform = usePlatform();
  const { api } = useAuthed();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const start = useAction(async () => setSetup(await api.mfa.setup()));
  const enable = useAction(async () => setRecovery((await api.mfa.enable(code)).recoveryCodes));
  if (recovery)
    return (
      <div className="flex flex-col gap-3">
        <Notice>Your authenticator app is on.</Notice>
        <p className="text-ink">
          <b>Save these recovery codes</b> somewhere safe (not on your phone). Each one works once if you lose your phone. You won’t see them again.
        </p>
        <pre className="rounded-lg bg-surface-2 p-3 font-mono text-ink">{recovery.join('\n')}</pre>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void platform.files.saveFile('SupplyLine-recovery-codes.txt', new Blob([`SupplyLine recovery codes\n\n${recovery.join('\n')}\n`], { type: 'text/plain' }))}>
            Save as a file
          </Button>
          <Button onClick={() => void onDone()}>I’ve saved them — continue</Button>
        </div>
      </div>
    );
  if (!setup)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-ink">Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), then press Start.</p>
        <ErrorBanner error={start.error} />
        <Button busy={start.busy} onClick={() => void start.run()}>
          Start
        </Button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink">1. In the app, add an account and scan this code:</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={220} height={220} className="rounded-lg bg-white p-2" />
      <p className="text-sm text-muted">
        Can’t scan? Type this key instead: <span className="font-mono text-ink">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
      </p>
      <p className="text-ink">2. Type the 6-digit code the app shows:</p>
      <TextField label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      <ErrorBanner error={enable.error} />
      <Button busy={enable.busy} disabled={code.length !== 6} onClick={() => void enable.run()}>
        Turn it on
      </Button>
    </div>
  );
}

/** Shown instead of the app until the authenticator step is done. */
export function MfaGate() {
  const { me, refreshMe, signOut } = useSession();
  const { api } = useAuthed();
  const [code, setCode] = useState('');
  const verify = useAction(async () => {
    await api.mfa.verify(code);
    await refreshMe();
  });
  const pending = me?.mfa?.pending;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-2 p-4">
      <div className="w-full max-w-md">
        <Card title={pending === 'setup' ? 'Set up two-step sign-in' : 'Two-step sign-in'}>
          {pending === 'setup' ? (
            <>
              <p className="mb-3 text-sm text-muted">Your role needs an authenticator app to use {BRANDING.productName}. It takes a minute, once.</p>
              <MfaSetupSteps onDone={refreshMe} />
            </>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void verify.run();
              }}
            >
              <p className="text-ink">Enter the 6-digit code from your authenticator app.</p>
              <TextField label="Code" inputMode="text" autoComplete="one-time-code" autoFocus maxLength={11} hint="Lost your phone? Use one of your recovery codes, or ask an admin to reset it." value={code} onChange={(e) => setCode(e.target.value.trim())} />
              <ErrorBanner error={verify.error} />
              <Button type="submit" busy={verify.busy} disabled={code.length < 6}>
                Continue
              </Button>
            </form>
          )}
          <Button variant="ghost" className="mt-3" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Card>
      </div>
    </div>
  );
}

/** Account page: turn the authenticator app on (or off, when your role allows). */
export function MfaCard() {
  const { me, refreshMe } = useSession();
  const { api } = useAuthed();
  const [setting, setSetting] = useState(false);
  const [code, setCode] = useState('');
  const off = useAction(async () => {
    await api.mfa.disable(code);
    setCode('');
    await refreshMe();
  });
  const mfa = me?.mfa;
  if (!mfa) return null;
  return (
    <Card title="Two-step sign-in" actions={<Badge tone={mfa.enabled ? 'ok' : 'neutral'}>{mfa.enabled ? 'On' : 'Off'}</Badge>}>
      {mfa.enabled ? (
        mfa.required ? (
          <p className="text-sm text-muted">Your authenticator app is on. Your role needs it, so it stays on. Lost your phone? Ask an admin to reset it.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">To turn it off, enter a current code from the app.</p>
            <TextField label="Code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <ErrorBanner error={off.error} />
            <Button variant="secondary" busy={off.busy} disabled={code.length !== 6} onClick={() => void off.run()}>
              Turn off
            </Button>
          </div>
        )
      ) : setting ? (
        <MfaSetupSteps
          onDone={async () => {
            setSetting(false);
            await refreshMe();
          }}
        />
      ) : (
        <>
          <p className="text-sm text-muted">Sign in with your email code plus a code from an authenticator app on your phone. Recommended for everyone.</p>
          <Button className="mt-2" onClick={() => setSetting(true)}>
            Set it up
          </Button>
        </>
      )}
    </Card>
  );
}

/** Admin › Security */
export function SecurityAdminScreen() {
  const { api } = useAuthed();
  const cur = useAsync(() => api.security.settings(), [api]);
  const events = useAsync(() => api.security.events(30), [api]);
  const [s, setS] = useState<SecuritySettings | null>(null);
  const v = s ?? cur.data ?? DEFAULT_SECURITY;
  const [msg, setMsg] = useState('');
  const save = useAction(async () => {
    setS(await api.security.save(v));
    setMsg('Saved.');
    await events.reload();
  });
  const set = (patch: Partial<SecuritySettings>) => {
    setMsg('');
    setS({ ...v, ...patch });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Security" subtitle="Two-step sign-in, alerts, and recent security events." />
      {msg && <Notice>{msg}</Notice>}
      <Card title="Two-step sign-in (authenticator app)">
        <p className="text-sm text-muted">People with these roles must use an authenticator app. Admins always must. Anyone else can turn it on from their Account page.</p>
        {ROLES.map((r) => (
          <Checkbox key={r} label={ROLE_LABELS[r]} checked={v.mfaEveryone || v.mfaRequiredRoles.includes(r)} disabled={v.mfaEveryone || r === 'ADMIN'} onChange={(on) => set({ mfaRequiredRoles: on ? [...v.mfaRequiredRoles, r] : v.mfaRequiredRoles.filter((x) => x !== r) })} />
        ))}
        <Checkbox label="Require it for everyone" checked={v.mfaEveryone} onChange={(mfaEveryone) => set({ mfaEveryone })} />
        <Checkbox label="Email admins about security events" description="New admins, two-step turned off or reset, too many wrong codes, full data exports, security changes." checked={v.alertAdmins} onChange={(alertAdmins) => set({ alertAdmins })} />
        <ErrorBanner error={cur.error || save.error} />
        <Button className="mt-2" busy={save.busy} disabled={!s} onClick={() => void save.run()}>
          Save
        </Button>
      </Card>
      <Card title="Last 30 days">
        <ErrorBanner error={events.error} />
        {events.data && events.data.length === 0 && <p className="text-sm text-muted">Nothing to report.</p>}
        <ul className="flex flex-col divide-y divide-line">
          {(events.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-ink">
                <Badge tone={e.severity === 'alert' ? 'danger' : e.severity === 'warning' ? 'brand' : 'neutral'}>{e.severity === 'alert' ? 'Alert' : e.severity === 'warning' ? 'Check' : 'Info'}</Badge> {e.who ?? 'Someone'} — {e.label}
              </span>
              <span className="text-sm text-muted">{new Date(e.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Notice>Someone lost their phone? Open them under People & access and press “Reset authenticator app”. They set it up again at their next sign-in.</Notice>
    </div>
  );
}
