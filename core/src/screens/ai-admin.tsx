'use client';

import { useEffect, useState } from 'react';
import { AI_MODELS, AI_SCREENS, ROLE_LABELS, ROLES, type AiScreen, type AiSettingsView, type AiToggleRow, type Role } from '../models';
import { Badge, Button, Card, Checkbox, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextField } from '../ui/components';
import { ExportButtons } from '../ui/export';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';
import { forgetAiStatus } from '../ui/voice';

const cad = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 4 });

function SettingsCard({ s, onSaved }: { s: AiSettingsView; onSaved: (v: AiSettingsView) => void }) {
  const { api } = useAuthed();
  const [enabled, setEnabled] = useState(s.enabled);
  const [model, setModel] = useState(s.model);
  const [key, setKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [cap, setCap] = useState(s.monthlyCapCad == null ? '' : String(s.monthlyCapCad));
  const [rate, setRate] = useState(String(s.usdToCad));
  const [pin, setPin] = useState(String(s.priceInputUsdPerM));
  const [pout, setPout] = useState(String(s.priceOutputUsdPerM));
  const [stt, setStt] = useState<'none' | 'openai'>(s.sttProvider);
  const [sttKey, setSttKey] = useState('');
  const [msg, setMsg] = useState('');
  const num = (v: string, what: string) => {
    const x = Number(v.replace(/[$,]/g, ''));
    if (!Number.isFinite(x)) throw new Error(`Enter a number for ${what}.`);
    return x;
  };
  const save = useAction(async () => {
    setMsg('');
    const v = await api.ai.saveSettings({
      enabled,
      model,
      apiKey: removeKey ? '' : key.trim() || undefined,
      monthlyCapCad: cap.trim() ? num(cap, 'the monthly cap') : null,
      usdToCad: num(rate, 'the exchange rate'),
      priceInputUsdPerM: num(pin, 'the input price'),
      priceOutputUsdPerM: num(pout, 'the output price'),
      sttProvider: stt,
      sttKey: sttKey.trim() || undefined,
    });
    setKey('');
    setSttKey('');
    setRemoveKey(false);
    forgetAiStatus();
    onSaved(v);
    setMsg('Saved.');
  });
  const test = useAction(async () => {
    const r = await api.ai.test();
    setMsg(r.message);
  });
  return (
    <Card title="Claude (voice and document reading)" actions={<Badge tone={s.enabled && (s.hasKey || s.fallback.available) ? 'ok' : 'neutral'}>{s.enabled ? (s.hasKey || s.fallback.available ? 'On' : 'On — needs a key') : 'Off'}</Badge>}>
      <ErrorBanner error={save.error || test.error} />
      {msg && <Notice>{msg}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Checkbox label="Turn on voice AI and document reading" description="Everyone gets a 🎤 button on the screens switched on below. The AI only fills in — people always review and save." checked={enabled} onChange={setEnabled} />
        </div>
        <div className="sm:col-span-2 rounded-lg bg-surface-2 p-3">
          <p className="text-sm font-semibold text-ink">Claude API key</p>
          <p className="text-sm text-muted">
            {s.hasKey ? `Saved: ${s.keyHint} (stored encrypted on the server; never sent to phones or PCs)` : 'No key saved yet. Get one at console.anthropic.com › API keys.'}
            {!s.hasKey && s.fallback.available && ' Until then, the shared key your provider allowed is used.'}
          </p>
          <TextField label={s.hasKey ? 'Replace with a new key' : 'Paste your key'} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
          {s.hasKey && <Checkbox label="Remove the saved key" checked={removeKey} onChange={setRemoveKey} />}
        </div>
        <SelectField label="Model" value={model} onChange={(e) => setModel(e.target.value)} options={[...AI_MODELS.map((m) => ({ value: m.id, label: m.label })), ...(AI_MODELS.some((m) => m.id === model) ? [] : [{ value: model, label: model }])]} />
        <TextField label="Monthly spending cap (CAD)" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} hint="Admins are emailed at 80% and 100%. AI pauses at 100%. Empty = no cap." />
        <TextField label="Price: input, USD per million tokens" inputMode="decimal" value={pin} onChange={(e) => setPin(e.target.value)} hint="Check anthropic.com/pricing for your model." />
        <TextField label="Price: output, USD per million tokens" inputMode="decimal" value={pout} onChange={(e) => setPout(e.target.value)} />
        <TextField label="Exchange rate (CAD per USD)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        <div className="sm:col-span-2 rounded-lg bg-surface-2 p-3">
          <SelectField
            label="Speech-to-text for devices that can't do it themselves (e.g. the Windows app)"
            value={stt}
            onChange={(e) => setStt(e.target.value as 'none' | 'openai')}
            options={[
              { value: 'none', label: 'None — type, or use Windows key + H' },
              { value: 'openai', label: 'OpenAI Whisper (better with construction words)' },
            ]}
          />
          {stt === 'openai' && <TextField label={s.hasSttKey ? 'Replace the OpenAI key' : 'OpenAI API key'} type="password" autoComplete="off" value={sttKey} onChange={(e) => setSttKey(e.target.value)} placeholder="sk-…" />}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button busy={save.busy} onClick={() => void save.run()}>
          Save
        </Button>
        <Button variant="secondary" busy={test.busy} disabled={!s.hasKey && !s.fallback.available} onClick={() => void test.run()}>
          Test connection
        </Button>
        <span className="text-sm text-muted">
          This month ({s.spend.month}): {cad(s.spend.ownCad)}
          {s.spend.platformCad > 0 && ` + ${cad(s.spend.platformCad)} on the shared key`} · {s.spend.requests} request{s.spend.requests === 1 ? '' : 's'}
        </span>
      </div>
    </Card>
  );
}

function SwitchesCard() {
  const { api, me } = useAuthed();
  const loaded = useAsync(() => api.ai.toggles(), [api]);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [companyOff, setCompanyOff] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!loaded.data) return;
    setOff(new Set(loaded.data.filter((t) => !t.enabled && !t.companyId && t.role && t.screen).map((t) => `${t.role}|${t.screen}`)));
    setCompanyOff(new Set(loaded.data.filter((t) => !t.enabled && t.companyId && !t.role && !t.screen).map((t) => t.companyId!)));
  }, [loaded.data]);
  const save = useAction(async () => {
    const toggles: AiToggleRow[] = [
      ...[...off].map((k) => {
        const [role, screen] = k.split('|') as [Role, AiScreen];
        return { companyId: null, role, screen, enabled: false };
      }),
      ...[...companyOff].map((companyId) => ({ companyId, role: null, screen: null, enabled: false })),
    ];
    await api.ai.saveToggles({ toggles });
    forgetAiStatus();
    setSaved(true);
  });
  const flip = (k: string, on: boolean) =>
    setOff((x) => {
      const n = new Set(x);
      if (on) n.delete(k);
      else n.add(k);
      return n;
    });
  if (!loaded.data) return <PageLoading />;
  return (
    <Card title="Where voice is on">
      <ErrorBanner error={loaded.error || save.error} />
      {saved && <Notice>Saved.</Notice>}
      {me.companies.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-x-6">
          {me.companies.map((c) => (
            <Checkbox
              key={c.id}
              label={`On for ${c.name}`}
              checked={!companyOff.has(c.id)}
              onChange={(v) =>
                setCompanyOff((x) => {
                  const n = new Set(x);
                  if (v) n.delete(c.id);
                  else n.add(c.id);
                  return n;
                })
              }
            />
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="px-2 py-1">Screen</th>
              {ROLES.map((r) => (
                <th key={r} className="px-2 py-1 text-center">
                  {ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AI_SCREENS.map((sc) => (
              <tr key={sc.key} className="border-t border-line">
                <td className="px-2 py-1 text-ink">{sc.label}</td>
                {ROLES.map((r) => (
                  <td key={r} className="px-2 py-1 text-center">
                    <input type="checkbox" className="h-6 w-6 accent-[var(--brand)]" aria-label={`${sc.label} for ${ROLE_LABELS[r]}`} checked={!off.has(`${r}|${sc.key}`)} onChange={(e) => flip(`${r}|${sc.key}`, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button className="mt-3" busy={save.busy} onClick={() => void save.run()}>
        Save switches
      </Button>
    </Card>
  );
}

export function AiAdminScreen() {
  const { api } = useAuthed();
  const settings = useAsync(() => api.ai.settings(), [api]);
  const usage = useAsync(() => api.ai.usage(), [api]);
  const log = useAsync(() => api.ai.log(), [api]);
  const [s, setS] = useState<AiSettingsView | null>(null);
  useEffect(() => setS(settings.data ?? null), [settings.data]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="AI" subtitle="Voice entry, voice navigation, and reading quotes, packing slips and invoices. All AI calls go through the server." />
      <ErrorBanner error={settings.error} onRetry={settings.reload} />
      {!s ? <PageLoading /> : <SettingsCard s={s} onSaved={setS} />}
      <SwitchesCard />
      <Card title="Usage and cost (CAD)">
        <ErrorBanner error={usage.error} />
        {usage.data?.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted">
                  <tr>
                    <th className="px-2 py-1">Month</th>
                    <th className="px-2 py-1">Company</th>
                    <th className="px-2 py-1">Job / site</th>
                    <th className="px-2 py-1">Person</th>
                    <th className="px-2 py-1 text-right">Requests</th>
                    <th className="px-2 py-1 text-right">Tokens in / out</th>
                    <th className="px-2 py-1 text-right">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.map((u, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-2 py-1">{u.month}</td>
                      <td className="px-2 py-1">{u.companyName ?? '—'}</td>
                      <td className="px-2 py-1">{u.siteName ?? '—'}</td>
                      <td className="px-2 py-1">{u.userName}</td>
                      <td className="px-2 py-1 text-right">{u.requests}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{num(u.inputTokens)} / {num(u.outputTokens)}</td>
                      <td className="px-2 py-1 text-right">{cad(u.costCad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ExportButtons
              className="mt-3"
              title="AI usage"
              columns={[
                { key: 'month', label: 'Month' },
                { key: 'company', label: 'Company', width: 1.5 },
                { key: 'site', label: 'Job / site', width: 1.5 },
                { key: 'user', label: 'Person', width: 1.3 },
                { key: 'requests', label: 'Requests', align: 'right' },
                { key: 'tin', label: 'Tokens in', align: 'right' },
                { key: 'tout', label: 'Tokens out', align: 'right' },
                { key: 'cost', label: 'Cost (CAD)', align: 'right' },
              ]}
              rows={usage.data.map((u) => ({ month: u.month, company: u.companyName, site: u.siteName, user: u.userName, requests: u.requests, tin: u.inputTokens, tout: u.outputTokens, cost: u.costCad }))}
            />
          </>
        ) : (
          <p className="text-muted">No AI use yet.</p>
        )}
      </Card>
      <TokenHistoryCard />
      <Card title="Recent AI requests">
        {log.data?.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {log.data.slice(0, 60).map((l) => (
              <li key={l.id} className="py-2 text-sm">
                <span className="font-semibold text-ink">
                  {new Date(l.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })} · {l.userName} · {l.screen}
                </span>
                {l.usedPlatformKey && <Badge>shared key</Badge>}
                <span className="block text-muted">
                  {l.transcript && `“${l.transcript}” → `}
                  {l.summary ?? ''} · {num(l.inputTokens)} in / {num(l.outputTokens)} out tokens · {l.model} · {cad(l.costCad)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing yet.</p>
        )}
      </Card>
    </div>
  );
}

const num = (n: number) => n.toLocaleString('en-CA');

/** Token use kept as history: by day, model and screen, with the cost in CAD. */
function TokenHistoryCard() {
  const { api } = useAuthed();
  const [days, setDays] = useState(30);
  const h = useAsync(() => api.ai.history(days), [api, days]);
  const t = h.data?.totals;
  return (
    <Card title="Token usage history">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField label="Show" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[7, 30, 90, 365].map((d) => ({ value: String(d), label: `Last ${d} days` }))} />
        {t && (
          <p className="text-ink">
            <b>{num(t.requests)}</b> requests · <b>{num(t.inputTokens)}</b> tokens in · <b>{num(t.outputTokens)}</b> tokens out · <b>{cad(t.costCad)}</b> (about {cad(t.avgCostCad)} each)
          </p>
        )}
      </div>
      <ErrorBanner error={h.error} />
      {h.data && h.data.days.length > 0 ? (
        <>
          <div className="mt-3 max-h-80 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="px-2 py-1">Day</th>
                  <th className="px-2 py-1 text-right">Requests</th>
                  <th className="px-2 py-1 text-right">Tokens in</th>
                  <th className="px-2 py-1 text-right">Tokens out</th>
                  <th className="px-2 py-1 text-right">Cost (CAD)</th>
                </tr>
              </thead>
              <tbody>
                {h.data.days.map((d) => (
                  <tr key={d.day} className="border-t border-line">
                    <td className="px-2 py-1">{d.day}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {d.requests}
                      {d.failed ? <span className="text-danger"> ({d.failed} failed)</span> : null}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{num(d.inputTokens)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{num(d.outputTokens)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{cad(d.costCad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-semibold text-ink">By model</p>
              {h.data.byModel.map((m) => (
                <p key={m.model} className="text-sm text-muted">
                  {m.model}: {num(m.requests)} req · {num(m.inputTokens + m.outputTokens)} tokens · {cad(m.costCad)}
                </p>
              ))}
            </div>
            <div>
              <p className="font-semibold text-ink">By feature</p>
              {h.data.byScreen.slice(0, 8).map((m) => (
                <p key={m.screen} className="text-sm text-muted">
                  {m.screen}: {num(m.requests)} req · {cad(m.costCad)}
                </p>
              ))}
            </div>
          </div>
          <ExportButtons
            className="mt-3"
            title={`AI token usage ${h.data.from} to ${h.data.to}`}
            columns={[
              { key: 'day', label: 'Day' },
              { key: 'requests', label: 'Requests', align: 'right' },
              { key: 'failed', label: 'Failed', align: 'right' },
              { key: 'tin', label: 'Tokens in', align: 'right' },
              { key: 'tout', label: 'Tokens out', align: 'right' },
              { key: 'cost', label: 'Cost (CAD)', align: 'right' },
            ]}
            rows={h.data.days.map((d) => ({ day: d.day, requests: d.requests, failed: d.failed, tin: d.inputTokens, tout: d.outputTokens, cost: d.costCad }))}
          />
          <p className="mt-2 text-sm text-muted">Cost uses the prices per million tokens and the exchange rate set above — check them against Anthropic’s current pricing.</p>
        </>
      ) : (
        <p className="mt-2 text-muted">No AI use in this period.</p>
      )}
    </Card>
  );
}
