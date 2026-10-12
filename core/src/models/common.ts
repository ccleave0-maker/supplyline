import { z } from 'zod';

export const ROLES = ['SITE', 'YARD', 'PROCUREMENT', 'AP', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SITE: 'Site',
  YARD: 'Yard',
  PROCUREMENT: 'Procurement',
  AP: 'Accounts payable',
  ADMIN: 'Admin',
};

export const SITE_TYPES = ['JOB', 'YARD'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export const EMAIL_RECIPIENT_KINDS = ['PROCUREMENT', 'YARD', 'CC'] as const;
export type EmailRecipientKind = (typeof EMAIL_RECIPIENT_KINDS)[number];

export const EMAIL_RECIPIENT_LABELS: Record<EmailRecipientKind, string> = {
  PROCUREMENT: 'Procurement',
  YARD: 'Yard',
  CC: 'CC',
};

export const CONTACT_TYPES = ['TRUCKING', 'VENDOR', 'SUBCONTRACTOR', 'RENTAL', 'BUSINESS', 'ANCILLARY', 'PERSON'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  TRUCKING: 'Trucking',
  VENDOR: 'Vendor',
  SUBCONTRACTOR: 'Subcontractor',
  RENTAL: 'Rental company',
  BUSINESS: 'Business',
  ANCILLARY: 'Ancillary',
  PERSON: 'Person',
};

export const CLIENT_APPS = ['web', 'pc', 'ios', 'android'] as const;
export type ClientApp = (typeof CLIENT_APPS)[number];

// Shared field schemas
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address' }));

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #E8701A');

export const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const idSchema = z.string().min(1).max(64);
