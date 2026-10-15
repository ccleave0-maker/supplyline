'use client';

import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import {
  CONTACT_TYPE_LABELS,
  EMAIL_RECIPIENT_KINDS,
  EMAIL_RECIPIENT_LABELS,
  ROLE_LABELS,
  type EmailRecipientKind,
  type SiteDetail,
} from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  ErrorBanner,
  PageHeader,
  PageLoading,
  SelectField,
  TextField,
} from '../ui/components';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { MapView } from '../ui/map';
import { useAuthed } from '../ui/session';
import { JobEquipmentPlanCard } from './planning';
import { ProjectDocumentsCard } from './documents';
import { SiteShipToCard } from './ship-via';
import { ScanButton } from '../ui/scan-button';
import { CostCodesCard } from './cost-codes';
import { NotificationsCard, ProjectCard } from './projects';
import { PoListCard } from './purchasing';
import { BudgetCard, SubHoldbackCard } from './accounting';
import { UpcomingLoadsCard } from './schedule';
import { siteTitle } from './sites';

export function SiteProfileScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { api, me } = useAuthed();
  const site = useAsync(() => api.sites.get(id), [api, id]);

  if (site.loading && !site.data) return <PageLoading />;
  if (site.error || !site.data) return <ErrorBanner error={site.error ?? 'Not found'} onRetry={site.reload} />;
  const s = site.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={paths.sites(s.type)}
        title={siteTitle(s)}
        subtitle={s.type === 'JOB' ? s.companyName : 'Yard'}
        actions={s.canEdit && <ButtonLink href={paths.siteEdit(s.id)} variant="secondary">Edit details</ButtonLink>}
      />
      {!s.active && <Badge>Inactive</Badge>}
      {s.type === 'JOB' && (
        <div className="grid grid-cols-2 gap-2">
          <ButtonLink href={paths.orders(s.id)}>Order lists</ButtonLink>
          <ButtonLink href={paths.siteInventory(s.id)} variant="secondary">
            Site inventory
          </ButtonLink>
          {can(me.user, 'bol:receive') && (
            <ButtonLink href={paths.bolReceive()} variant="secondary">
              📷 Receive a BOL
            </ButtonLink>
          )}
          {can(me.user, 'return:create') && (
            <ButtonLink href={paths.returnNew(s.id)} variant="secondary">
              Return items
            </ButtonLink>
          )}
          <ButtonLink href={paths.bols(s.id)} variant="ghost" className="col-span-2">
            BOLs for this job ›
          </ButtonLink>
        </div>
      )}
      {s.type === 'JOB' && <ProjectCard site={s} onChanged={site.reload} />}
      {s.type === 'JOB' && (can(me.user, 'po:view') || s.projectManager?.id === me.user.id) && <PoListCard siteId={s.id} />}
      {s.type === 'JOB' && (can(me.user, 'po:view') || can(me.user, 'ap:work') || s.projectManager?.id === me.user.id) && (
        <>
          <BudgetCard siteId={s.id} />
          <SubHoldbackCard siteId={s.id} />
        </>
      )}
      {s.type === 'JOB' && can(me.user, 'po:view') && <SiteShipToCard siteId={s.id} />}
      {s.type === 'JOB' && <JobEquipmentPlanCard siteId={s.id} />}
      {s.type === 'JOB' && <ProjectDocumentsCard siteId={s.id} />}
      {s.type === 'JOB' && (
        <ButtonLink href={paths.jobMaterials(s.id)} variant="secondary">
          Where’s this job’s material?
        </ButtonLink>
      )}
      {can(me.user, 'bol:view') && <UpcomingLoadsCard siteId={s.id} title={s.type === 'JOB' ? 'Upcoming deliveries' : 'Loads in & out'} />}
      <ScanButton />
      <LocationCard site={s} />
      <PersonnelCard site={s} onChanged={site.reload} />
      {s.type === 'JOB' && <NotificationsCard siteId={s.id} />}
      <ContactsCard site={s} onChanged={site.reload} />
      <EmailRoutingCard site={s} onChanged={site.reload} />
      {s.type === 'JOB' && s.companyId && <CostCodesCard companyId={s.companyId} siteId={s.id} />}
      {s.notes && (
        <Card title="Notes">
          <p className="whitespace-pre-wrap text-ink">{s.notes}</p>
        </Card>
      )}
    </div>
  );
}

