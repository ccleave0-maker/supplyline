'use client';

import { useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { DEFAULT_PM_WEEKLY, REPORT_PERIODS, REPORT_PRESETS, REPORT_SOURCES, type BuiltReportPreview, type PmWeeklySettings, type ReportSchedule, type ReportSource, type SavedReportInput, type SavedReportView } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Button, ButtonLink, Card, Checkbox, EmptyState, ErrorBanner, Notice, PageHeader, SelectField, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: new Date(2000, 0, 1, h).toLocaleTimeString('en-CA', { hour: 'numeric' }) }));
/** Sources a site/PM user can report on (their own jobs); money and Sage data need reports access. */
const OPEN_SOURCES: ReportSource[] = ['JOB_MATERIALS', 'LOADS', 'RECEIPTS', 'ACTION_ITEMS', 'JOBS'];
const fieldsOf = (d: ReportSource) => (REPORT_SOURCES[d] as { fields: readonly (readonly [string, string])[] }).fields;
const blank = (): SavedReportInput => ({ name: '', sections: [{ dataset: 'JOB_MATERIALS', title: '', columns: fieldsOf('JOB_MATERIALS').slice(0, 6).map(([k]) => k) }], filters: { period: 'LAST_30', siteIds: [] }, format: 'xlsx', schedule: null, recipients: [] });
const fileSafe = (s: string) => s.replace(/[^\w\- ]+/g, ' ').trim().replace(/\s+/g, '-') || 'report';

/** "Send it on its own" — used by saved reports and export mappings. */
export function ScheduleFields({ value, onChange, recipients, onRecipients }: { value: ReportSchedule | null | undefined; onChange: (s: ReportSchedule | null) => void; recipients: string[]; onRecipients: (r: string[]) => void }) {
  const [text, setText] = useState(recipients.join(', '));
  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      <Checkbox label="Send it on a schedule" description="Emailed as an attachment to the people below." checked={!!value} onChange={(on) => onChange(on ? { frequency: 'WEEKLY', weekday: 1, monthDay: 1, hour: 7 } : null)} />
      {value && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label="How often" value={value.frequency} onChange={(e) => onChange({ ...value, frequency: e.target.value as ReportSchedule['frequency'] })} options={[{ value: 'DAILY', label: 'Every day' }, { value: 'WEEKLY', label: 'Every week' }, { value: 'MONTHLY', label: 'Every month' }]} />
          {value.frequency === 'WEEKLY' && <SelectField label="On" value={String(value.weekday)} onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />}
          {value.frequency === 'MONTHLY' && <SelectField label="Day of the month" value={String(value.monthDay)} onChange={(e) => onChange({ ...value, monthDay: Number(e.target.value) })} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />}
          <SelectField label="At" value={String(value.hour)} onChange={(e) => onChange({ ...value, hour: Number(e.target.value) })} options={HOURS} />
          <TextField
            label="Send to"
            hint="Emails, separated by commas"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              onRecipients(e.target.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean));
            }}
          />
        </div>
      )}
    </div>
  );
}

