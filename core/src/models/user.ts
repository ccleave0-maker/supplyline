import { z } from 'zod';
import { ROLES, emailSchema, idSchema, type Role } from './common';

export const inviteInput = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, 'Name is required').max(120),
  companyId: idSchema.nullable(),
  roles: z.array(z.enum(ROLES)).min(1, 'Pick at least one role'),
  siteIds: z.array(idSchema).default([]),
});
export type InviteInput = z.infer<typeof inviteInput>;

export const userUpdateInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  initials: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,4}$/, 'Initials are 1–4 letters')
    .optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  companyId: idSchema.nullable().optional(),
  roles: z.array(z.enum(ROLES)).min(1).optional(),
  active: z.boolean().optional(),
  siteIds: z.array(idSchema).optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateInput>;

export const profileUpdateInput = userUpdateInput.pick({ name: true, initials: true, phone: true });
export type ProfileUpdateInput = z.infer<typeof profileUpdateInput>;

export interface UserListItem {
  id: string;
  email: string;
  name: string;
  initials: string;
  phone: string | null;
  roles: Role[];
  companyId: string | null;
  active: boolean;
  lastLoginAt: string | null;
  siteIds: string[];
  /** More business units (besides companyId) */
  extraCompanyIds: string[];
  procurementScope: 'ALL' | 'JOBS' | 'EQUIPMENT';
}

export interface InviteListItem {
  id: string;
  email: string;
  name: string | null;
  roles: Role[];
  companyId: string | null;
  siteIds: string[];
  expiresAt: string;
  createdAt: string;
  invitedByName: string | null;
}
