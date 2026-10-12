'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { BRANDING } from '../branding';
import { ROLE_LABELS } from '../models';
import { paths } from '../routes';
import { useAdminNav } from '../ui/app-shell';
import { ColorModeToggle } from '../ui/color-mode';
import { Button, ButtonLink, Card, ErrorBanner, List, ListRow, PageHeader, TextField } from '../ui/components';
import { fieldError, useAction } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { PushToggle } from './golive';
import { NicknamesCard } from './assistant-admin';
import { MfaCard } from './security';

export function AccountScreen() {
  const router = useRouter();
  const platform = usePlatform();
  const { api, me, refreshMe, signOut } = useAuthed();
  const adminNav = useAdminNav();
  const [form, setForm] = useState({ name: me.user.name, initials: me.user.initials, phone: me.user.phone ?? '' });
  const [saved, setSaved] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [showDelete, setShowDelete] = useState(false);

  const save = useAction(async () => {
    await api.me.update({ name: form.name, initials: form.initials, phone: form.phone || null });
    await refreshMe();
    setSaved(true);
  });
  const remove = useAction(async () => {
    await api.me.deleteAccount();
    await signOut();
    router.replace(paths.login());
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Account" subtitle={`${me.user.email} · ${me.user.roles.map((r) => ROLE_LABELS[r]).join(', ')}`} />

      <Card title="Notifications">
        <PushToggle />
      </Card>

      <MfaCard />
      <NicknamesCard />
      <Card title="My menu">
        <p className="text-sm text-muted">Put the menu in the order you like, or hide what you don't use.</p>
        <ButtonLink href={paths.myMenu()} variant="secondary" className="mt-2">
          Arrange my menu
        </ButtonLink>
      </Card>

      {adminNav.length > 0 && (
        <Card title="More">
          <List>
            {adminNav.map((n) => (
              <ListRow key={n.href} href={n.href} title={n.label} />
            ))}
          </List>
        </Card>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void save.run();
        }}
      >
        <Card title="Your details">
          <ErrorBanner error={save.error} />
          {saved && <p className="mb-3 font-semibold text-ok">Saved.</p>}
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldError(save.error, 'name')} />
            <TextField label="Initials" maxLength={4} value={form.initials} onChange={(e) => setForm({ ...form, initials: e.target.value.toUpperCase() })} error={fieldError(save.error, 'initials')} />
            <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="mt-4">
            <Button type="submit" busy={save.busy}>
              Save
            </Button>
          </div>
        </Card>
      </form>

      <Card title="Appearance">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink">
            Dark mode <span className="block text-sm text-muted">Easier on the eyes at night; light mode reads best in sunlight.</span>
          </span>
          <ColorModeToggle />
        </div>
      </Card>

      <Card title="Sign out">
        <p className="mb-3 text-muted">Signs you out on this device only.</p>
        <Button
          variant="secondary"
          onClick={async () => {
            await signOut();
            router.replace(paths.login());
          }}
        >
          Sign out
        </Button>
      </Card>

      <Card title="Delete my account">
        <p className="mb-3 text-muted">
          Removes your name, email and phone and ends your access everywhere. Orders and records you created stay with your company, marked "Deleted user". This can't be undone.
        </p>
        <ErrorBanner error={remove.error} />
        {showDelete ? (
          <div className="flex flex-col gap-3">
            <TextField label='Type DELETE to confirm' value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" />
            <div className="flex gap-2">
              <Button variant="danger" disabled={confirmText.trim().toUpperCase() !== 'DELETE'} busy={remove.busy} onClick={() => void remove.run()}>
                Delete my account
              </Button>
              <Button variant="secondary" onClick={() => setShowDelete(false)}>
                Keep my account
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setShowDelete(true)}>
            Delete my account…
          </Button>
        )}
      </Card>

      <p className="text-center text-sm text-muted">
        {BRANDING.productName} {platform.info.app} {platform.info.version} ·{' '}
        <button className="min-h-12 underline" onClick={() => void platform.openExternal(BRANDING.privacyPolicyUrl)}>
          Privacy policy
        </button>
      </p>
    </div>
  );
}
