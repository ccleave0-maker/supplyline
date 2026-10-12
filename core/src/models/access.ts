import { z } from 'zod';
import { ROLES } from './common';

// ---------------------------------------------------------------------------
// Organization access rules (Admin › Access & menu)
// ---------------------------------------------------------------------------
export const accessSettingsInput = z.object({
  /** Inside a business unit (company), lists and pickers show only that unit's data. Admins, the
   *  load builder and the schedule still see across units. */
  isolateUnits: z.boolean(),
  /** A purchase order can only be cut for the business unit you're working in. */
  poOwnUnitOnly: z.boolean(),
});
export type AccessSettings = z.infer<typeof accessSettingsInput>;
export const DEFAULT_ACCESS: AccessSettings = { isolateUnits: true, poOwnUnitOnly: true };

export const PROCUREMENT_SCOPES = [
  { key: 'ALL', label: 'Jobs and equipment' },
  { key: 'JOBS', label: 'Jobs / projects only' },
  { key: 'EQUIPMENT', label: 'Equipment only' },
] as const;
export type ProcurementScope = (typeof PROCUREMENT_SCOPES)[number]['key'];

export const userAccessInput = z.object({
  /** Business units besides their home company */
  extraCompanyIds: z.array(z.string().min(1).max(40)).max(50),
  procurementScope: z.enum(['ALL', 'JOBS', 'EQUIPMENT']),
});
export type UserAccessInput = z.infer<typeof userAccessInput>;

// ---------------------------------------------------------------------------
// Menu: admin-made groups, what each role may have, and each person's own order
// ---------------------------------------------------------------------------
export const navGroupInput = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().min(1, 'Name the area').max(40),
  /** The area button's symbol (an emoji), e.g. 🏗 */
  icon: z.string().trim().max(8).optional(),
  /** Menu items in this area, by their address (e.g. "/orders/") */
  items: z.array(z.string().max(120)).max(80),
});
export const navSettingsInput = z.object({
  groups: z.array(navGroupInput).max(20),
  /** Items each role may NOT have (on top of what their permissions allow) */
  hiddenByRole: z.partialRecord(z.enum(ROLES), z.array(z.string().max(120)).max(80)).default({}),
  /** People may drag their own menu around (within what they're allowed) */
  allowPersonal: z.boolean().default(true),
});
export type NavSettings = z.infer<typeof navSettingsInput>;
export const DEFAULT_NAV: NavSettings = { groups: [], hiddenByRole: {}, allowPersonal: true };

/** A person's own layout: groups with item order; items they hid. */
export const navLayoutInput = z.object({
  groups: z.array(navGroupInput).max(20),
  hidden: z.array(z.string().max(120)).max(80).default([]),
});
export type NavLayout = z.infer<typeof navLayoutInput>;
