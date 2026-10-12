import { z } from 'zod';
import type { LineStatus, OrderStatus } from '../domain/status';
import { idSchema } from './common';

export const CUSTOM_COLUMN_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN'] as const;
export type CustomColumnType = (typeof CUSTOM_COLUMN_TYPES)[number];

export interface CustomColumn {
  id: string;
  name: string;
  dataType: CustomColumnType;
  sharedWithSite: boolean;
  sortOrder: number;
}

export const customColumnInput = z.object({
  name: z.string().trim().min(1, 'Name the column').max(40),
  dataType: z.enum(CUSTOM_COLUMN_TYPES).default('TEXT'),
  sharedWithSite: z.boolean().default(false),
});
export type CustomColumnInput = z.infer<typeof customColumnInput>;

export const customColumnUpdate = customColumnInput.partial().extend({ sortOrder: z.number().int().min(0).max(999).optional() });

/** A custom cell value: text, number, ISO date, true/false, or empty. */
export const customValueInput = z.object({
  value: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
});
export type CustomValue = string | number | boolean | null;

export interface ProcurementOrderSummary {
  orderId: string;
  label: string;
  siteName: string;
  companyId: string;
  companyName: string;
  status: OrderStatus;
  submittedAt: string | null;
  lineCount: number;
  /** Lines that still need buying (not covered by yard stock or POs) */
  toBuy: number;
  awaitingYardCheck: number;
  onOrder: number;
}

export interface ProcurementLine {
  id: string;
  lineNo: number;
  description: string;
  quantity: number;
  uom: string;
  costCode: string | null;
  orderedByInitials: string;
  requiredOnSite: string | null;
  status: LineStatus;
  rfqSent: boolean;
  yardChecked: boolean;
  yardStock: number;
  qtyToBuy: number;
  unitCost: number | null;
  extendedCost: number | null;
  pos: {
    poLineId: string;
    purchaseOrderId: string;
    poNumber: string;
    /** DRAFT / PENDING_APPROVAL / ISSUED / CLOSED */
    poStatus: string;
    vendorName: string;
    qty: number;
    unitCost: number | null;
    vendorEta: string | null;
    received: number;
  }[];
  custom: Record<string, CustomValue>;
}

export interface ProcurementOrder {
  orderId: string;
  label: string;
  siteName: string;
  companyId: string;
  companyName: string;
  status: OrderStatus;
  submittedAt: string | null;
  submittedByName: string | null;
  notes: string | null;
  lines: ProcurementLine[];
  columns: CustomColumn[];
  vendors: string[];
  yards: { id: string; name: string }[];
}

export const rfqInput = z.object({ lineIds: z.array(idSchema).min(1, 'Pick at least one line'), sent: z.boolean() });

export const assignPoInput = z.object({
  poNumber: z.string().trim().min(1, 'Enter the PO number').max(40),
  vendorName: z.string().trim().min(1, 'Enter the vendor').max(120),
  vendorEta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20')
    .nullable()
    .optional(),
  yardId: idSchema.nullable().optional(),
  lines: z
    .array(
      z.object({
        lineId: idSchema,
        qty: z.number().positive('Quantity must be more than 0').max(1e9),
        unitCost: z.number().min(0).max(1e9).nullable().optional(),
      }),
    )
    .min(1, 'Pick at least one line'),
});
export type AssignPoInput = z.infer<typeof assignPoInput>;

export const poLineUpdate = z.object({
  qty: z.number().positive().max(1e9).optional(),
  unitCost: z.number().min(0).max(1e9).nullable().optional(),
  vendorEta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type PoLineUpdate = z.infer<typeof poLineUpdate>;
