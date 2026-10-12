'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CONTACT_TYPE_LABELS, CONTACT_TYPES, type ContactInput, type ContactType } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Button, ButtonLink, Card, Checkbox, EmailLink, EmptyState, ErrorBanner, List, ListRow, PageHeader, PageLoading, PhoneLink, SelectField, TextArea, TextField } from '../ui/components';
import { fieldError, useAction, useAsync, useDebounced } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { SupplierImportCard } from './documents';
import { applyRowOps, str, VoiceButton } from '../ui/voice';
import { ExportButtons } from '../ui/export';
import { ComplianceCard } from './projects';

export function ContactsScreen() {
  const { api, me } = useAuthed();
  const [q, setQ] = useState('');
  const [type, setType] = useState<ContactType | ''>('');
  const search = useDebounced(q.trim());
  const contacts = useAsync(() => api.contacts.list({ q: search || undefined, type: type || undefined }), [api, search, type]);

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Trucking companies, vendors, businesses and people — shared across your companies."
        actions={can(me.user, 'contact:edit') && <ButtonLink href={paths.contactNew()}>+ New contact</ButtonLink>}
      />
      <SupplierImportCard />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
        <TextField label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, business, phone or email" />
        <SelectField
          label="Type"
          placeholder="All types"
          value={type}
          onChange={(e) => setType(e.target.value as ContactType | '')}
          options={CONTACT_TYPES.map((t) => ({ value: t, label: CONTACT_TYPE_LABELS[t] }))}
        />
      </div>
      <ErrorBanner error={contacts.error} onRetry={contacts.reload} />
      {(contacts.data?.length ?? 0) > 0 && (
        <ExportButtons
          title="Contacts"
          columns={[
            { key: 'business', label: 'Business', width: 1.8 },
            { key: 'name', label: 'Name', width: 1.4 },
            { key: 'type', label: 'Type' },
            { key: 'phone', label: 'Phone' },
            { key: 'cell', label: 'Cell' },
            { key: 'email', label: 'Email', width: 1.8 },
          ]}
          rows={(contacts.data ?? []).map((c) => ({ business: c.businessName, name: c.name, type: CONTACT_TYPE_LABELS[c.type], phone: c.phone, cell: c.cell, email: c.email }))}
        />
      )}
      {contacts.loading && !contacts.data ? (
        <PageLoading />
      ) : contacts.data?.length ? (
        <List>
          {contacts.data.map((c) => (
            <ListRow
              key={c.id}
              href={paths.contactEdit(c.id)}
              title={c.businessName ? `${c.businessName} — ${c.name}` : c.name}
              subtitle={[CONTACT_TYPE_LABELS[c.type], c.cell || c.phone, c.email].filter(Boolean).join(' · ')}
            />
          ))}
        </List>
      ) : (
        <EmptyState title="No contacts found" />
      )}
    </div>
  );
}

const blank: ContactInput = { type: 'TRUCKING', name: '', businessName: '', phone: '', cell: '', email: '', notes: '', active: true };

export function ContactEditScreen() {
  const id = useSearchParams().get('id');
  const router = useRouter();
  const { api, me } = useAuthed();
  const [form, setForm] = useState<ContactInput>(blank);
  const [loaded, setLoaded] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const editable = can(me.user, 'contact:edit');
  const set = <K extends keyof ContactInput>(k: K, v: ContactInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!id) return;
    api.contacts
      .list({ includeInactive: true })
      .then((all) => {
        const c = all.find((x) => x.id === id);
        if (!c) throw new Error('Contact not found.');
        setForm({ type: c.type, name: c.name, businessName: c.businessName ?? '', phone: c.phone ?? '', cell: c.cell ?? '', email: c.email ?? '', notes: c.notes ?? '', active: c.active, isApContact: c.isApContact });
        setLoaded(true);
      })
      .catch(setLoadError);
  }, [api, id]);

  const save = useAction(async () => {
    if (id) await api.contacts.update(id, form);
    else await api.contacts.create(form);
    router.replace(paths.contacts());
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useAction(async () => {
    await api.contacts.remove(id!);
    router.replace(paths.contacts());
  });

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!loaded) return <PageLoading />;
  const err = (f: string) => fieldError(save.error, f);

  return (
    <>
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
      className="flex flex-col gap-4"
    >
      <PageHeader back={paths.contacts()} title={id ? 'Contact' : 'New contact'} />
      <div className="flex justify-end">
        <VoiceButton
          target={{
            screen: 'contact',
            schema: {
              title: 'Contact (trucking company, vendor, subcontractor, rental company, person…)',
              fields: [
                { key: 'type', label: 'Type', type: 'choice', options: CONTACT_TYPES.map((t) => ({ value: t, label: CONTACT_TYPE_LABELS[t] })) },
                { key: 'businessName', label: 'Business name', type: 'text' },
                { key: 'name', label: 'Contact name', type: 'text' },
                { key: 'email', label: 'Email', type: 'text' },
                { key: 'phone', label: 'Phone', type: 'text' },
                { key: 'cell', label: 'Cell', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'text' },
              ],
            },
            current: () => ({ values: { ...form }, rows: [] }),
            apply: (r) => setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(r.set).map(([k, v]) => [k, str(v)])) }) as ContactInput),
            snapshot: () => form,
            restore: setForm,
          }}
        />
      </div>
      <ErrorBanner error={save.error || remove.error} />
      {id && (form.phone || form.cell || form.email) && (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <PhoneLink number={form.cell} />
          <PhoneLink number={form.phone} />
          <EmailLink email={form.email} />
        </div>
      )}
      <Card>
        <fieldset disabled={!editable} className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Type" value={form.type} onChange={(e) => set('type', e.target.value as ContactType)} options={CONTACT_TYPES.map((t) => ({ value: t, label: CONTACT_TYPE_LABELS[t] }))} />
          <TextField label="Business name" value={form.businessName ?? ''} onChange={(e) => set('businessName', e.target.value)} />
          <TextField label="Contact name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={err('name')} />
          <TextField label="Email" type="email" inputMode="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} error={err('email')} />
          <TextField label="Phone" type="tel" inputMode="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          <TextField label="Cell" type="tel" inputMode="tel" value={form.cell ?? ''} onChange={(e) => set('cell', e.target.value)} />
          <div className="sm:col-span-2">
            <TextArea label="Notes" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {['VENDOR', 'SUBCONTRACTOR', 'RENTAL', 'TRUCKING', 'BUSINESS'].includes(form.type) && (
            <Checkbox label="Send invoice rejections to this person" description="Their accounts contact: rejected invoices are emailed here." checked={!!form.isApContact} onChange={(v) => set('isApContact', v)} />
          )}
          {id && <Checkbox label="Active" checked={form.active ?? true} onChange={(v) => set('active', v)} />}
        </fieldset>
      </Card>
      {editable && (
        <div className="flex gap-2">
          <Button type="submit" busy={save.busy}>
            {id ? 'Save changes' : 'Add contact'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          {id &&
            (confirmDelete ? (
              <Button type="button" variant="danger" busy={remove.busy} onClick={() => void remove.run()}>
                Yes, delete contact
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
        </div>
      )}
    </form>
    {id && ['VENDOR', 'SUBCONTRACTOR', 'RENTAL', 'TRUCKING'].includes(form.type) && (
      <div className="mt-4">
        <ComplianceCard contactId={id} />
      </div>
    )}
    </>
  );
}
