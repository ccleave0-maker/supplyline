'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { contrastRatio, readableTextOn } from '../domain/color';
import { EMAIL_RECIPIENT_KINDS, EMAIL_RECIPIENT_LABELS, type BrandingImageKind, type CompanyDetail, type EmailRecipientKind, ROLES, ROLE_LABELS, type Role } from '../models';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, CompanyMark, ErrorBanner, List, ListRow, PageHeader, PageLoading, SelectField, TextField , Checkbox } from '../ui/components';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { CostCodesCard } from './cost-codes';
import { PurchasingSettingsCard } from './emails';

export function CompaniesScreen() {
  const { api, refreshMe } = useAuthed();
  const companies = useAsync(() => api.companies.list(), [api]);
  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);
  return (
    <div>
      <PageHeader title="Companies" subtitle="Names, colours, logos, login backgrounds and order email lists." actions={<ButtonLink href={paths.companyNew()}>+ New company</ButtonLink>} />
      <ErrorBanner error={companies.error} onRetry={companies.reload} />
      {companies.loading && !companies.data ? (
        <PageLoading />
      ) : (
        <List>
          {(companies.data ?? []).map((c) => (
            <ListRow
              key={c.id}
              href={paths.companyEdit(c.id)}
              title={
                <span className="flex items-center gap-3">
                  <CompanyMark name={c.name} code={c.code} logoUrl={api.fileUrl(c.logoUrl)} color={c.themeColor} size={36} />
                  {c.name}
                </span>
              }
              right={<span className="h-6 w-6 rounded-full border border-line" style={{ background: c.themeColor }} aria-label={`Colour ${c.themeColor}`} />}
            />
          ))}
        </List>
      )}
    </div>
  );
}

export function CompanyEditScreen() {
  const id = useSearchParams().get('id');
  const router = useRouter();
  const { api, refreshMe } = useAuthed();
  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [form, setForm] = useState({ name: '', code: '', themeColor: '#E8701A' });
  const [priceRoles, setPriceRoles] = useState<Role[]>(['ADMIN', 'PROCUREMENT']);
  const [loadError, setLoadError] = useState<unknown>(null);

  const load = async () => {
    if (!id) return;
    try {
      const d = await api.companies.get(id);
      setDetail(d);
      setForm({ name: d.name, code: d.code, themeColor: d.themeColor });
      setPriceRoles(d.priceRoles);
    } catch (e) {
      setLoadError(e);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id]);

  const save = useAction(async () => {
    if (id) {
      await api.companies.update(id, { ...form, priceRoles });
      await refreshMe();
      await load();
    } else {
      const c = await api.companies.create(form);
      await refreshMe();
      router.replace(paths.companyEdit(c.id));
    }
  });

  if (loadError) return <ErrorBanner error={loadError} />;
  if (id && !detail) return <PageLoading />;
  const err = (f: string) => fieldError(save.error, f);
  const validColor = /^#[0-9a-f]{6}$/i.test(form.themeColor);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.companies()} title={id ? form.name || 'Company' : 'New company'} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save.run();
        }}
      >
        <Card title="Details">
          <ErrorBanner error={save.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Company name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={err('name')} />
            <TextField
              label="Short code"
              hint="2–8 letters, shown when there's no logo"
              required
              autoCapitalize="characters"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              error={err('code')}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="theme-color" className="text-sm font-semibold text-ink">
                Theme colour
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="theme-color"
                  type="color"
                  value={validColor ? form.themeColor : '#000000'}
                  onChange={(e) => setForm({ ...form, themeColor: e.target.value.toUpperCase() })}
                  className="h-12 w-16 cursor-pointer rounded-lg border border-line bg-surface"
                />
                <input
                  aria-label="Theme colour hex code"
                  value={form.themeColor}
                  onChange={(e) => setForm({ ...form, themeColor: e.target.value })}
                  className="min-h-12 w-32 rounded-lg border border-line bg-surface px-3 font-mono text-ink"
                />
              </div>
              {err('themeColor') && <p className="text-sm text-danger">{err('themeColor')}</p>}
            </div>
            {validColor && (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-ink">Preview</span>
                <span className="inline-flex min-h-12 items-center justify-center rounded-lg px-4 font-semibold" style={{ background: form.themeColor, color: readableTextOn(form.themeColor) }}>
                  Sample button
                </span>
                <span className="text-sm text-muted">
                  Text contrast {contrastRatio(form.themeColor, readableTextOn(form.themeColor)).toFixed(1)}:1 (4.5 or more reads well outdoors)
                </span>
              </div>
            )}
          </div>
          {id && (
            <fieldset className="mt-4">
              <legend className="font-semibold text-ink">Who sees prices on order lists</legend>
              <p className="text-sm text-muted">Unit and extended cost. A job's project manager always sees prices for their job.</p>
              {ROLES.map((r) => (
                <Checkbox
                  key={r}
                  label={ROLE_LABELS[r]}
                  checked={priceRoles.includes(r)}
                  onChange={(v) => setPriceRoles((x) => (v ? [...x, r] : x.filter((y) => y !== r)))}
                />
              ))}
            </fieldset>
          )}
          <div className="mt-4">
            <Button type="submit" busy={save.busy}>
              {id ? 'Save details' : 'Create company'}
            </Button>
          </div>
        </Card>
      </form>

      {detail && (
        <>
          <BrandingImages company={detail} onChanged={load} />
          <Recipients company={detail} onChanged={load} />
          <PurchasingSettingsCard companyId={detail.id} />
          <CostCodesCard companyId={detail.id} />
        </>
      )}
    </div>
  );
}

