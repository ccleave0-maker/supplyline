'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DEFAULT_PURCHASING, type EmailTemplateView, type OutboxItem, type PurchasingSettings } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, ButtonLink, Card, Checkbox, EmptyState, ErrorBanner, Notice, PageHeader, PageLoading, SelectField, TextArea, TextField } from '../ui/components';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

const splitEmails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Emails waiting for review (and failed / sent)
// ---------------------------------------------------------------------------
function OutboxCard({ item, onDone }: { item: OutboxItem; onDone: () => void }) {
  const { api } = useAuthed();
  const editable = item.status === 'REVIEW' || item.status === 'FAILED';
  const [to, setTo] = useState(item.to.join(', '));
  const [cc, setCc] = useState(item.cc.join(', '));
  const [subject, setSubject] = useState(item.subject);
  const [body, setBody] = useState(item.body);
  const send = useAction(async () => {
    await api.outbox.send(item.id, { to: splitEmails(to), cc: splitEmails(cc), subject, body });
    onDone();
  });
  const discard = useAction(async () => {
    await api.outbox.discard(item.id);
    onDone();
  });
  return (
    <Card
      title={item.templateLabel ?? 'Email'}
      actions={
        <>
          {item.companyName && <Badge>{item.companyName}</Badge>}
          <Badge tone={item.status === 'SENT' ? 'ok' : item.status === 'FAILED' ? 'danger' : 'brand'}>{item.status === 'REVIEW' ? 'Waiting review' : item.status === 'FAILED' ? 'Failed' : 'Sent'}</Badge>
        </>
      }
    >
      {item.error && <Notice>Last try failed: {item.error.split('\n')[0]}</Notice>}
      {editable ? (
        <div className="grid gap-2">
          <TextField label="To" value={to} onChange={(e) => setTo(e.target.value)} hint={!item.to.length ? 'No address on file — type the email address.' : 'Separate several with commas.'} error={fieldError(send.error, 'to')} />
          <TextField label="Cc" value={cc} onChange={(e) => setCc(e.target.value)} />
          <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextArea label="Message" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">To: {item.to.join(', ')}</p>
          <p className="font-semibold text-ink">{item.subject}</p>
          <p className="mt-1 whitespace-pre-wrap text-ink">{item.body}</p>
        </>
      )}
      {item.attachments.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
          {item.attachments.map((f) => (
            <a key={f.id} href={api.fileUrl(f.url)!} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink">
              📎 {f.fileName}
            </a>
          ))}
        </p>
      )}
      <p className="mt-1 text-sm text-muted">
        {new Date(item.createdAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}
        {item.relatedLink && (
          <>
            {' · '}
            <Link href={item.relatedLink} className="text-brand-ink underline">
              Open what it's about
            </Link>
          </>
        )}
      </p>
      <ErrorBanner error={send.error || discard.error} />
      {editable && (
        <div className="mt-3 flex gap-2">
          <Button busy={send.busy} onClick={() => void send.run()}>
            Send
          </Button>
          <Button variant="ghost" busy={discard.busy} onClick={() => void discard.run()}>
            Don't send
          </Button>
        </div>
      )}
    </Card>
  );
}

