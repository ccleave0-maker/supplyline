'use client';

import { ORDER_STATUS_LABELS } from '../domain/status';
import { ROLE_LABELS } from '../models';
import { can } from '../permissions';
import { paths } from '../routes';
import { Badge, ButtonLink, Card, EmptyState, ErrorBanner, List, ListRow, PageLoading } from '../ui/components';
import { useAsync } from '../ui/hooks';
import { useAuthed, useLive } from '../ui/session';
import { ActivityCard, DashboardTiles } from './polish';
import { statusTone } from './order';

/** Buyers / approvers: what needs doing on POs. */
function PoTiles() {
  const { api, me } = useAuthed();
  const show = can(me.user, 'po:view') || can(me.user, 'email:review');
  const d = useAsync(() => (show ? api.purchaseOrders.dashboard() : Promise.resolve(null)), [api, show]);
  const x = d.data;
  if (!x || !(x.overdue || x.awaitingMyApproval || x.emailsToReview || x.dueThisWeek)) return null;
  const tile = (href: string, n: number, label: string, urgent = false) =>
    n > 0 && (
      <ButtonLink href={href} variant={urgent ? 'primary' : 'secondary'} className="min-h-16 flex-col">
        <span className="text-2xl font-black">{n}</span>
        <span className="text-sm">{label}</span>
      </ButtonLink>
    );
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tile(paths.pos(), x.awaitingMyApproval, 'PO(s) need your approval', true)}
      {tile(paths.pos(), x.overdue, 'PO(s) overdue', true)}
      {tile(paths.emails(), x.emailsToReview, 'email(s) to review')}
      {tile(paths.pos(), x.dueThisWeek, 'PO(s) due this week')}
    </div>
  );
}

/** Invoice approvals waiting on you, and AP to-dos. */
function ApTiles() {
  const { api } = useAuthed();
  const d = useAsync(() => api.ap.dashboard().catch(() => null), [api]);
  const x = d.data;
  if (!x || !(x.waitingOnMe || x.needsReview || x.approvedUnpaid || x.rejected)) return null;
  const tile = (href: string, n: number, label: string, urgent = false) =>
    n > 0 && (
      <ButtonLink href={href} variant={urgent ? 'primary' : 'secondary'} className="min-h-16 flex-col">
        <span className="text-2xl font-black">{n}</span>
        <span className="text-sm">{label}</span>
      </ButtonLink>
    );
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tile(`${paths.ap()}?show=mine`, x.waitingOnMe, 'invoice(s) need your approval', true)}
      {tile(`${paths.ap()}?show=inbox`, x.needsReview, 'invoice(s) to check')}
      {tile(`${paths.ap()}?show=approved`, x.approvedUnpaid, 'invoice(s) to pay')}
      {tile(`${paths.ap()}?show=rejected`, x.rejected, 'in the Rejection Area')}
    </div>
  );
}

export function HomeScreen() {
  const { api, me, activeCompany } = useAuthed();
  const sites = useAsync(() => api.sites.list({ companyId: activeCompany?.id }), [api, activeCompany?.id]);
  const orders = useAsync(() => api.orders.list({ companyId: activeCompany?.id }), [api, activeCompany?.id]);
  useLive(() => void orders.reload());
  const firstName = me.user.name.split(' ')[0];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">Hi {firstName}</h1>
        <p className="text-muted">
          {me.user.roles.map((r) => ROLE_LABELS[r]).join(' · ')}
          {activeCompany ? ` — ${activeCompany.name}` : ''}
        </p>
      </div>

      <DashboardTiles />
      <ApTiles />
      <PoTiles />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ButtonLink href={paths.scan()} className="min-h-16">
          📷 Scan
        </ButtonLink>
        {can(me.user, 'bol:receive') && (
          <ButtonLink href={paths.bolReceive()} className="min-h-16">
            📷 Receive a BOL
          </ButtonLink>
        )}
        {can(me.user, 'yard:work') && (
          <ButtonLink href={paths.yardReceive()} variant="secondary" className="min-h-16">
            Receive a delivery
          </ButtonLink>
        )}
        {can(me.user, 'bol:create') && (
          <ButtonLink href={paths.bolNew()} variant="secondary" className="min-h-16">
            + New BOL
          </ButtonLink>
        )}
        <ButtonLink href={paths.schedule()} variant="secondary" className="min-h-16">
          Schedule
        </ButtonLink>
      </div>

      <Card title="Your jobs & yards">
        <ErrorBanner error={sites.error} onRetry={sites.reload} />
        {sites.loading && !sites.data ? (
          <PageLoading />
        ) : sites.data && sites.data.length > 0 ? (
          <List>
            {sites.data.slice(0, 12).map((s) => (
              <ListRow
                key={s.id}
                href={paths.site(s.id)}
                title={s.type === 'JOB' ? `JOB#${s.jobNumber} · ${s.name}` : `${s.name} (Yard)`}
                subtitle={[s.city, s.province].filter(Boolean).join(', ') || undefined}
              />
            ))}
          </List>
        ) : (
          <EmptyState title="No jobs or yards yet">You'll see jobs here once you're added to one.</EmptyState>
        )}
      </Card>

      <ActivityCard />

      <Card title="Recent order lists" actions={<ButtonLink href={paths.orders()} variant="secondary">All orders</ButtonLink>}>
        <ErrorBanner error={orders.error} onRetry={orders.reload} />
        {orders.data && orders.data.length > 0 ? (
          <List>
            {orders.data.slice(0, 6).map((o) => (
              <ListRow
                key={o.id}
                href={paths.order(o.id)}
                title={`${o.label} · ${o.siteName}`}
                subtitle={`${o.lineCount} line${o.lineCount === 1 ? '' : 's'}`}
                right={<Badge tone={statusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</Badge>}
              />
            ))}
          </List>
        ) : (
          !orders.loading && <p className="text-muted">No order lists yet. Open a job and tap “Order lists” to start one.</p>
        )}
      </Card>
    </div>
  );
}