function PreviewTable({ preview }: { preview: BuiltReportPreview }) {
  return (
    <Card title={`Preview — ${preview.period.from} to ${preview.period.to}`}>
      {preview.sections.map((s, i) => (
        <div key={i} className="mb-4">
          <p className="font-semibold text-ink">
            {s.title} <span className="text-sm font-normal text-muted">({s.total} rows{s.total > s.rows.length ? `, first ${s.rows.length} shown` : ''})</span>
          </p>
          {s.rows.length === 0 ? (
            <p className="text-sm text-muted">Nothing for those filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    {s.columns.map((c) => (
                      <th key={c.key} className="px-2 py-1">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r, j) => (
                    <tr key={j} className="border-t border-line">
                      {s.columns.map((c) => (
                        <td key={c.key} className="px-2 py-1 text-ink">
                          {r[c.key] == null ? '—' : typeof r[c.key] === 'number' ? (r[c.key] as number).toLocaleString('en-CA') : r[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

function PmWeeklyCard() {
  const { api } = useAuthed();
  const cur = useAsync(() => api.reports.pmWeekly(), [api]);
  const [s, setS] = useState<PmWeeklySettings | null>(null);
  const v = s ?? cur.data ?? DEFAULT_PM_WEEKLY;
  const save = useAction(async () => setS(await api.reports.savePmWeekly(v)));
  return (
    <Card title="Weekly update to project managers">
      <p className="text-sm text-muted">Each active job’s project manager gets an email: what’s still outstanding on their order lists and what’s arriving this week.</p>
      <Checkbox label="Send the weekly update" checked={v.enabled} onChange={(enabled) => setS({ ...v, enabled })} />
      {v.enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="On" value={String(v.weekday)} onChange={(e) => setS({ ...v, weekday: Number(e.target.value) })} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
          <SelectField label="At" value={String(v.hour)} onChange={(e) => setS({ ...v, hour: Number(e.target.value) })} options={HOURS} />
        </div>
      )}
      <ErrorBanner error={cur.error || save.error} />
      <Button className="mt-2" variant="secondary" busy={save.busy} disabled={!s} onClick={() => void save.run()}>
        Save
      </Button>
    </Card>
  );
}

export function ReportBuilderScreen() {
  const platform = usePlatform();
  const { api, me } = useAuthed();
  const full = can(me.user, 'reports:view');
  const sources = (Object.keys(REPORT_SOURCES) as ReportSource[]).filter((k) => full || OPEN_SOURCES.includes(k));
  const saved = useAsync(() => api.reports.saved(), [api]);
  const jobs = useAsync(() => api.sites.list({ type: 'JOB' }), [api]);
  const [editing, setEditing] = useState<{ id: string | null; r: SavedReportInput } | null>(null);
  const [preview, setPreview] = useState<BuiltReportPreview | null>(null);
  const [msg, setMsg] = useState('');
  const setR = (patch: Partial<SavedReportInput>) => {
    setPreview(null);
    setEditing((e) => (e ? { ...e, r: { ...e.r, ...patch } } : e));
  };
  const r = editing?.r;
  const setSection = (i: number, patch: Partial<SavedReportInput['sections'][number]>) => r && setR({ sections: r.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const doPreview = useAction(async () => r && setPreview(await api.reports.preview(r)));
  const download = useAction(async () => r && platform.files.saveFile(`${fileSafe(r.name)}.${r.format}`, await api.reports.file(r)));
  const save = useAction(async () => {
    if (!editing) return;
    if (editing.id) await api.reports.update(editing.id, editing.r);
    else await api.reports.create(editing.r);
    setMsg(`Saved “${editing.r.name}”.`);
    setEditing(null);
    await saved.reload();
  });
  const runSaved = useAction(async (s: SavedReportView) => platform.files.saveFile(`${fileSafe(s.name)}.${s.format}`, await api.reports.runSaved(s.id)));
  const remove = useAction(async (s: SavedReportView) => {
    await api.reports.remove(s.id);
    await saved.reload();
  });
  const edit = (id: string | null, input: SavedReportInput) => {
    setMsg('');
    setPreview(null);
    setEditing({ id, r: structuredClone(input) });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Report builder" subtitle="Pick the data, the fields and the jobs. Download it as Excel or PDF, save it, or have it emailed on a schedule." />
      <ButtonLink href={paths.reports()} variant="ghost">
        ← Ready-made reports
      </ButtonLink>
      {msg && <Notice>{msg}</Notice>}
      <ErrorBanner error={saved.error || runSaved.error || remove.error} />

      {!editing && (
        <>
          <Card title="Start from">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => edit(null, blank())}>+ Blank report</Button>
              {REPORT_PRESETS.filter((p) => p.report.sections.every((s) => sources.includes(s.dataset))).map((p) => (
                <Button key={p.key} variant="secondary" onClick={() => edit(null, p.report)}>
                  {p.label}
                </Button>
              ))}
            </div>
            <ul className="mt-2 text-sm text-muted">
              {REPORT_PRESETS.filter((p) => p.report.sections.every((s) => sources.includes(s.dataset))).map((p) => (
                <li key={p.key}>
                  <b>{p.label}:</b> {p.help}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Saved reports">
            {saved.data && saved.data.length === 0 && <EmptyState title="No saved reports yet">Build one above and save it to run it again or send it on a schedule.</EmptyState>}
            <ul className="flex flex-col divide-y divide-line">
              {(saved.data ?? []).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-ink">{s.name}</p>
                    <p className="text-sm text-muted">
                      {s.sections.length} section(s) · {s.format.toUpperCase()}
                      {s.schedule ? ` · sent ${s.schedule.frequency.toLowerCase()} to ${s.recipients.length} people` : ''}
                      {s.lastSentAt ? ` · last sent ${new Date(s.lastSentAt).toLocaleDateString('en-CA')}` : ''}
                      {s.createdByName ? ` · by ${s.createdByName}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button busy={runSaved.busy} onClick={() => void runSaved.run(s)}>
                      Download
                    </Button>
                    {s.canEdit && (
                      <>
                        <Button variant="secondary" onClick={() => edit(s.id, { name: s.name, sections: s.sections, filters: s.filters, format: s.format, schedule: s.schedule, recipients: s.recipients })}>
                          Edit
                        </Button>
                        <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run(s)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          {can(me.user, 'org:manage') && <PmWeeklyCard />}
        </>
      )}

      {editing && r && (
        <>
          <Card title={editing.id ? 'Edit report' : 'New report'}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="Name" value={r.name} onChange={(e) => setR({ name: e.target.value })} />
              <SelectField label="Dates" value={r.filters.period} onChange={(e) => setR({ filters: { ...r.filters, period: e.target.value as SavedReportInput['filters']['period'] } })} options={REPORT_PERIODS.map((p) => ({ value: p.key, label: p.label }))} />
              {r.filters.period === 'CUSTOM' && (
                <>
                  <TextField label="From" type="date" value={r.filters.from ?? ''} onChange={(e) => setR({ filters: { ...r.filters, from: e.target.value } })} />
                  <TextField label="To" type="date" value={r.filters.to ?? ''} onChange={(e) => setR({ filters: { ...r.filters, to: e.target.value } })} />
                </>
              )}
              <SelectField label="File" value={r.format} onChange={(e) => setR({ format: e.target.value as 'xlsx' })} options={[{ value: 'xlsx', label: 'Excel (a sheet per section)' }, { value: 'pdf', label: 'PDF' }]} />
              {me.companies.length > 1 && <SelectField label="Company" value={r.filters.companyId ?? ''} onChange={(e) => setR({ filters: { ...r.filters, companyId: e.target.value || null } })} options={[{ value: '', label: 'All companies' }, ...me.companies.map((c) => ({ value: c.id, label: c.name }))]} />}
            </div>
            <SelectField
              label="Jobs"
              hint="Pick one to add it. Leave empty for every job you can see."
              value=""
              onChange={(e) => e.target.value && setR({ filters: { ...r.filters, siteIds: [...new Set([...r.filters.siteIds, e.target.value])] } })}
              options={[{ value: '', label: r.filters.siteIds.length ? 'Add another job…' : 'All jobs' }, ...(jobs.data ?? []).filter((j) => !r.filters.siteIds.includes(j.id)).map((j) => ({ value: j.id, label: `${j.jobNumber} ${j.name}` }))]}
            />
            {r.filters.siteIds.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-2">
                {r.filters.siteIds.map((id) => {
                  const j = jobs.data?.find((x) => x.id === id);
                  return (
                    <Button key={id} variant="ghost" onClick={() => setR({ filters: { ...r.filters, siteIds: r.filters.siteIds.filter((x) => x !== id) } })}>
                      {j ? `${j.jobNumber} ${j.name}` : 'Job'} ✕
                    </Button>
                  );
                })}
              </div>
            )}
          </Card>

          {r.sections.map((s, i) => (
            <Card
              key={i}
              title={`Section ${i + 1}`}
              actions={
                r.sections.length > 1 && (
                  <Button variant="ghost" onClick={() => setR({ sections: r.sections.filter((_, j) => j !== i) })}>
                    Remove section
                  </Button>
                )
              }
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Data" value={s.dataset} onChange={(e) => setSection(i, { dataset: e.target.value as ReportSource, columns: fieldsOf(e.target.value as ReportSource).slice(0, 6).map(([k]) => k) })} options={sources.map((k) => ({ value: k, label: REPORT_SOURCES[k].label }))} />
                <TextField label="Section title" placeholder={REPORT_SOURCES[s.dataset].label} value={s.title ?? ''} onChange={(e) => setSection(i, { title: e.target.value })} />
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">Fields (in the order you tick them)</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                {fieldsOf(s.dataset).map(([k, label]) => (
                  <Checkbox key={k} label={label} checked={s.columns.includes(k)} onChange={(on) => setSection(i, { columns: on ? [...s.columns, k] : s.columns.filter((c) => c !== k) })} />
                ))}
              </div>
            </Card>
          ))}
          {r.sections.length < 10 && (
            <Button variant="secondary" onClick={() => setR({ sections: [...r.sections, { dataset: 'LOADS', title: '', columns: fieldsOf('LOADS').slice(0, 6).map(([k]) => k) }] })}>
              + Add a section
            </Button>
          )}

          <Card>
            <ScheduleFields value={r.schedule} onChange={(schedule) => setR({ schedule })} recipients={r.recipients} onRecipients={(recipients) => setR({ recipients })} />
            <ErrorBanner error={doPreview.error || download.error || save.error} />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" busy={doPreview.busy} onClick={() => void doPreview.run()}>
                Preview
              </Button>
              <Button variant="secondary" busy={download.busy} onClick={() => void download.run()}>
                Download {r.format === 'pdf' ? 'PDF' : 'Excel'}
              </Button>
              <Button busy={save.busy} disabled={!r.name.trim()} onClick={() => void save.run()}>
                Save report
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </Card>
          {preview && <PreviewTable preview={preview} />}
        </>
      )}
    </div>
  );
}
