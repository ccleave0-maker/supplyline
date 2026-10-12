import { z } from 'zod';
import { idSchema } from './common';

/** Any list on screen → Excel or PDF (built on the server, plain white Excel). */
export const tableExportInput = z.object({
  format: z.enum(['xlsx', 'pdf']),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).nullable().optional(),
  /** Company whose logo / name goes on the PDF */
  companyId: idSchema.nullable().optional(),
  columns: z
    .array(
      z.object({
        key: z.string().min(1).max(60),
        label: z.string().max(80),
        align: z.enum(['left', 'right']).optional(),
        /** Relative width on the PDF (default 1) */
        width: z.number().min(0.2).max(10).optional(),
      }),
    )
    .min(1)
    .max(40),
  rows: z.array(z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()]))).max(20000),
});
export type TableExportInput = z.infer<typeof tableExportInput>;
export type ExportColumn = TableExportInput['columns'][number];

/** What a scanned SupplyLine QR (or printed number) points at, and where to go. */
export interface ScanTarget {
  kind: 'BOL' | 'PO' | 'ORDER' | 'EQUIPMENT' | 'RECEIPT' | 'MEETING';
  id: string;
  label: string;
  /** Screen to open, e.g. "/bols/receive/?id=…" */
  link: string;
}
export interface UniversalScanResult {
  target: ScanTarget | null;
  method: 'qr' | 'text' | null;
  textSample: string;
}
