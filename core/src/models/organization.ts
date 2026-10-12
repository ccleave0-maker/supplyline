import { z } from 'zod';
import { emailSchema } from './common';

export const orgCreateInput = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,40}$/, 'Use lower-case letters, numbers and dashes'),
  adminEmail: emailSchema,
  adminName: z.string().trim().min(1).max(120),
});
export type OrgCreateInput = z.infer<typeof orgCreateInput>;

export const orgUpdateInput = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  /** Platform owner only. Off by default. */
  aiFallbackEnabled: z.boolean().optional(),
  aiFallbackMonthlyCapCad: z.number().min(0).max(100000).nullable().optional(),
  /** Subscription (platform owner) */
  plan: z.enum(['TRIAL', 'STANDARD', 'PRO', 'CUSTOM', 'FREE']).optional(),
  seats: z.number().int().min(1).max(10000).optional(),
  trialEndsAt: z.string().regex(/^d{4}-d{2}-d{2}$/).nullable().optional(),
  billingNotes: z.string().trim().max(2000).nullable().optional(),
});
export type OrgUpdateInput = z.infer<typeof orgUpdateInput>;

export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  companyCount: number;
  userCount: number;
  aiFallbackEnabled: boolean;
  aiFallbackMonthlyCapCad: number | null;
  createdAt: string;
  plan: string;
  seats: number;
  trialEndsAt: string | null;
  billingStatus: string;
  billingNotes: string | null;
}
