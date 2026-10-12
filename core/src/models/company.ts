import { z } from 'zod';
import { EMAIL_RECIPIENT_KINDS, emailSchema, hexColorSchema, type EmailRecipientKind, ROLES, type Role } from './common';
import type { CompanySummary } from './auth';

export const companyCreateInput = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, 'Code is 2–8 letters or numbers'),
  themeColor: hexColorSchema,
});
export type CompanyCreateInput = z.infer<typeof companyCreateInput>;

export const companyUpdateInput = companyCreateInput.partial().extend({
  /** Roles that see unit and extended prices on order lists (a job's project manager always does) */
  priceRoles: z.array(z.enum(ROLES)).optional(),
});
export type CompanyUpdateInput = z.infer<typeof companyUpdateInput>;

export const emailRecipientInput = z.object({
  kind: z.enum(EMAIL_RECIPIENT_KINDS),
  email: emailSchema,
  name: z.string().trim().max(120).optional().nullable(),
});
export type EmailRecipientInput = z.infer<typeof emailRecipientInput>;

export interface EmailRecipient {
  id: string;
  kind: EmailRecipientKind;
  email: string;
  name: string | null;
}

export interface CompanyDetail extends CompanySummary {
  emailRecipients: EmailRecipient[];
  priceRoles: Role[];
}

export const BRANDING_IMAGE_KINDS = ['logo', 'background'] as const;
export type BrandingImageKind = (typeof BRANDING_IMAGE_KINDS)[number];
