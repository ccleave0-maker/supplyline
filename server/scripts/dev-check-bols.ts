// Dev helper: list organizations, their BOLs and stock that could go on one.
import { db } from '../src/lib/db';

async function main() {
  const orgs = await db.organization.findMany({ select: { id: true, name: true } });
  for (const o of orgs) {
    const bols = await db.billOfLading.findMany({ where: { organizationId: o.id }, select: { id: true, bolNumber: true, status: true } });
    const lots = await db.inventoryLot.count({ where: { organizationId: o.id, qtyAvailable: { gt: 0 } } });
    const sites = await db.site.findMany({ where: { organizationId: o.id }, select: { type: true, jobNumber: true, name: true } });
    const users = await db.user.findMany({ where: { organizationId: o.id }, select: { email: true, roles: true } });
    console.log(JSON.stringify({ org: o.name, bols, lotsWithStock: lots, sites, users }, null, 1));
  }
}
main().finally(() => db.$disconnect());
