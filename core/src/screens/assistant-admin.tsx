'use client';

import { useState } from 'react';
import { ASSISTANT_ACTIONS, DEFAULT_ASSISTANT, NICKNAME_KINDS, type AssistantSettings, type NicknameInput } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Button, ButtonLink, Card, Checkbox, EmptyState, ErrorBanner, Notice, PageHeader, SelectField, TextArea, TextField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

/** Nicknames: yours, plus the ones everyone uses. */
export function NicknamesCard() {
  const { api, me } = useAuthed();
  const list = useAsync(() => api.nicknames.list(), [api]);
  const blank: NicknameInput = { phrase: '', kind: 'SITE', targetId: null, targetLabel: '', shared: false };
  const [n, setN] = useState<NicknameInput>(blank);
  const save = useAction(async () => {
    await api.nicknames.save(n);
    setN(blank);
    await list.reload();
  });
  const remove = useAction(async (id: string) => {
    await api.nicknames.remove(id);
    await list.reload();
  });
  return (
    <Card title="Nicknames">
      <p className="text-sm text-muted">What people call things, so the assistant and voice understand “the bridge job” or “the north yard”. The assistant also offers to remember new ones.</p>
      <ErrorBanner error={list.error || remove.error} />
      {list.data && list.data.length === 0 && <EmptyState title="No nicknames yet">Add one below.</EmptyState>}
      <ul className="flex flex-col divide-y divide-line">
        {(list.data ?? []).map((x) => (
          <li key={x.id} className="flex items-center justify-between gap-2 py-2">
            <span className="text-ink">
              “{x.phrase}” → {x.targetLabel} <span className="text-sm text-muted">({NICKNAME_KINDS.find((k) => k.key === x.kind)?.label}{x.shared ? ', everyone' : ', just you'})</span>
            </span>
            {x.canEdit && (
              <Button variant="ghost" busy={remove.busy} onClick={() => void remove.run(x.id)}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <TextField label="Nickname" placeholder="the bridge job" value={n.phrase} onChange={(e) => setN({ ...n, phrase: e.target.value })} />
        <SelectField label="It’s a" value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value as NicknameInput['kind'] })} options={NICKNAME_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
        <TextField label="It means" placeholder="JOB#2249 Bridge replacement" value={n.targetLabel} onChange={(e) => setN({ ...n, targetLabel: e.target.value })} />
      </div>
      {can(me.user, 'org:manage') && <Checkbox label="For everyone in the organization" checked={n.shared} onChange={(shared) => setN({ ...n, shared })} />}
      <ErrorBanner error={save.error} />
      <Button className="mt-2" variant="secondary" busy={save.busy} disabled={n.phrase.trim().length < 2 || !n.targetLabel.trim()} onClick={() => void save.run()}>
        Add nickname
      </Button>
    </Card>
  );
}

/** Admin › Assistant: the guardrails. */
export function AssistantAdminScreen() {
  const { api } = useAuthed();
  const cur = useAsync(() => api.assistant.settings(), [api]);
  const [s, setS] = useState<AssistantSettings | null>(null);
  const v = s ?? cur.data ?? DEFAULT_ASSISTANT;
  const [msg, setMsg] = useState('');
  const save = useAction(async () => {
    setS(await api.assistant.saveSettings(v));
    setMsg('Saved.');
  });
  const set = (patch: Partial<AssistantSettings>) => {
    setMsg('');
    setS({ ...v, ...patch });
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Assistant" subtitle="Ask-in-plain-words help for everyone. It sees only what each person can see, and only changes something after they say yes." />
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={paths.aiAdmin()} variant="secondary">
          Claude key, spending cap & where AI is on
        </ButtonLink>
        <ButtonLink href={paths.insights()} variant="secondary">
          Insights
        </ButtonLink>
      </div>
      {msg && <Notice>{msg}</Notice>}
      <Card title="Guardrails">
        <Checkbox label="Assistant on" description="Also needs AI turned on (Admin › AI & voice)." checked={v.enabled} onChange={(enabled) => set({ enabled })} />
        <SelectField
          label="When someone asks it to make something"
          hint="Sending, issuing a PO, posting loads and changing urgency always ask first."
          value={v.autoDo}
          onChange={(e) => set({ autoDo: e.target.value as AssistantSettings['autoDo'] })}
          options={[
            { value: 'drafts', label: 'Make drafts straight away (POs, order lines, contacts…) — they review them' },
            { value: 'never', label: 'Always ask “Yes / No” first' },
          ]}
        />
        <p className="mt-3 font-semibold text-ink">What it may do</p>
        {ASSISTANT_ACTIONS.map((a) => (
          <Checkbox key={a.key} label={a.label} description={a.help} checked={v.allowedActions.includes(a.key)} onChange={(on) => set({ allowedActions: on ? [...v.allowedActions, a.key] : v.allowedActions.filter((k) => k !== a.key) })} />
        ))}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <TextField label="Messages per person per day" type="number" min={1} max={1000} value={String(v.dailyLimitPerUser)} onChange={(e) => set({ dailyLimitPerUser: Math.max(1, Number(e.target.value) || 1) })} />
          <TextField label="Keep chats for (days)" type="number" min={1} max={3650} value={String(v.keepDays)} onChange={(e) => set({ keepDays: Math.max(1, Number(e.target.value) || 1) })} />
          <SelectField label="Nicknames for everyone can be saved by" value={v.sharedNicknamesBy} onChange={(e) => set({ sharedNicknamesBy: e.target.value as 'ADMIN' })} options={[{ value: 'ADMIN', label: 'Admins only' }, { value: 'ANYONE', label: 'Anyone' }]} />
        </div>
        <TextArea label="Notes for the assistant" hint="e.g. “Yard 2 is called the north yard. Rebar is always ordered in 12 m lengths.”" value={v.instructions} onChange={(e) => set({ instructions: e.target.value })} />
        <TextArea label="Topics it must not touch (one per line)" hint="Questions mentioning these are refused without being sent to the AI." value={v.blockedTopics} onChange={(e) => set({ blockedTopics: e.target.value })} />
        <ErrorBanner error={cur.error || save.error} />
        <Button className="mt-3" busy={save.busy} disabled={!s} onClick={() => void save.run()}>
          Save
        </Button>
      </Card>
      <NicknamesCard />
    </div>
  );
}

/** Admin › Insights: patterns from this organization's own data. */
export function InsightsScreen() {
  const { api } = useAuthed();
  const [days, setDays] = useState(90);
  const data = useAsync(() => api.insights(days), [api, days]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Insights" subtitle="Patterns worth a look, from your own data only. Only admins see this page." />
      <SelectField label="Looking back" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[30, 90, 180, 365].map((d) => ({ value: String(d), label: `${d} days` }))} />
      <ErrorBanner error={data.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(data.data?.cards ?? []).map((c) => (
          <Card key={c.key} title={c.title}>
            <p className="text-sm text-muted">{c.detail}</p>
            {c.rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col divide-y divide-line">
                {c.rows.map((r, i) => (
                  <li key={i} className="flex justify-between gap-2 py-1 text-sm">
                    {r.href ? (
                      <a href={r.href} className="text-brand-ink underline">
                        {r.label}
                      </a>
                    ) : (
                      <span className="text-ink">{r.label}</span>
                    )}
                    <span className="shrink-0 tabular-nums text-muted">{r.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
      <Notice>Learning across other companies that use Bowron is off, and stays off until the privacy policy and terms cover it. Nothing here uses anyone else’s data.</Notice>
    </div>
  );
}
