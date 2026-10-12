'use client';

import { useState } from 'react';
import { PLANS, type OrgListItem, type OrgUpdateInput } from '../models';
import { usePlatform } from '@supplyline/platform';
import { Badge, Button, Card, Checkbox, ErrorBanner, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

/** Platform owner only: customer organizations and the shared-AI-key fallback. */
export function PlatformScreen() {
  const { api } = useAuthed();
  const orgs = useAsync(() => api.platform.listOrgs(), [api]);
  const [form, setForm] = useState({ name: '', slug: '', adminName: '', adminEmail: '' });
  const create = useAction(async () => {
    await api.platform.createOrg(form);
    setForm({ name: '', slug: '', adminName: '', adminEmail: '' });
    await orgs.reload();
  });
  const err = (f: string) => fieldError(create.error, f);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Platform" subtitle="Customer organizations. Each one is fully separate." />
      <ErrorBanner error={orgs.error} onRetry={orgs.reload} />
      {orgs.loading && !orgs.data ? <PageLoading /> : (orgs.data ?? []).map((o) => <OrgCard key={o.id} org={o} onChanged={orgs.reload} />)}
      <DesktopReleaseCard />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create.run();
        }}
      >
        <Card title="New organization">
          <ErrorBanner error={create.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Organization name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={err('name')} />
            <TextField
              label="Short name"
              hint="lower-case, e.g. acme-group"
              required
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              error={err('slug')}
            />
            <TextField label="Their admin's name" required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} error={err('adminName')} />
            <TextField label="Their admin's email" type="email" required value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} error={err('adminEmail')} />
          </div>
          <div className="mt-4">
            <Button type="submit" busy={create.busy}>
              Create and invite admin
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

function OrgCard({ org, onChanged }: { org: OrgListItem; onChanged: () => void }) {
  const { api } = useAuthed();
  const [cap, setCap] = useState(org.aiFallbackMonthlyCapCad?.toString() ?? '');
  const update = useAction(async (input: Parameters<typeof api.platform.updateOrg>[1]) => {
    await api.platform.updateOrg(org.id, input);
    onChanged();
  });
  const capNumber = cap.trim() === '' ? null : Number(cap);

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {org.name} {org.status === 'SUSPENDED' ? <Badge tone="danger">Suspended</Badge> : <Badge tone="ok">Active</Badge>}
        </span>
      }
    >
      <p className="mb-3 text-muted">
        {org.slug} · {org.companyCount} companies · {org.userCount} people · since {new Date(org.createdAt).toLocaleDateString()}
      </p>
      <ErrorBanner error={update.error} />
      <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
        <Checkbox
          label="Allow my Claude key as a fallback"
          description="Off by default. Used only when this organization has no key of its own, and only up to the cap below."
          checked={org.aiFallbackEnabled}
          onChange={(v) => void update.run({ aiFallbackEnabled: v })}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:w-56">
            <TextField label="Fallback monthly cap (CAD)" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
          <Button
            variant="secondary"
            disabled={capNumber !== null && Number.isNaN(capNumber)}
            busy={update.busy}
            onClick={() => void update.run({ aiFallbackMonthlyCapCad: capNumber })}
          >
            Save cap
          </Button>
        </div>
      </div>
      <PlanEditor org={org} save={(input) => update.run(input)} busy={update.busy} />
      <div className="mt-3">
        <Button variant="secondary" onClick={() => void update.run({ status: org.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>
          {org.status === 'ACTIVE' ? 'Suspend organization' : 'Re-activate organization'}
        </Button>
      </div>
    </Card>
  );
}

/** Plan, seats, trial end and notes (for invoiced customers; Stripe updates these itself). */
function PlanEditor({ org, save, busy }: { org: OrgListItem; save: (input: OrgUpdateInput) => Promise<unknown>; busy: boolean }) {
  const [plan, setPlan] = useState(org.plan);
  const [seats, setSeats] = useState(String(org.seats));
  const [trial, setTrial] = useState(org.trialEndsAt ?? '');
  const [notes, setNotes] = useState(org.billingNotes ?? '');
  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      <p className="mb-2 font-semibold text-ink">
        Subscription <Badge tone={org.billingStatus === 'PAST_DUE' ? 'danger' : org.billingStatus === 'ACTIVE' ? 'ok' : 'neutral'}>{org.billingStatus === 'NONE' ? 'not paying online' : org.billingStatus.toLowerCase().replace('_', ' ')}</Badge>
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <SelectField label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)} options={PLANS.map((p) => ({ value: p.key, label: p.label }))} />
        <TextField label="Seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/D/g, ''))} />
        <TextField label="Trial ends" type="date" value={trial} disabled={plan !== 'TRIAL'} onChange={(e) => setTrial(e.target.value)} />
        <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button
        className="mt-2"
        variant="secondary"
        busy={busy}
        onClick={() => void save({ plan: plan as OrgUpdateInput['plan'], seats: Math.max(1, Number(seats) || 1), trialEndsAt: plan === 'TRIAL' ? trial || null : null, billingNotes: notes.trim() || null })}
      >
        Save subscription
      </Button>
    </div>
  );
}

/** Publish a new PC app version: every installed copy offers "Restart to update". */
function DesktopReleaseCard() {
  const { api } = useAuthed();
  const platform = usePlatform();
  const current = useAsync(() => api.platform.desktopRelease(), [api]);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [signature, setSignature] = useState('');
  const publish = useAction(async () => {
    const f = (await platform.files.pickFiles({ accept: '.exe' }))[0];
    if (!f) return;
    await api.platform.publishDesktopRelease(f.blob, f.name, { version: version.trim(), notes, signature });
    setVersion('');
    setNotes('');
    setSignature('');
    await current.reload();
  });
  return (
    <Card title="PC app updates">
      <p className="mb-2 text-muted">
        Now offered: {current.data ? `${current.data.version} (${new Date(current.data.pubDate).toLocaleDateString()})` : 'nothing yet'}. Build with “pnpm desktop:build” (after raising the version), then publish the …-setup.exe and paste its .sig file here.
      </p>
      <ErrorBanner error={current.error || publish.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Version" placeholder="0.2.0" value={version} onChange={(e) => setVersion(e.target.value)} />
        <TextField label="What’s new (shown to people)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <TextArea label="Signature (.sig file contents)" value={signature} onChange={(e) => setSignature(e.target.value)} />
      <Button className="mt-2" busy={publish.busy} disabled={!version.trim() || !signature.trim()} onClick={() => void publish.run()}>
        Choose installer and publish
      </Button>
    </Card>
  );
}
