// Demo data for testing. Everything here is fictional (example.com addresses).
// Your real companies are loaded separately by `pnpm db:setup-private`.
import 'dotenv/config';
import { db } from '../src/lib/db';
import { addMember, addRecipient, upsertCompany, upsertSite, upsertUser } from './seed-helpers';

async function main() {
  console.log('Seeding demo organization…');
  const org = await db.organization.upsert({
    where: { slug: 'demo' },
    create: { name: 'Demo Construction Group', slug: 'demo' },
    update: {},
  });

  const piling = await upsertCompany(org.id, { code: 'DPC', name: 'Demo Piling Co.', themeColor: '#E8701A' });
  const earth = await upsertCompany(org.id, { code: 'DEC', name: 'Demo Earthworks Ltd.', themeColor: '#2E7D32' });
  const paving = await upsertCompany(org.id, { code: 'DPV', name: 'Demo Paving Inc.', themeColor: '#C62828' });

  const owner = await upsertUser(org.id, { email: 'owner@example.com', name: 'Olivia Owner', roles: ['ADMIN'], companyId: null, isPlatformOwner: true });
  await upsertUser(org.id, { email: 'admin@example.com', name: 'Adam Admin', roles: ['ADMIN'], companyId: null });
  const proc = await upsertUser(org.id, { email: 'procurement@example.com', name: 'Paula Procurement', roles: ['PROCUREMENT'], companyId: piling.id });
  const yard = await upsertUser(org.id, { email: 'yard@example.com', name: 'Yusuf Yard', roles: ['YARD'], companyId: piling.id });
  const site1 = await upsertUser(org.id, { email: 'site@example.com', name: 'Sam Site', roles: ['SITE'], companyId: piling.id });
  const site2 = await upsertUser(org.id, { email: 'site2@example.com', name: 'Sasha Field', roles: ['SITE'], companyId: earth.id });
  const multi = await upsertUser(org.id, { email: 'multi@example.com', name: 'Morgan Multi', roles: ['YARD', 'PROCUREMENT'], companyId: paving.id });

  const mainYard = await upsertSite(org.id, {
    type: 'YARD', companyId: null, jobNumber: 'Y1', name: 'Main Yard',
    address: '1200 Industrial Way', city: 'Surrey', province: 'BC', lat: 49.1913, lng: -122.849,
    yardCompanyIds: [piling.id, earth.id, paving.id],
  });
  const northYard = await upsertSite(org.id, {
    type: 'YARD', companyId: null, jobNumber: 'Y2', name: 'North Yard',
    city: 'Grande Prairie', province: 'AB', lat: 55.1707, lng: -118.7947, yardCompanyIds: [earth.id],
  });

  const jobs = [
    { company: piling, jobNumber: '2249', name: 'Highway 16 Bridge Replacement', city: 'Prince George', province: 'BC', lat: 53.9171, lng: -122.7497 },
    { company: piling, jobNumber: '26-BC249', name: 'Fraser River Pile Wall', city: 'Mission', province: 'BC', lat: 49.1337, lng: -122.3112 },
    { company: earth, jobNumber: '3101', name: 'Subdivision Earthworks Phase 2', city: 'Red Deer', province: 'AB', lat: 52.2681, lng: -113.8112 },
    { company: earth, jobNumber: '3102', name: 'Pipeline Right-of-Way', city: 'Grande Prairie', province: 'AB', lat: 55.1707, lng: -118.7947 },
    { company: paving, jobNumber: '4501', name: 'Downtown Resurfacing', city: 'Kamloops', province: 'BC', lat: 50.6745, lng: -120.3273 },
    { company: paving, jobNumber: '4502', name: 'Airport Apron Paving', city: 'Kelowna', province: 'BC', lat: 49.9561, lng: -119.3778 },
  ];
  const sites: Record<string, { id: string }> = {};
  for (const j of jobs) {
    sites[j.jobNumber] = await upsertSite(org.id, {
      type: 'JOB', companyId: j.company.id, jobNumber: j.jobNumber, name: j.name, city: j.city, province: j.province, lat: j.lat, lng: j.lng,
    });
  }

  await addMember(sites['2249']!.id, site1.id);
  await addMember(sites['26-BC249']!.id, site1.id);
  await addMember(sites['3101']!.id, site2.id);
  await addMember(mainYard.id, yard.id);
  await addMember(mainYard.id, multi.id);
  await addMember(northYard.id, multi.id);
  await addMember(sites['2249']!.id, proc.id);

  for (const c of [piling, earth, paving]) {
    await addRecipient(c.id, 'PROCUREMENT', 'procurement@example.com');
    await addRecipient(c.id, 'YARD', 'yard@example.com');
  }

  const contactCount = await db.contact.count({ where: { organizationId: org.id } });
  if (contactCount === 0) {
    await db.contact.createMany({
      data: [
        { organizationId: org.id, type: 'TRUCKING', name: 'Dispatch', businessName: 'Northern Haul Ltd.', phone: '604-555-0101', email: 'dispatch@example.com' },
        { organizationId: org.id, type: 'TRUCKING', name: 'Dispatch', businessName: 'Valley Flatdeck Services', phone: '250-555-0144' },
        { organizationId: org.id, type: 'VENDOR', name: 'Inside Sales', businessName: 'Coastal Steel Supply', phone: '604-555-0170', email: 'sales@example.com' },
        { organizationId: org.id, type: 'PERSON', name: 'Rita Inspector', businessName: 'Geotech Consulting', cell: '778-555-0199' },
      ],
    });
  }

  console.log(`Demo ready. Sign in with any of these (codes show on screen in development):
  owner@example.com (platform owner) · admin@example.com · procurement@example.com
  yard@example.com · site@example.com · site2@example.com · multi@example.com
  Owner id: ${owner.id}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
