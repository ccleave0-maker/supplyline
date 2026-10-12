import { z } from 'zod';
import {
  EMAIL_RECIPIENT_KINDS,
  SITE_TYPES,
  emailSchema,
  idSchema,
  optionalText,
  type ContactType,
  type EmailRecipientKind,
  type Role,
  type SiteType,
} from './common';

export const siteInput = z
  .object({
    type: z.enum(SITE_TYPES),
    companyId: idSchema.nullable().optional(),
    jobNumber: z.string().trim().min(1, 'Job number is required').max(40),
    name: z.string().trim().min(1, 'Name is required').max(160),
    active: z.boolean().optional(),
    address: optionalText,
    city: optionalText,
    province: optionalText,
    postalCode: optionalText,
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    notes: optionalText,
    /** Jobs / projects only */
    clientName: optionalText,
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
      .nullable()
      .optional()
      .or(z.literal('').transform(() => null)),
    projectManagerId: idSchema.nullable().optional(),
    pstExempt: z.boolean().optional(),
    pstExemptNumber: optionalText,
    /** Yards only: which companies this yard serves */
    yardCompanyIds: z.array(idSchema).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'JOB' && !v.companyId) {
      ctx.addIssue({ code: 'custom', path: ['companyId'], message: 'Pick the company this job belongs to' });
    }
    if (v.type === 'YARD' && (!v.yardCompanyIds || v.yardCompanyIds.length === 0)) {
      ctx.addIssue({ code: 'custom', path: ['yardCompanyIds'], message: 'Pick at least one company this yard serves' });
    }
  });
export type SiteInput = z.infer<typeof siteInput>;

export const siteUpdateInput = z.object({
  jobNumber: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  active: z.boolean().optional(),
  address: optionalText,
  city: optionalText,
  province: optionalText,
  postalCode: optionalText,
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  notes: optionalText,
  /** Jobs / projects only */
  clientName: optionalText,
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  projectManagerId: idSchema.nullable().optional(),
  pstExempt: z.boolean().optional(),
  pstExemptNumber: optionalText,
  yardCompanyIds: z.array(idSchema).optional(),
});
export type SiteUpdateInput = z.infer<typeof siteUpdateInput>;

export const siteMembersInput = z.object({ userIds: z.array(idSchema) });

export const siteEmailRouteInput = z.object({
  kind: z.enum(EMAIL_RECIPIENT_KINDS),
  email: emailSchema,
  name: z.string().trim().max(120).optional().nullable(),
});
export type SiteEmailRouteInput = z.infer<typeof siteEmailRouteInput>;

export const siteContactsInput = z.object({
  contacts: z.array(z.object({ contactId: idSchema, roleOnSite: z.string().trim().max(80).nullable().optional() })),
});

export interface SiteListItem {
  id: string;
  type: SiteType;
  companyId: string | null;
  companyName: string | null;
  jobNumber: string;
  name: string;
  active: boolean;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  yardCompanyIds: string[];
}

export interface SiteDetail extends SiteListItem {
  address: string | null;
  postalCode: string | null;
  notes: string | null;
  clientName: string | null;
  startDate: string | null;
  projectManager: { id: string; name: string; email: string; phone: string | null } | null;
  pstExempt: boolean;
  pstExemptNumber: string | null;
  pstExemptionFile: { id: string; url: string; fileName: string } | null;
  /** "GST 5% · PST 7% (BC)" */
  taxLabel: string;
  /** Counts for the project area buttons */
  counts: { rentalsOnRent: number; qcDocs: number; subcontractDocs: number };
  canSeeSubcontracts: boolean;
  members: { userId: string; name: string; email: string; initials: string; roles: Role[] }[];
  emailRoutes: { id: string; kind: EmailRecipientKind; email: string; name: string | null }[];
  contacts: {
    contactId: string;
    name: string;
    businessName: string | null;
    type: ContactType;
    phone: string | null;
    cell: string | null;
    email: string | null;
    roleOnSite: string | null;
  }[];
  canEdit: boolean;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
}
