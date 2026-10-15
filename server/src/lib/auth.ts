import { accessSettingsInput, DEFAULT_ACCESS, DEFAULT_SECURITY, mfaRequiredFor, securitySettingsInput, type AccessSettings, type MfaStatus, type ProcurementScope, type Role, type SecuritySettings } from '@supplyline/core/models';
import { can, type Action } from '@supplyline/core/permissions';
import { db } from './db';
import { hashSecret } from './crypto';
import { forbidden, unauthorized } from './errors';

export const SESSION_DAYS = 30;

export interface AuthContext {
  sessionId: string;
  userId: string;
  orgId: string;
  companyId: string | null;
  email: string;
  name: string;
  roles: Role[];
  isPlatformOwner: boolean;
  clientApp: string | null;
  clientVersion: string | null;
  /** More business units besides companyId (set by an admin) */
  extraCompanyIds?: string[];
  /** The business unit the person is working in right now (sent by the app) */
  activeCompanyId?: string | null;
  /** Procurement: may buy for jobs, equipment, or both */
  procurementScope?: ProcurementScope;
  /** The organization's access rules */
  access?: AccessSettings;
  /** Signed in, but the authenticator-app step isn't done yet ('setup' or 'verify') */
  mfaPending?: MfaStatus['pending'];
}

export function securityOf(settings: unknown): SecuritySettings {
  const parsed = securitySettingsInput.partial().safeParse((settings as { security?: unknown } | null)?.security ?? {});
  return { ...DEFAULT_SECURITY, ...(parsed.success ? parsed.data : {}) };
}

/** Where this person stands with the authenticator app on this session. */
export function mfaStatusOf(user: { roles: string[]; isPlatformOwner: boolean; mfaEnabledAt: Date | null }, session: { mfaVerifiedAt: Date | null } | null, orgSettings: unknown): MfaStatus {
  const required = mfaRequiredFor(securityOf(orgSettings), user.roles as Role[], user.isPlatformOwner);
  const enabled = !!user.mfaEnabledAt;
  const pending = !session ? null : enabled ? (session.mfaVerifiedAt ? null : 'verify') : required ? 'setup' : null;
  return { enabled, required, pending };
}

export function accessOf(settings: unknown): AccessSettings {
  const parsed = accessSettingsInput.partial().safeParse((settings as { access?: unknown } | null)?.access ?? {});
  return { ...DEFAULT_ACCESS, ...(parsed.success ? parsed.data : {}) };
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}

export async function authenticate(req: Request): Promise<AuthContext> {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  const session = await db.session.findUnique({
    where: { tokenHash: hashSecret(token) },
    include: { user: { include: { organization: { select: { status: true, settings: true } } } } },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt < now) throw unauthorized();
  const { user } = session;
  if (!user.active || user.deletedAt) throw unauthorized('Your access has been removed. Contact your administrator.');
  if (user.organization.status !== 'ACTIVE' && !user.isPlatformOwner) {
    throw unauthorized('Your organization is suspended. Contact Bowron support.');
  }

  // Sliding expiry, written at most every 5 minutes.
  if (now.getTime() - session.lastUsedAt.getTime() > 5 * 60_000) {
    await db.session.update({
      where: { id: session.id },
      data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000) },
    });
  }

  return {
    sessionId: session.id,
    userId: user.id,
    orgId: user.organizationId,
    companyId: user.companyId,
    email: user.email,
    name: user.name,
    roles: user.roles as Role[],
    isPlatformOwner: user.isPlatformOwner,
    clientApp: req.headers.get('x-client-app'),
    clientVersion: req.headers.get('x-client-version'),
    extraCompanyIds: user.extraCompanyIds,
    activeCompanyId: req.headers.get('x-company')?.slice(0, 40) || null,
    procurementScope: (user.procurementScope as ProcurementScope) ?? 'ALL',
    access: accessOf(user.organization.settings),
    mfaPending: mfaStatusOf(user, session, user.organization.settings).pending,
  };
}

export function requirePermission(auth: AuthContext, action: Action): void {
  if (!can(auth, action)) throw forbidden();
}

export const isAdmin = (auth: AuthContext) => auth.roles.includes('ADMIN');
