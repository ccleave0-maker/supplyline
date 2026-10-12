import type { Role } from './models/common';

/**
 * Role → action matrix. The server enforces this on every request;
 * the apps read it only to hide buttons the user can't use.
 */
export const ACTIONS = {
  'platform:manage': [], // platform owner only (see can())
  'org:manage': ['ADMIN'], // companies, users, invites, yards, settings
  'company:edit': ['ADMIN'],
  'user:manage': ['ADMIN'],
  'site:create': ['ADMIN'],
  'site:edit': ['ADMIN', 'PROCUREMENT'], // profile, address, personnel, contacts, email routing
  'site:view': ['ADMIN', 'PROCUREMENT', 'YARD', 'SITE'],
  'contact:edit': ['ADMIN', 'PROCUREMENT', 'YARD'],
  'contact:view': ['ADMIN', 'PROCUREMENT', 'YARD', 'SITE'],
  'order:create': ['ADMIN', 'PROCUREMENT', 'SITE'], // create, edit drafts and submit for visible jobs
  'order:view': ['ADMIN', 'PROCUREMENT', 'YARD', 'SITE'],
  'order:cancel-line': ['ADMIN', 'PROCUREMENT', 'SITE'],
  'costcode:manage': ['ADMIN', 'PROCUREMENT'],
  'yard:work': ['ADMIN', 'YARD'], // stock checks, receiving deliveries
  'yard:view': ['ADMIN', 'YARD', 'PROCUREMENT'], // incoming list, yard inventory, receipts
  'procurement:work': ['ADMIN', 'PROCUREMENT'], // RFQs, POs, vendors, ETAs, costs, custom columns
  'bol:create': ['ADMIN', 'YARD'], // build and issue bills of lading
  'bol:view': ['ADMIN', 'PROCUREMENT', 'YARD', 'SITE'],
  'bol:receive': ['ADMIN', 'YARD', 'SITE'], // receive a BOL at a drop stop
  'return:create': ['ADMIN', 'YARD', 'SITE'], // send material back to the yard
  'schedule:edit': ['ADMIN', 'YARD'], // move loads to another day on the schedule
  'trailer:manage': ['ADMIN', 'YARD'], // the trailer library
  'loads:plan': ['ADMIN', 'YARD', 'PROCUREMENT'], // load builder, item sizes and weights
  'meeting:run': ['ADMIN', 'PROCUREMENT', 'SITE', 'YARD'], // run meetings on jobs you can see; action items
  'meeting:template': ['ADMIN'], // meeting formats (the 70-30 template)
  'health:view': ['ADMIN'], // health checks and their settings
  'reports:view': ['ADMIN', 'PROCUREMENT', 'AP'], // reports
  'location:edit': ['ADMIN', 'PROCUREMENT', 'YARD'],
  'recycle:manage': ['ADMIN'], // see and restore deleted records
  'equipment:edit': ['ADMIN', 'YARD'], // add / edit / import equipment
  'equipment:move': ['ADMIN', 'YARD', 'SITE'], // record where a unit went
  'rental:edit': ['ADMIN', 'PROCUREMENT', 'SITE'], // rental tracker on a job
  'qc:upload': ['ADMIN', 'PROCUREMENT', 'YARD', 'SITE'], // MTRs and certificates
  'subcontract:manage': ['ADMIN', 'PROCUREMENT'], // subcontract documents (a job's PM too)
  'compliance:edit': ['ADMIN', 'PROCUREMENT'], // WCB / insurance records
  'po:view': ['ADMIN', 'PROCUREMENT', 'YARD'], // see POs (the job's PM too)
  'email:review': ['ADMIN', 'PROCUREMENT'], // check queued emails before they go out
  'email:templates': ['ADMIN'], // change email wording per company
  'ap:work': ['ADMIN', 'PROCUREMENT', 'AP'], // vendor invoices: inbox, matching, rejections, paying
  'ar:work': ['ADMIN', 'PROCUREMENT', 'AP'], // customers and customer invoices
  'budget:edit': ['ADMIN', 'PROCUREMENT'], // job budgets (the job's PM too)
  'integrations:manage': ['ADMIN'], // network filing, Sync app, export mappings, imports, full data export
  'export:run': ['ADMIN', 'PROCUREMENT', 'AP'], // run saved export mappings
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof ACTIONS;

export interface Actor {
  roles: readonly Role[];
  isPlatformOwner: boolean;
}

export function can(actor: Actor | null | undefined, action: Action): boolean {
  if (!actor) return false;
  if (action === 'platform:manage') return actor.isPlatformOwner;
  const allowed: readonly Role[] = ACTIONS[action];
  return actor.roles.some((r) => allowed.includes(r));
}

export function hasRole(actor: Actor | null | undefined, role: Role): boolean {
  return !!actor && actor.roles.includes(role);
}
