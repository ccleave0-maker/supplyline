import type { AuthContext } from './auth';
import type { Db, Tx } from './db';

type Json = Record<string, unknown> | null | undefined;

/** Strip values that JSON can't hold (Decimal → string, Date → ISO). */
function toJson(value: Json): object | undefined {
  if (value == null) return undefined;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

/** Record who changed what, when. Call inside the same transaction as the change. */
export async function audit(
  tx: Tx | Db,
  auth: Pick<AuthContext, 'orgId' | 'userId' | 'clientApp' | 'clientVersion'> | null,
  action: string,
  entityType: string,
  entityId: string,
  before?: Json,
  after?: Json,
  orgId?: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId: orgId ?? auth?.orgId ?? null,
      userId: auth?.userId ?? null,
      action,
      entityType,
      entityId,
      before: toJson(before),
      after: toJson(after),
      clientApp: auth?.clientApp ? `${auth.clientApp} ${auth.clientVersion ?? ''}`.trim() : null,
    },
  });
}
