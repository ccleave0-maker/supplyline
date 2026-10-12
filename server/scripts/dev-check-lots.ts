// Dev helper: stock waiting at each location, by company (for checking the BOL builder).
import { db } from '../src/lib/db';

async function main() {
  const email = process.argv[2]!;
  const user = await db.user.findFirstOrThrow({ where: { email: email.toLowerCase() } });
  const companies = await db.company.findMany({ where: { organizationId: user.organizationId }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
  console.log('user company:', user.companyId, 'companies (as listed):', companies.map((c) => `${c.code} ${c.name}`));
  const lots = await db.inventoryLot.findMany({
    where: { organizationId: user.organizationId },
    include: { location: { select: { businessName: true, siteId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  for (const l of lots as unknown as { companyId: string; description: string; qtyAvailable: unknown; status: string; source: string; location: { businessName: string } }[])
    console.log(`${companies.find((c) => c.id === l.companyId)?.code} | ${l.location.businessName} | ${l.description} | avail ${l.qtyAvailable} | ${l.status} | ${l.source}`);
  const receipts = await db.yardReceipt.findMany({ where: { organizationId: user.organizationId }, include: { lines: true, yard: { select: { name: true } } } });
  for (const r of receipts) console.log('yard receipt', r.yard.name, r.receivedAt.toISOString(), r.lines.map((x) => `${x.qtyReceived} (orderLine ${x.orderLineId ? 'yes' : 'no'})`).join(', '));
  const yards = await db.site.findMany({ where: { organizationId: user.organizationId, type: 'YARD' }, include: { yardCompanies: true, shippingLocation: { select: { id: true } } } });
  for (const y of yards) console.log('yard', y.name, 'serves', y.yardCompanies.map((c) => companies.find((x) => x.id === c.companyId)?.code), 'location', !!y.shippingLocation);
}
main().finally(() => db.$disconnect());

