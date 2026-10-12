import { z } from 'zod';
import { CONTACT_TYPES, idSchema, optionalText, type ContactType } from './common';

export const contactInput = z.object({
  type: z.enum(CONTACT_TYPES),
  name: z.string().trim().min(1, 'Name is required').max(160),
  businessName: optionalText,
  phone: optionalText,
  cell: optionalText,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email')
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  notes: optionalText,
  companyId: idSchema.nullable().optional(),
  active: z.boolean().optional(),
  /** Send invoice rejections to this person (the vendor's accounts contact) */
  isApContact: z.boolean().optional(),
});
export type ContactInput = z.infer<typeof contactInput>;

export interface ContactItem {
  id: string;
  type: ContactType;
  name: string;
  businessName: string | null;
  phone: string | null;
  cell: string | null;
  email: string | null;
  notes: string | null;
  companyId: string | null;
  active: boolean;
  isApContact: boolean;
}
