// Any on-screen list as an Excel workbook (plain white) or a printable PDF.

import ExcelJS from 'exceljs';
import type { TableExportInput } from '@supplyline/core/models';
import type { AuthContext } from '../lib/auth';
import { renderTablePdf } from '../pdf/table-pdf';
import { assertCompanyAccessible } from './access';
import { logoForPdf } from './files';

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, ' ').replace(/\s+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'export';

export async function exportTable(auth: AuthContext, input: TableExportInput): Promise<{ bytes: Uint8Array; fileName: string; contentType: string }> {
  const company = input.companyId ? await assertCompanyAccessible(auth, input.companyId) : null;
  const stamp = new Date().toISOString().slice(0, 10);
  if (input.format === 'pdf') {
    const bytes = await renderTablePdf({
      title: input.title,
      subtitle: input.subtitle ?? null,
      companyName: company?.name ?? null,
      companyCode: company?.code ?? null,
      themeColor: company?.themeColor ?? '#334155',
      logo: company ? await logoForPdf(company.logoFileId) : null,
      columns: input.columns,
      rows: input.rows,
    });
    return { bytes: new Uint8Array(bytes), fileName: `${safeName(input.title)}-${stamp}.pdf`, contentType: 'application/pdf' };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bowron';
  const ws = wb.addWorksheet(input.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  let r = 1;
  ws.getCell(r, 1).value = input.title;
  ws.getCell(r, 1).font = { bold: true, size: 14 };
  r++;
  if (input.subtitle || company) {
    ws.getCell(r, 1).value = [company?.name, input.subtitle].filter(Boolean).join(' · ');
    r++;
  }
  r++;
  const header = ws.getRow(r);
  input.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { horizontal: c.align === 'right' ? 'right' : 'left' };
  });
  ws.views = [{ state: 'frozen', ySplit: r }];
  for (const row of input.rows) {
    r++;
    const line = ws.getRow(r);
    input.columns.forEach((c, i) => {
      const v = row[c.key];
      const cell = line.getCell(i + 1);
      cell.value = v ?? null;
      if (c.align === 'right') cell.alignment = { horizontal: 'right' };
    });
  }
  input.columns.forEach((c, i) => {
    const longest = Math.max(c.label.length, ...input.rows.slice(0, 500).map((row) => String(row[c.key] ?? '').length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(8, longest + 2));
  });
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  return { bytes, fileName: `${safeName(input.title)}-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
}