function LocationCard({ site }: { site: SiteDetail }) {
  const platform = usePlatform();
  const lines = [site.address, [site.city, site.province, site.postalCode].filter(Boolean).join(', ')].filter(Boolean);
  const hasPin = site.lat != null && site.lng != null;
  return (
    <Card
      title="Location"
      actions={
        hasPin && (
          <Button
            variant="secondary"
            onClick={() => void platform.openExternal(`https://www.openstreetmap.org/?mlat=${site.lat}&mlon=${site.lng}#map=16/${site.lat}/${site.lng}`)}
          >
            Open map
          </Button>
        )
      }
    >
      {lines.length ? (
        <address className="mb-3 text-ink not-italic">
          {lines.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </address>
      ) : (
        <p className="mb-3 text-muted">No address yet.</p>
      )}
      {hasPin ? (
        <MapView label={`Map pin for ${site.name}`} points={[{ id: site.id, lat: site.lat!, lng: site.lng!, label: site.name }]} />
      ) : (
        <p className="text-muted">No map pin yet{site.canEdit ? ' — add one under Edit details.' : '.'}</p>
      )}
    </Card>
  );
}

function PersonnelCard({ site, onChanged }: { site: SiteDetail; onChanged: () => void }) {
  const { api } = useAuthed();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const users = useAsync(() => (editing ? api.users.list() : Promise.resolve([])), [api, editing]);
  const save = useAction(async () => {
    await api.sites.setMembers(site.id, [...selected]);
    setEditing(false);
    onChanged();
  });

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (users.data ?? []).filter((u) => !f || u.name.toLowerCase().includes(f) || u.email.includes(f));
  }, [users.data, filter]);

  return (
    <Card
      title="Personnel"
      actions={
        site.canEdit &&
        !editing && (
          <Button
            variant="secondary"
            onClick={() => {
              setSelected(new Set(site.members.map((m) => m.userId)));
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )
      }
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <ErrorBanner error={users.error ?? save.error} />
          <TextField label="Find a person" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {users.loading ? (
            <PageLoading />
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-lg border border-line p-2">
              {visible.map((u) => (
                <Checkbox
                  key={u.id}
                  label={u.name}
                  description={`${u.email} · ${u.roles.map((r) => ROLE_LABELS[r]).join(', ')}`}
                  checked={selected.has(u.id)}
                  onChange={(on) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(u.id);
                      else next.delete(u.id);
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={() => void save.run()} busy={save.busy}>
              Save personnel
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : site.members.length ? (
        <ul className="divide-y divide-line">
          {site.members.map((m) => (
            <li key={m.userId} className="flex min-h-12 items-center gap-3 py-2">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 font-bold text-ink">{m.initials}</span>
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{m.name}</span>
                <span className="block text-sm break-all text-muted">
                  {m.roles.map((r) => ROLE_LABELS[r]).join(', ')} · {m.email}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No one assigned yet" />
      )}
    </Card>
  );
}

function ContactsCard({ site, onChanged }: { site: SiteDetail; onChanged: () => void }) {
  const { api } = useAuthed();
  const platform = usePlatform();
  const [adding, setAdding] = useState(false);
  const [contactId, setContactId] = useState('');
  const [role, setRole] = useState('');
  const library = useAsync(() => (adding ? api.contacts.list() : Promise.resolve([])), [api, adding]);

  const current = site.contacts.map((c) => ({ contactId: c.contactId, roleOnSite: c.roleOnSite }));
  const save = useAction(async (next: { contactId: string; roleOnSite?: string | null }[]) => {
    await api.sites.setContacts(site.id, next);
    setAdding(false);
    setContactId('');
    setRole('');
    onChanged();
  });

  const options = (library.data ?? [])
    .filter((c) => !site.contacts.some((sc) => sc.contactId === c.id))
    .map((c) => ({ value: c.id, label: [c.businessName, c.name].filter(Boolean).join(' — ') }));

  return (
    <Card title="Site contacts" actions={site.canEdit && !adding && <Button variant="secondary" onClick={() => setAdding(true)}>+ Add</Button>}>
      <ErrorBanner error={save.error ?? library.error} />
      {adding && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-line p-3">
          <SelectField label="Contact" placeholder={library.loading ? 'Loading…' : 'Choose a contact'} options={options} value={contactId} onChange={(e) => setContactId(e.target.value)} />
          <TextField label="Role on this job (optional)" placeholder="e.g. Inspector, Superintendent" value={role} onChange={(e) => setRole(e.target.value)} />
          <p className="text-sm text-muted">
            Not in the list? Add them on the <a className="font-semibold text-brand-ink underline" href={paths.contactNew()}>Contacts</a> page first.
          </p>
          <div className="flex gap-2">
            <Button disabled={!contactId} busy={save.busy} onClick={() => void save.run([...current, { contactId, roleOnSite: role.trim() || null }])}>
              Add contact
            </Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {site.contacts.length ? (
        <ul className="divide-y divide-line">
          {site.contacts.map((c) => (
            <li key={c.contactId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block font-semibold text-ink">
                  {c.name}
                  {c.businessName ? ` — ${c.businessName}` : ''}
                </span>
                <span className="block text-sm text-muted">
                  {[c.roleOnSite, CONTACT_TYPE_LABELS[c.type]].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {(c.cell || c.phone) && (
                  <Button variant="secondary" onClick={() => void platform.openExternal(`tel:${(c.cell || c.phone)!.replace(/[^\d+]/g, '')}`)}>
                    Call
                  </Button>
                )}
                {c.email && (
                  <Button variant="secondary" onClick={() => void platform.openExternal(`mailto:${c.email}`)}>
                    Email
                  </Button>
                )}
                {site.canEdit && (
                  <Button variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => void save.run(current.filter((x) => x.contactId !== c.contactId))}>
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !adding && <EmptyState title="No contacts yet" />
      )}
    </Card>
  );
}

function EmailRoutingCard({ site, onChanged }: { site: SiteDetail; onChanged: () => void }) {
  const { api } = useAuthed();
  const [kind, setKind] = useState<EmailRecipientKind>('PROCUREMENT');
  const [email, setEmail] = useState('');
  const company = useAsync(
    () => (site.type === 'JOB' && site.companyId ? api.companies.get(site.companyId) : Promise.resolve(null)),
    [api, site.companyId, site.type],
  );
  const add = useAction(async () => {
    await api.sites.addEmailRoute(site.id, { kind, email });
    setEmail('');
    onChanged();
  });
  const remove = useAction(async (rid: string) => {
    await api.sites.removeEmailRoute(site.id, rid);
    onChanged();
  });

  return (
    <Card title="Order emails">
      <p className="mb-3 text-muted">When an order is submitted for this {site.type === 'JOB' ? 'job' : 'yard'}, Bowron emails:</p>
      <ErrorBanner error={add.error ?? remove.error} />
      <div className="flex flex-col gap-4">
        {EMAIL_RECIPIENT_KINDS.map((k) => {
          const companyList = (company.data?.emailRecipients ?? []).filter((r) => r.kind === k);
          const extras = site.emailRoutes.filter((r) => r.kind === k);
          return (
            <div key={k}>
              <h3 className="font-semibold text-ink">{EMAIL_RECIPIENT_LABELS[k]}</h3>
              {companyList.length + extras.length === 0 ? (
                <p className="text-sm text-muted">Nobody yet.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {companyList.map((r) => (
                    <li key={r.id} className="flex min-h-10 items-center gap-2 text-ink">
                      <span className="break-all">{r.email}</span> <Badge>Company</Badge>
                    </li>
                  ))}
                  {extras.map((r) => (
                    <li key={r.id} className="flex min-h-10 flex-wrap items-center gap-2 text-ink">
                      <span className="break-all">{r.email}</span> <Badge tone="brand">This job</Badge>
                      {site.canEdit && (
                        <Button variant="ghost" aria-label={`Remove ${r.email}`} onClick={() => void remove.run(r.id)}>
                          Remove
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {site.canEdit && (
        <form
          className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void add.run();
          }}
        >
          <div className="sm:w-44">
            <SelectField
              label="Send"
              value={kind}
              onChange={(e) => setKind(e.target.value as EmailRecipientKind)}
              options={EMAIL_RECIPIENT_KINDS.map((k) => ({ value: k, label: EMAIL_RECIPIENT_LABELS[k] }))}
            />
          </div>
          <div className="flex-1">
            <TextField label="Extra email for this job" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError(add.error, 'email')} />
          </div>
          <Button type="submit" disabled={!email} busy={add.busy}>
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}
