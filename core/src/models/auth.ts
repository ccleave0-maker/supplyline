import { z } from 'zod';
import { CLIENT_APPS, emailSchema, type Role, type SiteType } from './common';

export const requestCodeInput = z.object({ email: emailSchema });
export type RequestCodeInput = z.infer<typeof requestCodeInput>;

export const verifyCodeInput = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type VerifyCodeInput = z.infer<typeof verifyCodeInput>;

export const googleSignInInput = z.object({ idToken: z.string().min(10) });
export type GoogleSignInInput = z.infer<typeof googleSignInInput>;

export const clientAppSchema = z.enum(CLIENT_APPS);

export interface RequestCodeResult {
  ok: true;
  /** Only present in local development when DEV_SHOW_LOGIN_CODE is on. */
  devCode?: string;
}

export interface CompanySummary {
  id: string;
  code: string;
  name: string;
  themeColor: string;
  logoUrl: string | null;
  loginBackgroundUrl: string | null;
  /** In-app background picture, fade and logo decal */
  appearance?: { backgroundUrl: string | null; fade: number; decal: boolean };
}

export interface SiteSummary {
  id: string;
  type: SiteType;
  companyId: string | null;
  jobNumber: string;
  name: string;
  active: boolean;
}

export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    initials: string;
    phone: string | null;
    roles: Role[];
    isPlatformOwner: boolean;
    companyId: string | null;
    /** Procurement: may buy for ALL, JOBS or EQUIPMENT */
    procurementScope?: 'ALL' | 'JOBS' | 'EQUIPMENT';
  };
  organization: { id: string; name: string; slug: string };
  /** Companies this user may work in (all companies in the org for admins). */
  companies: CompanySummary[];
  features: { googleSignIn: boolean; webPushKey: string | null };
  /** Admins: "Your trial ends in 5 days" etc. (null when nothing to say) */
  billingNotice: string | null;
  /** The menu: the admin's areas and rules, and this person's own layout */
  nav?: { settings: import('./access').NavSettings; mine: import('./access').NavLayout | null };
  /** Business-unit isolation is on (lists show only the unit being worked in) */
  isolateUnits?: boolean;
  /** Authenticator app (two-step sign-in) */
  mfa?: import('./security').MfaStatus;
}

export interface AuthResult {
  token: string;
  expiresAt: string;
  me: Me;
}

export interface PublicBranding {
  company: CompanySummary | null;
  googleClientId: string | null;
}

export interface ApiMeta {
  apiVersion: 'v1';
  serverVersion: string;
  /** Minimum app version each client must run; older apps are asked to update. */
  minClientVersion: Record<(typeof CLIENT_APPS)[number], string>;
}
