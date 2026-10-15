'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { PROVINCES, provinceCode, taxProfile } from '../domain/tax';
import type { GeocodeResult, SiteType } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Button, Card, Checkbox, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { fieldError, useAction } from '../ui/hooks';
import { MapView } from '../ui/map';
import { useAuthed } from '../ui/session';
import { applyRowOps, str, VoiceButton } from '../ui/voice';

interface Form {
  jobNumber: string;
  name: string;
  companyId: string;
  yardCompanyIds: string[];
  address: string;
  city: string;
  province: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  notes: string;
  active: boolean;
  clientName: string;
  startDate: string;
  projectManagerId: string;
  pstExempt: boolean;
  pstExemptNumber: string;
}

const empty: Form = {
  jobNumber: '',
  name: '',
  companyId: '',
  yardCompanyIds: [],
  address: '',
  city: '',
  province: '',
  postalCode: '',
  lat: null,
  lng: null,
  notes: '',
  active: true,
  clientName: '',
  startDate: '',
  projectManagerId: '',
  pstExempt: false,
  pstExemptNumber: '',
};

export function SiteEditScreen() {
  const params = useSearchParams();
  const id = params.get('id');
  const router = useRouter();
  const platform = usePlatform();
  const { api, me, activeCompany } = useAuthed();
  const [type, setType] = useState<SiteType>(params.get('type') === 'YARD' ? 'YARD' : 'JOB');
  const [form, setForm] = useState<Form>({ ...empty, companyId: activeCompany?.id ?? '', yardCompanyIds: activeCompany ? [activeCompany.id] : [] });
  const [loaded, setLoaded] = useState(!id);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Project manager: anyone in the organization (admins), otherwise the job's own people.
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (can(me.user, 'user:manage')) api.users.list().then((u) => setPeople(u.map((x) => ({ id: x.id, name: x.name })))).catch(() => undefined);
    else if (id) api.sites.get(id).then((s) => setPeople(s.members.map((m) => ({ id: m.userId, name: m.name })))).catch(() => undefined);
  }, [api, id, me.user]);

  useEffect(() => {
    if (!id) return;
    api.sites
      .get(id)
      .then((s) => {
        setType(s.type);
        setForm({
          jobNumber: s.jobNumber,
          name: s.name,
          companyId: s.companyId ?? '',
          yardCompanyIds: s.yardCompanyIds,
          address: s.address ?? '',
          city: s.city ?? '',
          province: provinceCode(s.province) ?? s.province ?? '',
          postalCode: s.postalCode ?? '',
          lat: s.lat,
          lng: s.lng,
          notes: s.notes ?? '',
          active: s.active,
          clientName: s.clientName ?? '',
          startDate: s.startDate ?? '',
          projectManagerId: s.projectManager?.id ?? '',
          pstExempt: s.pstExempt,
          pstExemptNumber: s.pstExemptNumber ?? '',
        });
        if (s.projectManager) setPeople((p) => (p.some((x) => x.id === s.projectManager!.id) ? p : [...p, { id: s.projectManager!.id, name: s.projectManager!.name }]));
        setLoaded(true);
      })
      .catch(setLoadError);
  }, [api, id]);

  const lookup = useAction(async () => {
    const q = query.trim() || [form.address, form.city, form.province].filter(Boolean).join(', ');
    setResults(await api.geocode(q));
  });

  const locate = useAction(async () => {
    const pos = await platform.location.getCurrentPosition();
    if (!pos) throw new Error("Couldn't get your location. Check that location access is allowed for Bowron.");
    setForm((f) => ({ ...f, lat: pos.lat, lng: pos.lng }));
  });

  const save = useAction(async () => {
    const common = {
      jobNumber: form.jobNumber,
      name: form.name,
      address: form.address,
      city: form.city,
      province: form.province,
      postalCode: form.postalCode,
      lat: form.lat,
      lng: form.lng,
      notes: form.notes,
      active: form.active,
      ...(type === 'YARD' ? { yardCompanyIds: form.yardCompanyIds } : {}),
      ...(type === 'JOB'
        ? {
            clientName: form.clientName,
            startDate: form.startDate || null,
            projectManagerId: form.projectManagerId || null,
            pstExempt: form.pstExempt,
            pstExemptNumber: form.pstExemptNumber,
          }
        : {}),
    };
    const r = id
      ? await api.sites.update(id, common)
      : await api.sites.create({ ...common, type, companyId: type === 'JOB' ? form.companyId : null });
    router.replace(paths.site(r.id));
  });

  if (loadError) return <ErrorBanner error={loadError} />;
  if (!loaded) return <PageLoading />;
  const err = (f: string) => fieldError(save.error, f);
  const companyOptions = me.companies.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <PageHeader back={id ? paths.site(id) : paths.sites(type)} title={id ? 'Edit details' : type === 'JOB' ? 'New job / project' : 'New yard'} />
      <div className="flex justify-end">
        <VoiceButton
          target={{
            screen: 'site',
            schema: {
              title: type === 'JOB' ? 'Job / project details' : 'Yard details',
              fields: [
                { key: 'jobNumber', label: type === 'JOB' ? 'Job number' : 'Yard code', type: 'text' },
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'address', label: 'Street address', type: 'text' },
                { key: 'city', label: 'City', type: 'text' },
                { key: 'province', label: 'Province', type: 'choice', options: PROVINCES.map((p) => ({ value: p.code, label: p.name })) },
                { key: 'postalCode', label: 'Postal code', type: 'text' },
                { key: 'notes', label: 'Notes', type: 'text' },
                ...(type === 'JOB'
                  ? [
                      { key: 'clientName', label: 'Client / owner', type: 'text' as const },
                      { key: 'startDate', label: 'Start date', type: 'date' as const },
                      { key: 'pstExempt', label: 'PST exempt', type: 'boolean' as const },
                      { key: 'pstExemptNumber', label: 'PST exemption #', type: 'text' as const },
                      { key: 'projectManagerId', label: 'Project manager', type: 'choice' as const, options: people.map((p) => ({ value: p.id, label: p.name })) },
                    ]
                  : []),
              ],
            },
            current: () => ({ values: { ...form }, rows: [] }),
            apply: (r) =>
              setForm((f) => {
                const next = { ...f };
                for (const [k, v] of Object.entries(r.set)) (next as Record<string, unknown>)[k] = k === 'pstExempt' ? !!v : str(v);
                return next;
              }),
            snapshot: () => form,
            restore: setForm,
          }}
        />
      </div>
      <ErrorBanner error={save.error} />

      <Card title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={type === 'JOB' ? 'Job / project number' : 'Yard code'}
            hint={type === 'JOB' ? 'As written on your paperwork, e.g. 2249 or 26-BC249' : 'Short code, e.g. Y1'}
            required
            value={form.jobNumber}
            onChange={(e) => set('jobNumber', e.target.value)}
            error={err('jobNumber')}
          />
          <TextField label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} error={err('name')} />
          {type === 'JOB' ? (
            <SelectField
              label="Company"
              required
              disabled={!!id}
              hint={id ? "A job's company can't be changed." : undefined}
              placeholder="Choose a company"
              options={companyOptions}
              value={form.companyId}
              onChange={(e) => set('companyId', e.target.value)}
              error={err('companyId')}
            />
          ) : (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-semibold text-ink">Companies this yard serves</legend>
              {me.companies.map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  checked={form.yardCompanyIds.includes(c.id)}
                  onChange={(on) => set('yardCompanyIds', on ? [...form.yardCompanyIds, c.id] : form.yardCompanyIds.filter((x) => x !== c.id))}
                />
              ))}
              {err('yardCompanyIds') && <p className="text-sm font-medium text-danger">{err('yardCompanyIds')}</p>}
            </fieldset>
          )}
          {id && <Checkbox label="Active" description="Inactive jobs are hidden from lists" checked={form.active} onChange={(v) => set('active', v)} />}
        </div>
      </Card>

      {type === 'JOB' && (
        <Card title="Project">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Project manager"
              placeholder="Not set"
              hint="The PM sees prices and subcontracts for this job."
              value={form.projectManagerId}
              onChange={(e) => set('projectManagerId', e.target.value)}
              options={people.map((p) => ({ value: p.id, label: p.name }))}
              error={err('projectManagerId')}
            />
            <TextField label="Client / owner" value={form.clientName} onChange={(e) => set('clientName', e.target.value)} />
            <TextField label="Start date" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
            <div className="sm:col-span-2">
              <Checkbox
                label="PST exempt"
                description="Every PO for this job will be marked PST exempt, with the exemption form attached (upload it on the job page)."
                checked={form.pstExempt}
                onChange={(v) => set('pstExempt', v)}
              />
              {form.pstExempt && (
                <div className="mt-2 pl-9">
                  <TextField label="PST exemption # (optional)" value={form.pstExemptNumber} onChange={(e) => set('pstExemptNumber', e.target.value)} />
                </div>
              )}
              <p className="mt-2 text-sm text-muted">Tax for this job: {taxProfile(form.province, form.pstExempt).label}</p>
            </div>
          </div>
        </Card>
      )}

      <Card title="Address & map pin">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Street address" autoComplete="street-address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          <TextField label="Town / city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          <SelectField
            label="Province"
            placeholder="Choose a province"
            hint={type === 'JOB' ? 'Decides whether PST applies (BC: yes; Alberta: no).' : undefined}
            value={form.province}
            onChange={(e) => set('province', e.target.value)}
            options={[
              ...PROVINCES.map((p) => ({ value: p.code, label: p.name })),
              ...(form.province && !provinceCode(form.province) ? [{ value: form.province, label: form.province }] : []),
            ]}
          />
          <TextField label="Postal code" autoCapitalize="characters" value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <TextField
              label="Find on map"
              type="search"
              placeholder="Leave blank to search the address above"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button type="button" variant="secondary" busy={lookup.busy} onClick={() => void lookup.run()}>
            Search
          </Button>
          <Button type="button" variant="secondary" busy={locate.busy} onClick={() => void locate.run()}>
            Use my location
          </Button>
        </div>
        <ErrorBanner error={lookup.error ?? locate.error} />
        {results && (
          <ul className="mt-2 flex flex-col gap-1">
            {results.length === 0 && <li className="text-muted">No matches. Try a nearby town, or tap the map to drop the pin.</li>}
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  className="min-h-12 w-full rounded-lg border border-line px-3 py-2 text-left text-ink hover:bg-surface-2"
                  onClick={() => {
                    setForm((f) => ({
                      ...f,
                      lat: r.lat,
                      lng: r.lng,
                      address: f.address || r.address || '',
                      city: f.city || r.city || '',
                      province: f.province || provinceCode(r.province) || r.province || '',
                      postalCode: f.postalCode || r.postalCode || '',
                    }));
                    setResults(null);
                  }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <Notice>Tap the map to place or move the pin.</Notice>
          <MapView
            label="Pick the site location"
            points={form.lat != null && form.lng != null ? [{ id: 'pin', lat: form.lat, lng: form.lng, label: form.name || 'Site' }] : []}
            onPick={(lat, lng) => setForm((f) => ({ ...f, lat, lng }))}
          />
          {form.lat != null && form.lng != null && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              Pin: {form.lat.toFixed(5)}, {form.lng.toFixed(5)}
              <Button type="button" variant="ghost" onClick={() => setForm((f) => ({ ...f, lat: null, lng: null }))}>
                Clear pin
              </Button>
            </p>
          )}
        </div>
      </Card>

      <Card title="Notes">
        <TextArea label="Notes (gate codes, delivery hours…)" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Card>

      <div className="flex gap-2">
        <Button type="submit" busy={save.busy}>
          {id ? 'Save changes' : type === 'JOB' ? 'Create job / project' : 'Create yard'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