export function EmailsScreen() {
  const { api } = useAuthed();
  const [show, setShow] = useState<'review' | 'failed' | 'sent'>('review');
  const items = useAsync(() => api.outbox.list(show), [api, show]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Emails" subtitle="Emails set to “review first” wait here. Check them, change anything, then send." />
      <div className="flex flex-wrap gap-2" role="tablist">
        {(
          [
            ['review', 'Waiting for review'],
            ['failed', 'Failed'],
            ['sent', 'Sent'],
          ] as const
        ).map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={show === k} variant={show === k ? 'primary' : 'secondary'} onClick={() => setShow(k)}>
            {label}
          </Button>
        ))}
      </div>
      <ErrorBanner error={items.error} onRetry={items.reload} />
      {items.loading && !items.data ? (
        <PageLoading />
      ) : items.data?.length ? (
        items.data.map((i) => <OutboxCard key={i.id} item={i} onDone={items.reload} />)
      ) : (
        <EmptyState title={show === 'review' ? 'Nothing waiting — all caught up' : 'Nothing here'} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email wording per company
// ---------------------------------------------------------------------------
function TemplateCard({ companyId, t, onSaved, editable }: { companyId: string; t: EmailTemplateView; onSaved: (all: EmailTemplateView[]) => void; editable: boolean }) {
  const { api } = useAuthed();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(t.subject);
  const [body, setBody] = useState(t.body);
  const [mode, setMode] = useState(t.mode);
  const save = useAction(async () => {
    onSaved(await api.emailTemplates.save(companyId, t.key, { subject, body, mode }));
    setOpen(false);
  });
  const reset = useAction(async () => {
    const all = await api.emailTemplates.reset(companyId, t.key);
    const d = all.find((x) => x.key === t.key)!;
    setSubject(d.subject);
    setBody(d.body);
    setMode(d.mode);
    onSaved(all);
  });
  return (
    <Card
      title={t.label}
      actions={
        <>
          {t.customized && <Badge>Changed</Badge>}
          <Badge tone={t.mode === 'REVIEW' ? 'brand' : 'neutral'}>{t.mode === 'REVIEW' ? 'Review first' : 'Sends automatically'}</Badge>
        </>
      }
    >
      <p className="text-sm text-muted">To: {t.audience}</p>
      {!open ? (
        <>
          <p className="mt-2 font-semibold text-ink">{t.subject}</p>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-muted">{t.body}</p>
          {editable && (
            <Button variant="secondary" className="mt-2" onClick={() => setOpen(true)}>
              Edit
            </Button>
          )}
        </>
      ) : (
        <div className="mt-2 grid gap-2">
          <SelectField
            label="When it's created"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'AUTO' | 'REVIEW')}
            options={[
              { value: 'AUTO', label: 'Send automatically' },
              { value: 'REVIEW', label: 'Wait for someone to review it' },
            ]}
          />
          <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <TextArea label="Message" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="text-sm text-muted">You can use: {t.vars.map((v) => `{{${v}}}`).join('  ')}</p>
          <ErrorBanner error={save.error || reset.error} />
          <div className="flex flex-wrap gap-2">
            <Button busy={save.busy} onClick={() => void save.run()}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {t.customized && (
              <Button variant="ghost" busy={reset.busy} onClick={() => void reset.run()}>
                Back to the standard wording
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function EmailTemplatesScreen() {
  const params = useSearchParams();
  const { api, me } = useAuthed();
  const [companyId, setCompanyId] = useState(params.get('companyId') ?? me.companies[0]?.id ?? '');
  const list = useAsync(() => api.emailTemplates.list(companyId), [api, companyId]);
  const [templates, setTemplates] = useState<EmailTemplateView[] | null>(null);
  useEffect(() => setTemplates(list.data ?? null), [list.data]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader back={paths.companyEdit(companyId)} title="Email wording" subtitle="Change what each automatic email says, and whether it sends straight away or waits for review. Login codes always send straight away." />
      {me.companies.length > 1 && <SelectField label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} options={me.companies.map((c) => ({ value: c.id, label: c.name }))} />}
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {!templates ? <PageLoading /> : templates.map((t) => <TemplateCard key={`${companyId}-${t.key}-${t.customized}`} companyId={companyId} t={t} onSaved={setTemplates} editable={can(me.user, 'email:templates')} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Company page: purchasing settings
// ---------------------------------------------------------------------------
export function PurchasingSettingsCard({ companyId }: { companyId: string }) {
  const { api } = useAuthed();
  const loaded = useAsync(() => api.purchasing.get(companyId), [api, companyId]);
  const [f, setF] = useState<PurchasingSettings>(DEFAULT_PURCHASING);
  const [limit, setLimit] = useState('');
  const [copies, setCopies] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!loaded.data) return;
    setF(loaded.data);
    setLimit(loaded.data.approvalLimit == null ? '' : String(loaded.data.approvalLimit));
    setCopies(loaded.data.pricedCopyEmails.join(', '));
  }, [loaded.data]);
  const save = useAction(async () => {
    setSaved(false);
    const approvalLimit = limit.trim() ? Number(limit.replace(/[$,]/g, '')) : null;
    if (approvalLimit != null && !Number.isFinite(approvalLimit)) throw new Error('Enter the approval limit in dollars, or leave it empty.');
    await api.purchasing.save(companyId, { ...f, approvalLimit, pricedCopyEmails: splitEmails(copies) });
    setSaved(true);
  });
  const set = <K extends keyof PurchasingSettings>(k: K, v: PurchasingSettings[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Card title="Purchase orders" actions={<ButtonLink href={`${paths.emailTemplates()}?companyId=${encodeURIComponent(companyId)}`} variant="secondary">Email wording</ButtonLink>}>
      <ErrorBanner error={loaded.error || save.error} />
      {saved && <Notice>Saved.</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="PO number prefix" value={f.poPrefix} onChange={(e) => set('poPrefix', e.target.value)} hint="e.g. FCP- gives FCP-1001" />
        <TextField label="Start PO numbers at (next number)" hint="e.g. 5001 — numbering carries on from here" inputMode="numeric" value={String(f.poNextNumber)} onChange={(e) => set('poNextNumber', Number(e.target.value.replace(/\D/g, '')) || 1)} />
        <TextField label="Approval needed over ($, before tax)" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} hint="Empty = no approval needed. Admins or the job's PM approve." />
        <TextField
          label="Ask the vendor for shipping status (days before expected)"
          inputMode="numeric"
          value={String(f.followUpDaysBefore)}
          onChange={(e) => set('followUpDaysBefore', Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0))}
        />
        <div className="sm:col-span-2">
          <TextField label="Also send the priced PO copy to" value={copies} onChange={(e) => setCopies(e.target.value)} hint="Email addresses, separated by commas. The job's PM always gets it." />
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="Tick “Email the PO to the vendor” on new POs" checked={f.emailVendorDefault} onChange={(v) => set('emailVendorDefault', v)} />
        </div>
      </div>
      <Button className="mt-3" busy={save.busy} onClick={() => void save.run()}>
        Save PO settings
      </Button>
    </Card>
  );
}
