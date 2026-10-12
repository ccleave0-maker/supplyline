'use client';

import { useState } from 'react';
import type { ShipViaInput, ShipViaView } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, PageLoading, PhoneLink, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

const blank: ShipViaInput = { name: '', accountNumber: null, phone: null, email: null, notes: null };

/** Carriers we ship with ("Ship via" on POs), each with our account number. */
export function ShipViaScreen() {
  const { api, me } = useAuthed();
  const list = useAsync(() => api.shipVia.list({ all: true }), [api]);
  const [editing, setEditing] = useState<{ id: string | null; v: ShipViaInput } | null>(null);
  const canEdit = can(me.user, 'procurement:work');
  const save = useAction(async () => {
    if (!editing) return;
    if (editing.id) await api.shipVia.update(editing.id, editing.v);
    else await api.shipVia.create(editing.v);
    setEditing(null);
    await list.reload();
  });
  const toggle = useAction(async (c: ShipViaView) => {
    await api.shipVia.update(c.id, { ...c, active: !c.active });
    await list.reload();
  });
  const set = (patch: Partial<ShipViaInput>) => setEditing((e) => (e ? { ...e, v: { ...e.v, ...patch } } : e));
  if (!list.data && !list.error) return <PageLoading />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.pos()} title="Carriers (Ship via)" subtitle="The carriers you ship with and your account number with each. Pick one on a PO." />
      <ErrorBanner error={list.error || toggle.error} />
      {!editing && (
        <Card
          actions={
            canEdit && (
              <Button variant="secondary" onClick={() => setEditing({ id: null, v: blank })}>
                + Add a carrier
              </Button>
            )
          }
        >
          {list.data?.length === 0 && <EmptyState title="No carriers yet" />}
          <ul className="divide-y divide-line">
            {(list.data ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-ink">
                    {c.name} {!c.active && <Badge>Not in use</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    {c.accountNumber ? `Account # ${c.accountNumber}` : 'No account #'}
                    {c.phone && (
                      <>
                        {' · '}
                        <PhoneLink number={c.phone} />
                      </>
                    )}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEditing({ id: c.id, v: { ...c } })}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void toggle.run(c)}>
                      {c.active ? 'Stop using' : 'Use again'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && (
        <Card title={editing.id ? 'Edit carrier' : 'Add a carrier'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Carrier" value={editing.v.name} onChange={(e) => set({ name: e.target.value })} />
            <TextField label="Our account #" value={editing.v.accountNumber ?? ''} onChange={(e) => set({ accountNumber: e.target.value || null })} />
            <TextField label="Phone" type="tel" value={editing.v.phone ?? ''} onChange={(e) => set({ phone: e.target.value || null })} />
            <TextField label="Email" type="email" value={editing.v.email ?? ''} onChange={(e) => set({ email: e.target.value || null })} />
            <TextField label="Notes" value={editing.v.notes ?? ''} onChange={(e) => set({ notes: e.target.value || null })} />
          </div>
          <ErrorBanner error={save.error} />
          <div className="mt-3 flex gap-2">
            <Button busy={save.busy} disabled={!editing.v.name.trim()} onClick={() => void save.run()}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** On the job page: where POs for this job can ship to (besides the job itself). */
export function SiteShipToCard({ siteId }: { siteId: string }) {
  const { api, me } = useAuthed();
  const list = useAsync(() => api.shipTo(siteId), [api, siteId]);
  const [form, setForm] = useState({ businessName: '', address: '', city: '' });
  const add = useAction(async () => {
    await api.locations.create({ businessName: form.businessName.trim(), address: form.address.trim() || null, city: form.city.trim() || null, forSiteId: siteId });
    setForm({ businessName: '', address: '', city: '' });
    await list.reload();
  });
  const mine = (list.data ?? []).filter((l) => l.siteId !== siteId && l.siteType !== 'YARD');
  return (
    <Card title="Ship-to locations">
      <p className="text-sm text-muted">Besides the job site itself: laydown areas, gates, a second site… They're the “Ship to” choices on this job's POs.</p>
      <ul className="mt-2 divide-y divide-line">
        {mine.map((l) => (
          <li key={l.id} className="py-1 text-ink">
            {l.businessName}
            {l.address && <span className="text-sm text-muted"> · {[l.address, l.city].filter(Boolean).join(', ')}</span>}
          </li>
        ))}
        {mine.length === 0 && <li className="py-1 text-sm text-muted">None yet.</li>}
      </ul>
      {can(me.user, 'location:edit') && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end">
          <TextField label="Name" placeholder="e.g. Laydown 3 – north gate" value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} />
          <TextField label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <TextField label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <Button busy={add.busy} disabled={!form.businessName.trim()} onClick={() => void add.run()}>
            Add
          </Button>
        </div>
      )}
      <ErrorBanner error={list.error || add.error} />
    </Card>
  );
}