function BrandingImages({ company, onChanged }: { company: CompanyDetail; onChanged: () => Promise<void> }) {
  const { api, refreshMe } = useAuthed();
  const platform = usePlatform();
  const upload = useAction(async (kind: BrandingImageKind) => {
    const [file] = await platform.camera.pickImages({ multiple: false });
    if (!file) return;
    await api.companies.setImage(company.id, kind, file.blob, file.name);
    await Promise.all([onChanged(), refreshMe()]);
  });
  const clear = useAction(async (kind: BrandingImageKind) => {
    await api.companies.clearImage(company.id, kind);
    await Promise.all([onChanged(), refreshMe()]);
  });
  const logo = api.fileUrl(company.logoUrl);
  const bg = api.fileUrl(company.loginBackgroundUrl);

  return (
    <Card title="Logo & login background">
      <ErrorBanner error={upload.error ?? clear.error} />
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-ink">Logo</h3>
          <p className="text-sm text-muted">Shown in the app, on emails and PDFs. PNG or SVG with a transparent background works best (max 2 MB).</p>
          <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-line bg-surface-2 p-3">
            <CompanyMark name={company.name} code={company.code} logoUrl={logo} color={company.themeColor} size={64} />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" busy={upload.busy} onClick={() => void upload.run('logo')}>
              {logo ? 'Replace logo' : 'Upload logo'}
            </Button>
            {logo && (
              <Button variant="ghost" onClick={() => void clear.run('logo')}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="font-semibold text-ink">Login background photo</h3>
          <p className="text-sm text-muted">A wide landscape photo of your equipment (JPG, max 8 MB).</p>
          <div
            className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-dashed border-line"
            style={{ background: bg ? undefined : company.themeColor }}
          >
            {bg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={bg} alt="Login background" className="h-full w-full object-cover" />
            ) : (
              <span className="rounded bg-black/40 px-3 py-1 text-sm font-semibold text-white">Photo slot — no image yet</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" busy={upload.busy} onClick={() => void upload.run('background')}>
              {bg ? 'Replace photo' : 'Upload photo'}
            </Button>
            {bg && (
              <Button variant="ghost" onClick={() => void clear.run('background')}>
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Recipients({ company, onChanged }: { company: CompanyDetail; onChanged: () => Promise<void> }) {
  const { api } = useAuthed();
  const [kind, setKind] = useState<EmailRecipientKind>('PROCUREMENT');
  const [email, setEmail] = useState('');
  const add = useAction(async () => {
    await api.companies.addRecipient(company.id, { kind, email });
    setEmail('');
    await onChanged();
  });
  const remove = useAction(async (rid: string) => {
    await api.companies.removeRecipient(company.id, rid);
    await onChanged();
  });

  return (
    <Card title="Order email lists">
      <p className="mb-3 text-muted">These people get emailed for every job in this company. Each job can add extra people on its own profile.</p>
      <ErrorBanner error={add.error ?? remove.error} />
      {EMAIL_RECIPIENT_KINDS.map((k) => {
        const list = company.emailRecipients.filter((r) => r.kind === k);
        return (
          <div key={k} className="mb-4">
            <h3 className="font-semibold text-ink">{EMAIL_RECIPIENT_LABELS[k]}</h3>
            {list.length === 0 ? (
              <p className="text-sm text-muted">Nobody yet.</p>
            ) : (
              <ul>
                {list.map((r) => (
                  <li key={r.id} className="flex min-h-12 flex-wrap items-center gap-2 text-ink">
                    <span className="break-all">{r.email}</span>
                    <Button variant="ghost" aria-label={`Remove ${r.email}`} onClick={() => void remove.run(r.id)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <form
        className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void add.run();
        }}
      >
        <div className="sm:w-44">
          <SelectField label="List" value={kind} onChange={(e) => setKind(e.target.value as EmailRecipientKind)} options={EMAIL_RECIPIENT_KINDS.map((k) => ({ value: k, label: EMAIL_RECIPIENT_LABELS[k] }))} />
        </div>
        <div className="flex-1">
          <TextField label="Email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldError(add.error, 'email')} />
        </div>
        <Button type="submit" disabled={!email} busy={add.busy}>
          Add
        </Button>
      </form>
      <p className="mt-3 text-sm text-muted">
        <Badge>Tip</Badge> Any email address works, including Gmail.
      </p>
    </Card>
  );
}
