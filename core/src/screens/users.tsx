'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PROCUREMENT_SCOPES, ROLE_LABELS, ROLES, type Role, type SiteListItem } from '../models';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, EmptyState, ErrorBanner, List, ListRow, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { siteTitle } from './sites';

const ROLE_HELP: Record<Role, string> = {
  SITE: 'Order forms, receiving BOLs, returns, site inventory',
  YARD: 'Stock checks, yard receiving, creating BOLs',
  PROCUREMENT: 'POs, vendors, ETAs, custom columns, subcontracts',
  AP: 'Vendor invoices (inbox, matching, rejections, paying), customer invoices',
  ADMIN: 'Everything, plus companies, people and settings',
};

export function UsersScreen() {
  const { api, me } = useAuthed();
  const [showInactive, setShowInactive] = useState(false);
  const users = useAsync(() => api.users.list(showInactive), [api, showInactive]);
  const invites = useAsync(() => api.invites.list(), [api]);
  const companyName = (id: string | null) => me.companies.find((c) => c.id === id)?.name ?? 'All companies';
  const revoke = useAction(async (id: string) => {
    await api.invites.revoke(id);
    await invites.reload();
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="People & access" subtitle="Only people you invite can sign in." actions={<ButtonLink href={paths.userInvite()}>+ Invite someone</ButtonLink>} />

      <Card title="Waiting to sign in">
        <ErrorBanner error={invites.error ?? revoke.error} />
        {invites.data?.length ? (
          <ul className="divide-y divide-line">
            {invites.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block font-semibold break-all text-ink">{i.name ? `${i.name} — ${i.email}` : i.email}</span>
                  <span className="block text-sm text-muted">
                    {i.roles.map((r) => ROLE_LABELS[r]).join(', ')} · {companyName(i.companyId)} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => void revoke.run(i.id)}>
                  Cancel invite
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No pending invites.</p>
        )}
      </Card>

      <Card title="People">
        <Checkbox label="Show people without access" checked={showInactive} onChange={setShowInactive} />
        <ErrorBanner error={users.error} onRetry={users.reload} />
        {users.loading && !users.data ? (
          <PageLoading />
        ) : users.data?.length ? (
          <List>
            {users.data.map((u) => (
              <ListRow
                key={u.id}
                href={paths.userEdit(u.id)}
                title={u.name}
                subtitle={`${u.email} · ${u.roles.map((r) => ROLE_LABELS[r]).join(', ')} · ${companyName(u.companyId)}`}
                right={!u.active && <Badge tone="danger">No access</Badge>}
              />
            ))}
          </List>
        ) : (
          <EmptyState title="No people yet" />
        )}
      </Card>
    </div>
  );
}

interface AccessForm {
  companyId: string;
  roles: Role[];
  siteIds: string[];
}

function AccessFields({ value, onChange, error }: { value: AccessForm; onChange: (v: AccessForm) => void; error: unknown }) {
  const { api, me } = useAuthed();
  const sites = useAsync(() => api.sites.list({ includeInactive: false }), [api]);
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (sites.data ?? []).filter(
      (s: SiteListItem) =>
        (!f || siteTitle(s).toLowerCase().includes(f)) &&
        (!value.companyId || s.companyId === value.companyId || s.yardCompanyIds.includes(value.companyId)),
    );
  }, [sites.data, filter, value.companyId]);

  return (
    <>
      <SelectField
        label="Company"
        hint="Admins work across all companies."
        placeholder="All companies (admins only)"
        value={value.companyId}
        onChange={(e) => onChange({ ...value, companyId: e.target.value })}
        options={me.companies.map((c) => ({ value: c.id, label: c.name }))}
      />
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Roles (pick one or more)</legend>
        {ROLES.map((r) => (
          <Checkbox
            key={r}
            label={ROLE_LABELS[r]}
            description={ROLE_HELP[r]}
            checked={value.roles.includes(r)}
            onChange={(on) => onChange({ ...value, roles: on ? [...value.roles, r] : value.roles.filter((x) => x !== r) })}
          />
        ))}
        {fieldError(error, 'roles') && <p className="text-sm font-medium text-danger">{fieldError(error, 'roles')}</p>}
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Jobs & yards they work on</legend>
        <p className="text-sm text-muted">Site users only see the jobs ticked here. Yard users see jobs served by their yards.</p>
        <div className="my-2">
          <TextField label="Filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-line p-2">
          {sites.loading ? (
            <PageLoading />
          ) : (
            shown.map((s) => (
              <Checkbox
                key={s.id}
                label={siteTitle(s)}
                description={s.companyName ?? 'Yard'}
                checked={value.siteIds.includes(s.id)}
                onChange={(on) => onChange({ ...value, siteIds: on ? [...value.siteIds, s.id] : value.siteIds.filter((x) => x !== s.id) })}
              />
            ))
          )}
        </div>
      </fieldset>
    </>
  );
}

