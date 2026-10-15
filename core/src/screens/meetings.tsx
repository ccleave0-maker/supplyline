'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlatform } from '@supplyline/platform';
import { MEETING_STEP_KINDS, STARTER_7030_TEMPLATE, type ActionItemView, type MeetingAttendee, type MeetingDetail, type MeetingStepDef, type MeetingStepState, type MeetingTemplateInput, type MeetingTemplateView, type SuggestedAction } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, cx, EmptyState, ErrorBanner, List, ListRow, Notice, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const STATUS: Record<string, string> = { PLANNED: 'Planned', IN_PROGRESS: 'In progress', DONE: 'Done' };
/** Recorded in pieces so each one stays small enough to transcribe. */
const PIECE_MS = 10 * 60_000;

// ---------------------------------------------------------------------------
// Meetings list + new meeting
// ---------------------------------------------------------------------------
export function MeetingsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { api, me } = useAuthed();
  const [siteId, setSiteId] = useState(params.get('siteId') ?? '');
  const [companyId, setCompanyId] = useState(me.user.companyId ?? me.companies[0]?.id ?? '');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [date, setDate] = useState('');
  const list = useAsync(() => api.meetings.list({ siteId: siteId || undefined }), [api, siteId]);
  const jobs = useAsync(() => api.sites.list({ type: 'JOB' }), [api]);
  const templates = useAsync(() => api.meetings.templates(), [api]);
  const people = useAsync(() => (adding ? api.meetings.people(siteId ? { siteId } : { companyId }) : Promise.resolve([])), [api, adding, siteId, companyId]);
  const job = jobs.data?.find((j) => j.id === siteId);

  useEffect(() => {
    if (job?.companyId) setCompanyId(job.companyId);
  }, [job]);
  const create = useAction(async () => {
    const m = await api.meetings.create({
      companyId,
      siteId: siteId || null,
      templateId: templateId || null,
      title: title.trim() || `${job ? `JOB#${job.jobNumber} ` : ''}${templates.data?.find((t) => t.id === templateId)?.name.replace(/\s*\(.*\)$/, '') ?? 'Meeting'} – ${new Date().toLocaleDateString('en-CA')}`,
      scheduledFor: date ? new Date(date).toISOString() : null,
      attendees: (people.data ?? []).map((p) => ({ userId: p.id, name: p.name, email: p.email, present: true })),
    });
    router.push(paths.meeting(m.id));
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Meetings"
        subtitle="Run the 70-30 (or any) meeting step by step, record it, catch the action items, and send the minutes."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setAdding(true)}>New meeting</Button>
            {can(me.user, 'meeting:template') && (
              <ButtonLink href={paths.meetingTemplates()} variant="secondary">
                Templates
              </ButtonLink>
            )}
          </div>
        }
      />
      <SelectField label="Job" placeholder="All meetings" value={siteId} onChange={(e) => setSiteId(e.target.value)} options={(jobs.data ?? []).map((j) => ({ value: j.id, label: `JOB#${j.jobNumber} ${j.name}` }))} />
      {adding && (
        <Card title="New meeting">
          <div className="grid gap-3 sm:grid-cols-2">
            {!siteId && me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
            <SelectField label="Template" placeholder="The default" value={templateId} onChange={(e) => setTemplateId(e.target.value)} options={(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
            <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly 70-30" />
            <TextField label="When (optional)" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <p className="mt-2 text-sm text-muted">
            {siteId ? 'Everyone on the job is added' : 'Everyone in the company is added'} as attending ({people.data?.length ?? 0}); untick anyone who isn’t there once it starts.
          </p>
          <ErrorBanner error={create.error} />
          <div className="mt-3 flex gap-2">
            <Button busy={create.busy} onClick={() => void create.run()}>
              Start
            </Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}
      <ErrorBanner error={list.error} />
      {list.data?.length === 0 && <EmptyState title="No meetings yet">Start one with “New meeting”.</EmptyState>}
      <List>
        {(list.data ?? []).map((m) => (
          <ListRow
            key={m.id}
            href={paths.meeting(m.id)}
            title={m.title}
            subtitle={[m.siteLabel, when(m.startedAt ?? m.scheduledFor), m.openActions ? `${m.openActions} open action item${m.openActions === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
            right={<Badge tone={m.status === 'DONE' ? 'ok' : m.status === 'IN_PROGRESS' ? 'brand' : 'neutral'}>{STATUS[m.status]}</Badge>}
          />
        ))}
      </List>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running a meeting
// ---------------------------------------------------------------------------
function useRecorder(onPiece: (b: Blob, n: number) => Promise<void>) {
  const platform = usePlatform();
  const [on, setOn] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [pieces, setPieces] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const rec = useRef<Awaited<ReturnType<typeof platform.speech.record>>>(null);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; piece?: ReturnType<typeof setInterval> }>({});
  const count = useRef(0);

  const flush = useCallback(async () => {
    const r = rec.current;
    rec.current = null;
    const blob = r ? await r.stop() : null;
    if (blob && blob.size > 0) {
      count.current += 1;
      setPieces(count.current);
      await onPiece(blob, count.current).catch(setError);
    }
  }, [onPiece]);

  const start = useCallback(async () => {
    setError(null);
    const r = await platform.speech.record();
    if (!r) return setError(new Error('Couldn’t use the microphone. Allow it for Bowron, or take notes by typing.'));
    rec.current = r;
    setOn(true);
    const began = Date.now();
    timers.current.tick = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 1000);
    timers.current.piece = setInterval(() => {
      void (async () => {
        await flush();
        rec.current = await platform.speech.record();
      })();
    }, PIECE_MS);
  }, [platform, flush]);

  const stop = useCallback(async () => {
    clearInterval(timers.current.tick);
    clearInterval(timers.current.piece);
    setOn(false);
    await flush();
  }, [flush]);

  useEffect(
    () => () => {
      clearInterval(timers.current.tick);
      clearInterval(timers.current.piece);
      rec.current?.cancel();
    },
    [],
  );
  return { on, seconds, pieces, error, start, stop };
}

function ActionRow({ a, onDone }: { a: ActionItemView; onDone?: (a: ActionItemView) => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div>
        <p className={cx('text-ink', a.status === 'DONE' && 'line-through opacity-70')}>{a.text}</p>
        <p className={cx('text-sm', a.overdue ? 'text-danger' : 'text-muted')}>
          {[a.assigneeName ?? 'No one yet', a.dueDate ? `due ${a.dueDate}${a.overdue ? ' (overdue)' : ''}` : null, a.meetingTitle && a.siteLabel ? a.meetingTitle : null, a.source === 'AI' ? 'found by AI' : null].filter(Boolean).join(' · ')}
        </p>
      </div>
      {onDone && a.status === 'OPEN' && (
        <Button variant="secondary" onClick={() => onDone(a)}>
          Done
        </Button>
      )}
    </li>
  );
}

export function MeetingRunScreen() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';
  const { api } = useAuthed();
  const loaded = useAsync(() => api.meetings.get(id), [api, id]);
  const [m, setM] = useState<MeetingDetail | null>(null);
  const [steps, setSteps] = useState<MeetingStepState[]>([]);
  const [step, setStep] = useState(0);
  const [attendees, setAttendees] = useState<MeetingAttendee[]>([]);
  const [summary, setSummary] = useState('');
  const [transcript, setTranscript] = useState('');
  const [newAction, setNewAction] = useState({ text: '', who: '', due: '' });
  const [suggestions, setSuggestions] = useState<SuggestedAction[] | null>(null);
  const [guest, setGuest] = useState({ name: '', email: '' });
  const [msg, setMsg] = useState('');
  const [emailMinutes, setEmailMinutes] = useState(true);
  const dirty = useRef(false);

  const take = useCallback((d: MeetingDetail) => {
    setM(d);
    setSteps(d.steps);
    setStep(d.currentStep);
    setAttendees(d.attendees);
    setSummary(d.summary ?? '');
    setTranscript(d.transcript ?? '');
    dirty.current = false;
  }, []);
  useEffect(() => {
    if (loaded.data) take(loaded.data);
  }, [loaded.data, take]);

  const save = useAction(async (extra: { currentStep?: number } = {}) => {
    if (!m) return;
    const d = await api.meetings.update(m.id, {
      ...extra,
      attendees: attendees.map((a) => ({ ...a, userId: a.userId ?? null })),
      steps: steps.map((s) => ({ key: s.key, notes: s.notes, checked: s.checked })),
      summary: summary || null,
      transcript: transcript || null,
    });
    setM(d);
    dirty.current = false;
  });
  const go = (i: number) => {
    setStep(i);
    void save.run({ currentStep: i });
  };
  const setStepState = (patch: Partial<MeetingStepState>) => {
    dirty.current = true;
    setSteps((ss) => ss.map((s, i) => (i === step ? { ...s, ...patch } : s)));
  };

  const onPiece = useCallback(
    async (blob: Blob, n: number) => {
      const r = await api.meetings.audio(id, blob, `meeting-part-${n}.webm`);
      if (r.text) setTranscript((t) => [t, r.text].filter(Boolean).join('\n\n'));
    },
    [api, id],
  );
  const recorder = useRecorder(onPiece);

  const addAction = useAction(async (a: { text: string; assigneeUserId: string | null; assigneeName: string | null; dueDate: string | null }, fromAi: boolean = false) => {
    if (!m) return;
    await api.meetings.addAction(m.id, { ...a, stepKey: steps[step]?.key ?? null }, fromAi);
    setM(await api.meetings.get(m.id));
  });
  const markDone = useAction(async (a: ActionItemView) => {
    await api.actionItems.update(a.id, { status: 'DONE' });
    if (m) setM(await api.meetings.get(m.id));
  });
  const suggest = useAction(async () => {
    await save.run();
    const r = await api.meetings.suggest(id);
    setSuggestions(r.suggestions);
    if (!summary.trim()) setSummary(r.summary);
  });
  const finish = useAction(async () => {
    if (recorder.on) await recorder.stop();
    await save.run();
    const d = await api.meetings.finish(id, emailMinutes);
    take(d);
    setMsg(d.emailed ? `Minutes made and sent to ${d.emailed} people.` : 'Minutes made.');
  });

  if (!m) return loaded.error ? <ErrorBanner error={loaded.error} /> : <PageLoading />;
  const cur = steps[step];
  const people = attendees.filter((a) => a.present);
  const ro = !m.canEdit;

  return (
    <div className="flex flex-col gap-4 pb-24 lg:pb-0">
      <PageHeader
        back={paths.meetings(m.siteId ?? undefined)}
        title={m.title}
        subtitle={[m.siteLabel, m.templateName, STATUS[m.status]].filter(Boolean).join(' · ')}
        actions={
          m.pdfUrl && (
            <ButtonLink href={m.pdfUrl} variant="secondary">
              Minutes (PDF)
            </ButtonLink>
          )
        }
      />
      <ErrorBanner error={save.error || recorder.error || addAction.error || markDone.error} />
      {msg && <Notice>{msg}</Notice>}

      <Card
        title="Recording"
        actions={
          !ro &&
          (recorder.on ? (
            <Button variant="danger" onClick={() => void recorder.stop()}>
              Stop recording
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void recorder.start()}>
              ● Record
            </Button>
          ))
        }
      >
        <p className="text-sm text-muted">
          {recorder.on ? `Recording… ${Math.floor(recorder.seconds / 60)}:${String(recorder.seconds % 60).padStart(2, '0')} · ` : ''}
          {m.audio.length + recorder.pieces} piece(s) saved
          {m.canTranscribe ? ' · turned into a transcript as you go' : ' · speech-to-text isn’t set up (Admin › AI), so recordings are kept but not transcribed'}
          . Tell everyone before you record.
        </p>
      </Card>

      <Card title={`Attending (${people.length})`}>
        <div className="grid gap-1 sm:grid-cols-2">
          {attendees.map((a, i) => (
            <Checkbox
              key={`${a.userId ?? a.name}-${i}`}
              label={a.name}
              description={a.userId ? undefined : (a.email ?? 'guest')}
              checked={a.present}
              disabled={ro}
              onChange={(v) => {
                dirty.current = true;
                setAttendees((as) => as.map((x, j) => (j === i ? { ...x, present: v } : x)));
              }}
            />
          ))}
        </div>
        {!ro && (
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <TextField label="Add a guest" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
            <TextField label="Their email (for the minutes)" type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
            <Button
              variant="secondary"
              disabled={!guest.name.trim()}
              onClick={() => {
                setAttendees((as) => [...as, { userId: null, name: guest.name.trim(), email: guest.email.trim() || null, present: true }]);
                setGuest({ name: '', email: '' });
                dirty.current = true;
              }}
            >
              Add
            </Button>
          </div>
        )}
      </Card>

      {/* Steps */}
      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Steps">
        {steps.map((s, i) => (
          <button key={s.key} type="button" onClick={() => go(i)} className={cx('min-h-12 shrink-0 rounded-lg border px-3 text-sm font-semibold', i === step ? 'border-brand bg-brand text-brand-fg' : 'border-line bg-surface text-ink')}>
            {i + 1}. {s.title}
          </button>
        ))}
      </nav>
      {cur && (
        <Card title={`${step + 1}. ${cur.title}${cur.minutes ? ` · ${cur.minutes} min` : ''}`}>
          {cur.prompt && <p className="mb-2 text-muted">{cur.prompt}</p>}
          {cur.kind === 'REVIEW_ACTIONS' && (
            <div className="mb-3">
              {m.carriedOver.length === 0 ? (
                <p className="text-sm text-muted">Nothing open from earlier meetings.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {m.carriedOver.map((a) => (
                    <ActionRow key={a.id} a={a} onDone={ro ? undefined : (x) => void markDone.run(x)} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {cur.kind === 'CHECKLIST' && (
            <div className="mb-3 flex flex-col gap-1">
              {cur.items.map((it) => (
                <Checkbox key={it} label={it} disabled={ro} checked={cur.checked.includes(it)} onChange={(v) => setStepState({ checked: v ? [...cur.checked, it] : cur.checked.filter((x) => x !== it) })} />
              ))}
            </div>
          )}
          <TextArea label="Notes" rows={6} disabled={ro} value={cur.notes} onChange={(e) => setStepState({ notes: e.target.value })} onBlur={() => dirty.current && void save.run()} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" disabled={step === 0} onClick={() => go(step - 1)}>
              ← Back
            </Button>
            {step < steps.length - 1 ? (
              <Button onClick={() => go(step + 1)}>Next step →</Button>
            ) : (
              <Button variant="secondary" busy={save.busy} onClick={() => void save.run()}>
                Save
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card
        title={`Action items (${m.actions.length})`}
        actions={
          !ro && (
            <Button variant="secondary" busy={suggest.busy} onClick={() => void suggest.run()}>
              Find action items (AI)
            </Button>
          )
        }
      >
        <ErrorBanner error={suggest.error} />
        {suggestions && (
          <div className="mb-3 rounded-lg border border-line p-2">
            <p className="font-semibold text-ink">Suggested — add the ones that are right</p>
            {suggestions.length === 0 && <p className="text-sm text-muted">No action items found.</p>}
            <ul className="divide-y divide-line">
              {suggestions.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-ink">{s.text}</p>
                    <p className="text-sm text-muted">{[s.assigneeName ?? 'No one named', s.dueDate ? `due ${s.dueDate}` : null].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        void addAction.run({ text: s.text, assigneeUserId: s.assigneeUserId, assigneeName: s.assigneeName, dueDate: s.dueDate }, true);
                        setSuggestions((ss) => ss?.filter((_, j) => j !== i) ?? null);
                      }}
                    >
                      Add
                    </Button>
                    <Button variant="ghost" onClick={() => setSuggestions((ss) => ss?.filter((_, j) => j !== i) ?? null)}>
                      Skip
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="divide-y divide-line">
          {m.actions.map((a) => (
            <ActionRow key={a.id} a={a} onDone={ro ? undefined : (x) => void markDone.run(x)} />
          ))}
        </ul>
        {!ro && (
          <div className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
            <TextField label="What" value={newAction.text} onChange={(e) => setNewAction({ ...newAction, text: e.target.value })} />
            <SelectField
              label="Who"
              placeholder="Choose"
              value={newAction.who}
              onChange={(e) => setNewAction({ ...newAction, who: e.target.value })}
              options={people.map((p, i) => ({ value: p.userId ? `u:${p.userId}` : `n:${i}:${p.name}`, label: p.name }))}
            />
            <TextField label="Due" type="date" value={newAction.due} onChange={(e) => setNewAction({ ...newAction, due: e.target.value })} />
            <Button
              disabled={!newAction.text.trim()}
              busy={addAction.busy}
              onClick={() => {
                const who = newAction.who;
                void addAction.run({
                  text: newAction.text.trim(),
                  assigneeUserId: who.startsWith('u:') ? who.slice(2) : null,
                  assigneeName: who.startsWith('n:') ? who.split(':').slice(2).join(':') : null,
                  dueDate: newAction.due || null,
                });
                setNewAction({ text: '', who: '', due: '' });
              }}
            >
              Add
            </Button>
          </div>
        )}
      </Card>

      <Card title="Summary">
        <TextArea label="Summary for the minutes" rows={4} disabled={ro} value={summary} onChange={(e) => ((dirty.current = true), setSummary(e.target.value))} onBlur={() => dirty.current && void save.run()} />
      </Card>
      <Card title="Transcript">
        <TextArea label="Transcript (you can correct it)" rows={transcript ? 8 : 2} disabled={ro} value={transcript} onChange={(e) => ((dirty.current = true), setTranscript(e.target.value))} onBlur={() => dirty.current && void save.run()} />
      </Card>

      {!ro && (
        <Card title="Finish">
          <Checkbox label="Email the minutes to everyone who attended" description="As a PDF. A copy is also saved to the job’s Meetings folder if network filing is on." checked={emailMinutes} onChange={setEmailMinutes} />
          <ErrorBanner error={finish.error} />
          <Button className="mt-3" busy={finish.busy} onClick={() => void finish.run()}>
            {m.status === 'DONE' ? 'Make the minutes again' : 'Finish and make the minutes'}
          </Button>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------
export function ActionItemsScreen() {
  const { api } = useAuthed();
  const [mine, setMine] = useState(true);
  const [status, setStatus] = useState<'OPEN' | 'DONE' | 'ALL'>('OPEN');
  const list = useAsync(() => api.actionItems.list({ mine, status }), [api, mine, status]);
  const done = useAction(async (a: ActionItemView) => {
    await api.actionItems.update(a.id, { status: 'DONE' });
    await list.reload();
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Action items" subtitle="Who’s doing what by when, from your meetings." />
      <div className="flex flex-wrap gap-2">
        <Button variant={mine ? 'primary' : 'secondary'} onClick={() => setMine(true)}>
          Mine
        </Button>
        <Button variant={!mine ? 'primary' : 'secondary'} onClick={() => setMine(false)}>
          Everyone’s
        </Button>
        <SelectField
          label="Show"
          value={status}
          onChange={(e) => setStatus(e.target.value as 'OPEN')}
          options={[
            { value: 'OPEN', label: 'Open' },
            { value: 'DONE', label: 'Done' },
            { value: 'ALL', label: 'All' },
          ]}
        />
      </div>
      <ErrorBanner error={list.error || done.error} />
      {list.data?.length === 0 && <EmptyState title={status === 'OPEN' ? 'Nothing open' : 'Nothing here'} />}
      <Card>
        <ul className="divide-y divide-line">
          {(list.data ?? []).map((a) => (
            <div key={a.id}>
              <ActionRow a={{ ...a, meetingTitle: a.meetingTitle }} onDone={(x) => void done.run(x)} />
              {a.meetingId && (
                <a href={paths.meeting(a.meetingId)} className="text-sm text-brand-ink underline">
                  {[a.siteLabel, a.meetingTitle].filter(Boolean).join(' · ')}
                </a>
              )}
            </div>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Templates (admin)
// ---------------------------------------------------------------------------
const KIND_LABEL: Record<(typeof MEETING_STEP_KINDS)[number], string> = { NOTES: 'Notes', REVIEW_ACTIONS: 'Review open action items', CHECKLIST: 'Checklist' };

export function MeetingTemplatesScreen() {
  const { api, me } = useAuthed();
  const list = useAsync(() => api.meetings.templates(true), [api]);
  const [editing, setEditing] = useState<{ id: string | null; t: MeetingTemplateInput } | null>(null);
  const set = (patch: Partial<MeetingTemplateInput>) => setEditing((e) => (e ? { ...e, t: { ...e.t, ...patch } } : e));
  const steps = editing?.t.steps ?? [];
  const setStep = (i: number, patch: Partial<MeetingStepDef>) => set({ steps: steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    set({ steps: next });
  };
  const save = useAction(async () => {
    if (!editing) return;
    if (editing.id) await api.meetings.updateTemplate(editing.id, editing.t);
    else await api.meetings.createTemplate(editing.t);
    setEditing(null);
    await list.reload();
  });
  const edit = (t: MeetingTemplateView) => setEditing({ id: t.id, t: { name: t.name, companyId: t.companyId, steps: t.steps, isDefault: t.isDefault, active: t.active } });
  if (!list.data && !list.error) return <PageLoading />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.meetings()} title="Meeting templates" subtitle="The steps a meeting goes through. The 70-30 starter is a placeholder until your format is set up — change it or make your own." />
      <ErrorBanner error={list.error} />
      {!editing && (
        <Card
          actions={
            <Button variant="secondary" onClick={() => setEditing({ id: null, t: { ...STARTER_7030_TEMPLATE, name: 'New template', isDefault: false } })}>
              + New template
            </Button>
          }
        >
          <ul className="divide-y divide-line">
            {(list.data ?? []).map((t) => (
              <li key={t.id} className={cx('flex flex-wrap items-center justify-between gap-2 py-2', !t.active && 'opacity-60')}>
                <div>
                  <p className="text-ink">
                    {t.name} {t.isDefault && <Badge tone="brand">Default</Badge>} {!t.active && <Badge>Not in use</Badge>}
                  </p>
                  <p className="text-sm text-muted">
                    {t.steps.length} steps · {t.companyId ? me.companies.find((c) => c.id === t.companyId)?.name : 'All companies'}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => edit(t)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && (
        <Card title={editing.id ? 'Edit template' : 'New template'}>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Name" value={editing.t.name} onChange={(e) => set({ name: e.target.value })} />
            <SelectField label="For" value={editing.t.companyId ?? ''} onChange={(e) => set({ companyId: e.target.value || null })} options={[{ value: '', label: 'All companies' }, ...me.companies.map((c) => ({ value: c.id, label: c.name }))]} />
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <Checkbox label="Use this one by default" checked={editing.t.isDefault} onChange={(v) => set({ isDefault: v })} />
            <Checkbox label="In use" checked={editing.t.active !== false} onChange={(v) => set({ active: v })} />
          </div>
          <p className="mt-4 font-semibold text-ink">Steps</p>
          <div className="mt-2 flex flex-col gap-3">
            {steps.map((s, i) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                  <TextField label={`Step ${i + 1}`} value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} />
                  <SelectField label="Kind" value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as MeetingStepDef['kind'] })} options={MEETING_STEP_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
                  <TextField label="Minutes" inputMode="numeric" value={s.minutes == null ? '' : String(s.minutes)} onChange={(e) => setStep(i, { minutes: e.target.value ? Math.max(0, Math.min(240, Number.parseInt(e.target.value, 10) || 0)) : null })} />
                </div>
                <TextArea label="What to cover" value={s.prompt} onChange={(e) => setStep(i, { prompt: e.target.value })} />
                {s.kind === 'CHECKLIST' && <TextArea label="Checklist items (one per line)" value={s.items.join('\n')} onChange={(e) => setStep(i, { items: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />}
                <div className="mt-2 flex gap-1">
                  <Button variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </Button>
                  <Button variant="ghost" aria-label="Move down" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </Button>
                  <Button variant="ghost" onClick={() => set({ steps: steps.filter((_, j) => j !== i) })}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button variant="secondary" className="mt-2" onClick={() => set({ steps: [...steps, { key: `s${Date.now().toString(36)}`, title: 'New step', prompt: '', minutes: null, kind: 'NOTES', items: [] }] })}>
            + Add a step
          </Button>
          <ErrorBanner error={save.error} />
          <div className="mt-3 flex gap-2">
            <Button busy={save.busy} onClick={() => void save.run()}>
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
