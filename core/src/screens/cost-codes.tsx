'use client';

import { useState } from 'react';
import { can } from '../permissions';
import { Button, Card, ErrorBanner, TextField } from '../ui/components';
import { fieldError, useAction, useAsync } from '../ui/hooks';
import { useAuthed } from '../ui/session';

/** Cost code list for a company (siteId omitted) or the extra codes for one job. */
export function CostCodesCard({ companyId, siteId }: { companyId: string; siteId?: string }) {
  const { api, me } = useAuthed();
  const editable = can(me.user, 'costcode:manage');
  const codes = useAsync(() => api.costCodes.list(companyId, siteId), [api, companyId, siteId]);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const add = useAction(async () => {
    await api.costCodes.create(companyId, { code, description: description || null, siteId: siteId ?? null });
    setCode('');
    setDescription('');
    await codes.reload();
  });
  const remove = useAction(async (id: string) => {
    await api.costCodes.remove(companyId, id);
    await codes.reload();
  });

  const list = (codes.data ?? []).filter((c) => (siteId ? true : c.siteId === null));

  return (
    <Card title={siteId ? 'Cost codes for this job' : 'Cost codes (all jobs)'}>
      <p className="mb-3 text-muted">
        {siteId
          ? 'Company-wide codes plus any extra codes just for this job.'
          : 'When this list has codes, order lines must use one of them. With no codes, any code can be typed.'}
      </p>
      <ErrorBanner error={codes.error ?? remove.error} />
      {list.length === 0 ? (
        <p className="text-muted">No cost codes yet.</p>
      ) : (
        <ul className="mb-3 divide-y divide-line">
          {list.map((c) => (
            <li key={c.id} className="flex min-h-12 flex-wrap items-center justify-between gap-2">
              <span className="text-ink">
                <strong>{c.code}</strong>
                {c.description && ` — ${c.description}`}
                {siteId && c.siteId === null && <span className="text-sm text-muted"> (company-wide)</span>}
              </span>
              {editable && (!siteId || c.siteId === siteId) && (
                <Button variant="ghost" aria-label={`Remove cost code ${c.code}`} onClick={() => void remove.run(c.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void add.run();
          }}
        >
          <div className="sm:w-40">
            <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} error={fieldError(add.error, 'code')} />
          </div>
          <div className="flex-1">
            <TextField label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button type="submit" disabled={!code.trim()} busy={add.busy}>
            Add code
          </Button>
        </form>
      )}
      {add.error && !fieldError(add.error, 'code') ? <ErrorBanner error={add.error} /> : null}
    </Card>
  );
}
