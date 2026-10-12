import { z } from 'zod';
import { idSchema } from './common';
import type { BolStatus } from './shipping';

// ---------------------------------------------------------------------------
// Load schedule: every BOL (planned = draft, on the way = issued) placed on the
// days its stops are planned for.
// ---------------------------------------------------------------------------
export interface ScheduleStop {
  id: string;
  seq: number;
  kind: 'PICKUP' | 'DROP';
  locationName: string;
  siteId: string | null;
  plannedDate: string | null;
  plannedTime: string | null;
  completedAt: string | null;
}

export interface ScheduleLoad {
  id: string;
  /** "BOL #12" or "Planned load" */
  label: string;
  direction: 'OUTBOUND' | 'RETURN';
  status: BolStatus;
  companyId: string;
  companyName: string;
  themeColor: string;
  carrierName: string | null;
  driverName: string | null;
  truckUnit: string | null;
  /** "Step deck #12" */
  trailerName: string | null;
  /** Set when it's a specific numbered trailer (for double-booking checks) */
  trailerUnitId: string | null;
  notes: string | null;
  lineCount: number;
  stops: ScheduleStop[];
  /** First and last planned dates on the route (null = not scheduled yet) */
  firstDate: string | null;
  lastDate: string | null;
  /** e.g. "Driver Sam is also on BOL #14 on Oct 14" */
  conflicts: string[];
  /** You may drag it to another day */
  canMove: boolean;
}

export interface ScheduleFilter {
  from: string;
  to: string;
  siteId?: string;
  companyId?: string | null;
  carrierId?: string;
  /** Also return planned loads that have no dates yet */
  includeUndated?: boolean;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-20');

/** Move a load: shift every open stop by N days, or set stop dates one by one. */
export const rescheduleInput = z
  .object({
    shiftDays: z.number().int().min(-366).max(366).optional(),
    /** For a load with no dates yet: put the whole trip on this day */
    setDate: date.optional(),
    stops: z
      .array(
        z.object({
          stopId: idSchema,
          plannedDate: date.nullable(),
          plannedTime: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:30')
            .nullable()
            .optional(),
        }),
      )
      .max(20)
      .optional(),
    /** Email the job(s) about the new date when the load is already on its way */
    notify: z.boolean().default(true),
  })
  .refine((v) => v.shiftDays != null || v.setDate != null || (v.stops?.length ?? 0) > 0, 'Choose the new date.');
export type RescheduleInput = z.infer<typeof rescheduleInput>;

/** How one ordered line is moving: shown on the materials list and site inventory. */
export type ShipmentState = 'PLANNED' | 'ON_THE_WAY' | 'DELIVERED';
export const SHIPMENT_STATE_LABELS: Record<ShipmentState, string> = {
  PLANNED: 'Planned',
  ON_THE_WAY: 'On the way',
  DELIVERED: 'Delivered',
};
export interface LineShipment {
  state: ShipmentState;
  bolId: string;
  bolLabel: string;
  qty: number;
  /** Where this leg drops it (the job, or a laydown on the way) */
  toName: string;
  /** Planned delivery date (or the day it arrived) */
  date: string | null;
  time: string | null;
}
