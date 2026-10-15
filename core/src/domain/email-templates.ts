// Editable email wording. Each company can change the subject/body of any of
// these and choose whether it sends straight away or waits for someone to
// review it. Login codes and invites are not here: they always send at once.

export type EmailMode = 'AUTO' | 'REVIEW';

export interface EmailTemplateDef {
  key: string;
  label: string;
  /** Who it goes to, in plain words */
  audience: string;
  mode: EmailMode;
  subject: string;
  body: string;
  /** Placeholders the wording can use, e.g. {{poNumber}} */
  vars: string[];
}

const PO_VARS = ['poNumber', 'companyName', 'vendorName', 'vendorContact', 'target', 'orderedDate', 'expectedDate', 'deliverTo', 'pstNote', 'total', 'senderName', 'link'];

export const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  {
    key: 'PO_TO_VENDOR',
    label: 'Purchase order to the vendor',
    audience: 'Vendor',
    mode: 'REVIEW',
    subject: 'Purchase order {{poNumber}} – {{companyName}}',
    body:
      'Hello {{vendorContact}},\n\nPlease find attached purchase order {{poNumber}} for {{target}}.\n\nRequired by: {{expectedDate}}\nDeliver to: {{deliverTo}}\n{{pstNote}}\n\nPlease confirm you have received it and let us know the expected ship date.\n\nThank you,\n{{senderName}}\n{{companyName}}',
    vars: PO_VARS,
  },
  {
    key: 'PO_PRICED_INTERNAL',
    label: 'PO cut – priced copy (project manager)',
    audience: "The job's project manager and the company's PO copy list",
    mode: 'AUTO',
    subject: 'PO {{poNumber}} issued – {{target}} – {{total}}',
    body: '{{senderName}} issued PO {{poNumber}} to {{vendorName}} for {{target}}.\n\nTotal: {{total}}\nExpected: {{expectedDate}}\nDeliver to: {{deliverTo}}\n{{pstNote}}\n\nThe priced PO is attached.\nOpen in Bowron: {{link}}',
    vars: PO_VARS,
  },
  {
    key: 'PO_PACKING_YARD',
    label: 'PO cut – packing list (yard / receivers)',
    audience: 'Yard receivers (or the job, for direct deliveries)',
    mode: 'AUTO',
    subject: 'Coming in: PO {{poNumber}} from {{vendorName}} – expected {{expectedDate}}',
    body: 'PO {{poNumber}} from {{vendorName}} for {{target}} is on order.\n\nExpected: {{expectedDate}}\nDeliver to: {{deliverTo}}\n\nThe packing list (no prices) is attached.\nReceive it in Bowron: {{link}}',
    vars: PO_VARS,
  },
  {
    key: 'PO_APPROVAL_REQUEST',
    label: 'PO needs approval',
    audience: 'Admins and the job’s project manager',
    mode: 'AUTO',
    subject: 'Approval needed: PO {{poNumber}} – {{total}}',
    body: '{{senderName}} wants to issue PO {{poNumber}} to {{vendorName}} for {{target}}.\n\nTotal: {{total}} (over the approval limit of {{limit}})\n\nApprove or send it back: {{link}}',
    vars: [...PO_VARS, 'limit'],
  },
  {
    key: 'PO_FOLLOWUP_VENDOR',
    label: 'Shipping status request to the vendor',
    audience: 'Vendor (sent a set number of days before the expected date)',
    mode: 'REVIEW',
    subject: 'Shipping status – PO {{poNumber}}',
    body: 'Hello {{vendorContact}},\n\nCould you please confirm the shipping status of PO {{poNumber}}? We are expecting it by {{expectedDate}}, delivered to {{deliverTo}}.\n\nIf the date has changed, please let us know the new date.\n\nThank you,\n{{senderName}}\n{{companyName}}',
    vars: PO_VARS,
  },
  {
    key: 'PO_ARRIVAL_YARD',
    label: '“Has it arrived?” prompt',
    audience: 'Yard receivers (on the expected date)',
    mode: 'AUTO',
    subject: 'Has PO {{poNumber}} arrived? (expected {{expectedDate}})',
    body: 'PO {{poNumber}} from {{vendorName}} for {{target}} was expected {{expectedDate}}.\n\nIf it has arrived, please receive it: {{link}}\nIf not, no action is needed — procurement can see it is overdue.',
    vars: PO_VARS,
  },
  {
    key: 'ORDER_TO_PROCUREMENT',
    label: 'Order list submitted – procurement',
    audience: 'Procurement',
    mode: 'AUTO',
    subject: '{{orderLabel}} – {{siteName}} – {{lineCount}} line(s)',
    body: 'Please see attached list for processing.\n\n{{orderLabel}} – {{siteName}}\nSubmitted by {{senderName}}\n\nOpen in Bowron: {{link}}',
    vars: ['orderLabel', 'siteName', 'lineCount', 'senderName', 'link', 'companyName'],
  },
  {
    key: 'ORDER_TO_YARD',
    label: 'Order list submitted – yard stock check',
    audience: 'Yard',
    mode: 'AUTO',
    subject: 'Stock check: {{orderLabel}} – {{siteName}}',
    body: 'Please confirm what you have available for stock.\n\n{{orderLabel}} – {{siteName}}\nSubmitted by {{senderName}}\n\nOpen in Bowron: {{link}}',
    vars: ['orderLabel', 'siteName', 'lineCount', 'senderName', 'link', 'companyName'],
  },
  {
    key: 'AP_APPROVAL_REQUEST',
    label: 'Vendor invoice needs approval',
    audience: 'Whoever approves the next step (procurement, PM, operations manager…)',
    mode: 'AUTO',
    subject: 'Invoice {{invoiceNumber}} from {{vendorName}} needs your approval – {{total}}',
    body: 'Invoice {{invoiceNumber}} from {{vendorName}} ({{total}}) for {{target}} is waiting for your approval.\n{{matchNote}}\n\nOpen it: {{link}}',
    vars: ['invoiceNumber', 'vendorName', 'total', 'target', 'poNumber', 'matchNote', 'link', 'companyName'],
  },
  {
    key: 'AP_REJECTION',
    label: 'Invoice rejected – to the vendor',
    audience: 'The vendor’s accounts contact (Contacts › “Send invoice rejections to this person”)',
    mode: 'REVIEW',
    subject: 'Invoice {{invoiceNumber}} returned – {{companyName}}',
    body: 'Hello {{vendorContact}},\n\nWe are returning invoice {{invoiceNumber}} ({{total}}){{poRef}} for the following reason:\n\n{{reason}}\n\nPlease send a revised invoice or credit note that refers to invoice {{invoiceNumber}}.\n\nThank you,\n{{senderName}}\n{{companyName}}',
    vars: ['invoiceNumber', 'total', 'poRef', 'reason', 'vendorContact', 'senderName', 'companyName'],
  },
  {
    key: 'AR_INVOICE',
    label: 'Our invoice to a customer',
    audience: 'Customer',
    mode: 'REVIEW',
    subject: 'Invoice {{invoiceNumber}} from {{companyName}}',
    body: 'Hello {{customerContact}},\n\nPlease find attached invoice {{invoiceNumber}} for {{project}}.\n\nAmount due: {{amountDue}}\nDue date: {{dueDate}}\n\nThank you,\n{{senderName}}\n{{companyName}}',
    vars: ['invoiceNumber', 'project', 'amountDue', 'dueDate', 'customerContact', 'senderName', 'companyName'],
  },
  {
    key: 'MEETING_MINUTES',
    label: 'Meeting minutes to the people who attended',
    audience: 'The people at the meeting',
    mode: 'AUTO',
    subject: 'Minutes: {{meetingTitle}} ({{meetingDate}})',
    body: 'Hello,\n\nThe minutes for {{meetingTitle}} on {{meetingDate}} are attached.\n\nAction items:\n{{actionList}}\n\n{{senderName}}\n{{companyName}}',
    vars: ['meetingTitle', 'meetingDate', 'actionList', 'senderName', 'companyName'],
  },
  {
    key: 'ACTION_ASSIGNED',
    label: 'Action item given to someone',
    audience: 'The person it was given to',
    mode: 'AUTO',
    subject: 'Action item: {{actionText}}',
    body: 'Hello {{assigneeName}},\n\nFrom {{meetingTitle}}: {{actionText}}\nDue: {{dueDate}}\n\nMark it done in Bowron under Action items.\n\n{{senderName}}',
    vars: ['assigneeName', 'actionText', 'meetingTitle', 'dueDate', 'senderName'],
  },
];

export const templateDef = (key: string) => EMAIL_TEMPLATES.find((t) => t.key === key);

/** Fill in {{placeholders}}; unknown ones are left blank. Blank lines left by empty values are tidied. */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (vars[k] == null ? '' : String(vars[k])))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
