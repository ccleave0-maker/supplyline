import { z } from 'zod';
import { ROLES, type Role } from './common';

// ---------------------------------------------------------------------------
// Security (Admin › Security)
// ---------------------------------------------------------------------------
export const securitySettingsInput = z.object({
  /** Roles that must use an authenticator app to sign in */
  mfaRequiredRoles: z.array(z.enum(ROLES)).max(ROLES.length),
  /** Everyone must use one */
  mfaEveryone: z.boolean(),
  /** Email admins about security events (new admin, MFA turned off, many failed sign-ins, big exports) */
  alertAdmins: z.boolean(),
});
export type SecuritySettings = z.infer<typeof securitySettingsInput>;
export const DEFAULT_SECURITY: SecuritySettings = { mfaRequiredRoles: ['ADMIN', 'PROCUREMENT'], mfaEveryone: false, alertAdmins: true };

/** Is the authenticator app required for someone with these roles? */
export function mfaRequiredFor(s: SecuritySettings, roles: Role[], isPlatformOwner = false): boolean {
  return s.mfaEveryone || isPlatformOwner || roles.some((r) => s.mfaRequiredRoles.includes(r));
}

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  /** 'setup' = must turn it on before using the app; 'verify' = enter the code for this sign-in */
  pending: 'setup' | 'verify' | null;
}

export const mfaCodeInput = z.object({ code: z.string().trim().min(6, 'Enter the 6-digit code').max(20) });
export interface MfaSetup {
  secret: string;
  otpauthUri: string;
  /** QR code to scan with the app (PNG data URL) */
  qrDataUrl: string;
}

export interface SecurityEvent {
  id: string;
  at: string;
  action: string;
  label: string;
  who: string | null;
  severity: 'info' | 'warning' | 'alert';
}
