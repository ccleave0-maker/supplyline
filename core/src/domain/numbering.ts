/** "JOB#2249 LIST#1". Drafts have no list number yet: "JOB#2249 DRAFT". */
export function formatListLabel(jobNumber: string, listNo: number | null | undefined): string {
  const job = `JOB#${jobNumber.trim()}`;
  return listNo == null ? `${job} DRAFT` : `${job} LIST#${listNo}`;
}

/** L1, L2 … */
export function formatLineNo(lineNo: number): string {
  if (!Number.isInteger(lineNo) || lineNo < 1) throw new Error(`Invalid line number: ${lineNo}`);
  return `L${lineNo}`;
}

export function parseLineNo(label: string): number | null {
  const m = /^\s*L?\s*(\d+)\s*$/i.exec(label);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

/** Parses "JOB#2249 LIST#1" (also tolerant of spacing / case / missing '#'). */
export function parseListLabel(label: string): { jobNumber: string; listNo: number } | null {
  const m = /^\s*JOB\s*#?\s*(\S+)\s+LIST\s*#?\s*(\d+)\s*$/i.exec(label);
  if (!m) return null;
  return { jobNumber: m[1]!, listNo: Number(m[2]) };
}

/** Counter keys used with the server's atomic sequence table. */
export const counterKeys = {
  jobList: (jobId: string) => `list:${jobId}`,
  companyOrder: (companyId: string) => `order:${companyId}`,
  companyBol: (companyId: string) => `bol:${companyId}`,
};
