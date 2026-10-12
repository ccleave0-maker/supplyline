'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ORDER_STATUS_LABELS } from '../domain/status';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, Button, Card, EmptyState, ErrorBanner, List, ListRow, PageHeader, PageLoading, SelectField } from '../ui/components';
import { useAction, useAsync } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';
import { statusTone } from './order';
import { OrderListDropZone } from './documents';

export function OrdersScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { api, me, activeCompany } = useAuthed();
  const [siteId, setSiteId] = useState(params.get('siteId') ?? '');
  const [status, setStatus] = useState('');

  const jobs = useAsync(() => api.sites.list({ type: 'JOB', companyId: activeCompany?.id }), [api, activeCompany?.id]);
  const orders = useAsync(
    () => api.orders.list({ siteId: siteId || undefined, companyId: activeCompany?.id, status: status || undefined }),
    [api, siteId, status, activeCompany?.id],
  );
  useLive(() => void orders.reload());

  const canCreate = can(me.user, 'order:create');
  const create = useAction(async () => {
    const { id } = await api.orders.create(siteId);
    router.push(paths.order(id));
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Order lists" subtitle={activeCompany?.name} />

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Job"
          placeholder="All my jobs"
          value={siteId}
          onChange={(e) => {
            setSiteId(e.target.value);
            router.replace(paths.orders(e.target.value || undefined));
          }}
          options={(jobs.data ?? []).map((j) => ({ value: j.id, label: `JOB#${j.jobNumber} · ${j.name}` }))}
        />
        <SelectField
          label="Status"
          placeholder="Any status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
      </div>

      {canCreate && (
        <Card>
          <ErrorBanner error={create.error} />
          {siteId ? (
            <>
              <Button busy={create.busy} onClick={() => void create.run()} className="w-full sm:w-auto">
                + New order list for this job
              </Button>
              <OrderListDropZone siteId={siteId} />
            </>
          ) : (
            <p className="text-muted">Pick a job above to start a new order list.</p>
          )}
        </Card>
      )}

      <ErrorBanner error={orders.error} onRetry={orders.reload} />
      {orders.loading && !orders.data ? (
        <PageLoading />
      ) : orders.data?.length ? (
        <List>
          {orders.data.map((o) => (
            <ListRow
              key={o.id}
              href={paths.order(o.id)}
              title={`${o.label} · ${o.siteName}`}
              subtitle={`${o.lineCount} line${o.lineCount === 1 ? '' : 's'} · ${
                o.submittedAt ? `submitted ${new Date(o.submittedAt).toLocaleDateString('en-CA')} by ${o.submittedByName}` : `started by ${o.createdByName}`
              }`}
              right={<Badge tone={statusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge>}
            />
          ))}
        </List>
      ) : (
        <EmptyState title="No order lists yet">{canCreate ? 'Pick a job and start a new list.' : undefined}</EmptyState>
      )}
    </div>
  );
}