export function InviteUserScreen() {
  const router = useRouter();
  const { api, activeCompany } = useAuthed();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [access, setAccess] = useState<AccessForm>({ companyId: activeCompany?.id ?? '', roles: ['SITE'], siteIds: [] });
  const send = useAction(async () => {
    await api.invites.create({ email, name, companyId: access.companyId || null, roles: access.roles, siteIds: access.siteIds });
    router.replace(paths.users());
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send.run();
      }}
    >
      <PageHeader back={paths.users()} title="Invite someone" subtitle="They'll get an email and sign in with a code — no password." />
      <ErrorBanner error={send.error} />
      <Card>
        <div className="flex flex-col gap-4">
          <TextField label="Email" type="email" inputMode="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError(send.error, 'email')} hint="Any email works, including Gmail." />
          <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={fieldError(send.error, 'name')} />
          <AccessFields value={access} onChange={setAccess} error={send.error} />
        </div>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" busy={send.busy}>
          Send invite
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function UserEditScreen() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const { api, me, refreshMe } = useAuthed();
  const [form, setForm] = useState<{ name: string; initials: string; phone: string; active: boolean } | null>(null);
  const [access, setAccess] = useState<AccessForm>({ companyId: '', roles: [], siteIds: [] });
  const [email, setEmail] = useState('');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [units, setUnits] = useState<{ extraCompanyIds: string[]; procurementScope: 'ALL' | 'JOBS' | 'EQUIPMENT' }>({ extraCompanyIds: [], procurementScope: 'ALL' });
  const companies = useAsync(() => api.companies.list(), [api]);

  useEffect(() => {
    api.users
      .list(true)
      .then((all) => {
        const u = all.find((x) => x.id === id);
        if (!u) throw new Error('Person not found.');
        setEmail(u.email);
        setForm({ name: u.name, initials: u.initials, phone: u.phone ?? '', active: u.active });
        setAccess({ companyId: u.companyId ?? '', roles: u.roles, siteIds: u.siteIds });
        setUnits({ extraCompanyIds: u.extraCompanyIds ?? [], procurementScope: u.procurementScope ?? 'ALL' });
      })
      .catch(setLoadError);
  }, [api, id]);

  const save = useAction(async () => {
    if (!form) return;
    await api.users.update(id, {
      name: form.name,
      initials: form.initials,
      phone: form.phone || null,
      active: form.active,
      companyId: access.companyId || null,
      roles: access.roles,
      siteIds: access.siteIds,
    });
    await api.access.setUser(id, units);
    if (id === me.user.id) await refreshMe();
    router.replace(paths.users());
  });

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!form) return <PageLoading />;
  const err = (f: string) => fieldError(save.error, f);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <PageHeader back={paths.users()} title={form.name} subtitle={email} />
      <ResetMfaButton userId={id} />
      <ErrorBanner error={save.error} />
      <Card>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={err('name')} />
            <TextField
              label="Initials"
              hint="Used for 'Ordered by'"
              maxLength={4}
              value={form.initials}
              onChange={(e) => setForm({ ...form, initials: e.target.value.toUpperCase() })}
              error={err('initials')}
            />
            <TextField label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <AccessFields value={access} onChange={setAccess} error={save.error} />
          {(companies.data ?? []).length > 1 && (
            <fieldset>
              <legend className="font-semibold text-ink">Also works in (business units)</legend>
              <p className="text-sm text-muted">They switch between these at the top of the screen. With units kept apart (Access & menu), each shows only its own data.</p>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                {(companies.data ?? [])
                  .filter((c) => c.id !== access.companyId)
                  .map((c) => (
                    <Checkbox
                      key={c.id}
                      label={c.name}
                      checked={units.extraCompanyIds.includes(c.id)}
                      onChange={(v) => setUnits((u) => ({ ...u, extraCompanyIds: v ? [...u.extraCompanyIds, c.id] : u.extraCompanyIds.filter((x) => x !== c.id) }))}
                    />
                  ))}
              </div>
            </fieldset>
          )}
          {access.roles.includes('PROCUREMENT') && (
            <SelectField
              label="May buy for"
              hint="E.g. yard / equipment staff: equipment only."
              value={units.procurementScope}
              onChange={(e) => setUnits((u) => ({ ...u, procurementScope: e.target.value as 'ALL' }))}
              options={PROCUREMENT_SCOPES.map((s) => ({ value: s.key, label: s.label }))}
            />
          )}
          <Checkbox
            label="Can sign in"
            description="Untick to remove this person's access straight away. Their past records stay."
            checked={form.active}
            onChange={(v) => setForm({ ...form, active: v })}
          />
        </div>
      </Card>
      <div className="flex gap-2">
        <Button type="submit" busy={save.busy}>
          Save
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Admin: someone lost their phone — they set up the authenticator app again at next sign-in. */
function ResetMfaButton({ userId }: { userId: string }) {
  const { api } = useAuthed();
  const [done, setDone] = useState(false);
  const [sure, setSure] = useState(false);
  const reset = useAction(async () => {
    await api.mfa.resetFor(userId);
    setDone(true);
  });
  if (done) return <p className="text-sm text-muted">Authenticator app reset. They’ve been signed out and will set it up again at their next sign-in.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {sure ? (
        <>
          <span className="text-sm text-ink">Reset their authenticator app and sign them out everywhere?</span>
          <Button type="button" variant="secondary" busy={reset.busy} onClick={() => void reset.run()}>
            Yes, reset
          </Button>
          <Button type="button" variant="ghost" onClick={() => setSure(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <Button type="button" variant="ghost" onClick={() => setSure(true)}>
          Reset authenticator app (lost phone)
        </Button>
      )}
      <ErrorBanner error={reset.error} />
    </div>
  );
}
