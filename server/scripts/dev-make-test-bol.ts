// Dev helper: make an issued TEST BOL in your own organization and save its PDF
// plus a phone-photo-style JPEG of it, for trying "Scan BOL" on the receive screen.
// Run: EMAIL_PROVIDER=console tsx --env-file=.env scripts/dev-make-test-bol.ts <your email> <output folder>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { emptyDraftRow } from '@supplyline/core/models';
import type { AuthContext } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { bolQrPayload } from '../src/pdf/bol-pdf';
import { availableLots, createBol, getBolPdf, issueBol } from '../src/services/bols';
import { createDraft, saveDraft, submitOrder } from '../src/services/orders';
import { saveStockCheck } from '../src/services/yard';

async function main() {
  const [email, outDir] = process.argv.slice(2);
  if (!email || !outDir) throw new Error('Usage: dev-make-test-bol.ts <email> <output folder>');
  const user = await db.user.findFirstOrThrow({ where: { email: email.toLowerCase() } });
  const auth: AuthContext = {
    sessionId: 'dev-script',
    userId: user.id,
    orgId: user.organizationId,
    companyId: user.companyId,
    email: user.email,
    name: user.name,
    roles: user.roles as AuthContext['roles'],
    isPlatformOwner: user.isPlatformOwner,
    clientApp: 'script',
    clientVersion: '0',
  };
  const job = await db.site.findFirstOrThrow({ where: { organizationId: auth.orgId, type: 'JOB', jobNumber: '2249' } });
  const yard = await db.site.findFirstOrThrow({ where: { organizationId: auth.orgId, type: 'YARD', yardCompanies: { some: { companyId: job.companyId! } } } });
  const loc = async (siteId: string) => (await db.shippingLocation.findFirstOrThrow({ where: { siteId } })).id;

  // 1. A test order list for the job.
  const { id } = await createDraft(auth, job.id);
  await saveDraft(auth, id, {
    rows: [
      { ...emptyDraftRow('TT'), description: 'TEST – 20M rebar 6 m', quantity: '10', uom: 'EA' },
      { ...emptyDraftRow('TT'), description: 'TEST – Tie wire', quantity: '5', uom: 'ROLL' },
    ],
  });
  const order = (await submitOrder(auth, id)).order;
  // 2. The yard has it all in stock.
  await saveStockCheck(auth, order.id, { yardId: yard.id, lines: order.lines.map((l) => ({ lineId: l.id, qtyAvailable: Number(l.quantity) })) });
  // 3. Ship it on a BOL and issue it.
  const yardLoc = await loc(yard.id);
  const lots = (await availableLots(auth, yardLoc, job.companyId!)).filter((l) => l.orderId === order.id);
  const today = new Date().toLocaleDateString('en-CA');
  const draft = await createBol(auth, {
    companyId: job.companyId!,
    driverName: 'Test Driver',
    truckUnit: 'T-1',
    notes: 'TEST BOL – for trying the Scan BOL photo receiving. Delete before go-live.',
    stops: [
      { key: 'p', kind: 'PICKUP', locationId: yardLoc, plannedDate: today },
      { key: 'd', kind: 'DROP', locationId: await loc(job.id), plannedDate: today },
    ],
    lines: lots.map((l) => ({ lotId: l.lotId, qty: l.qtyAvailable, pickupKey: 'p', dropKey: 'd' })),
  });
  const bol = await issueBol(auth, draft.id);

  // 4. Save the PDF and a "photo" of it.
  mkdirSync(outDir, { recursive: true });
  const { bytes } = await getBolPdf(auth, bol.id);
  const pdfPath = join(outDir, `TEST-BOL-${bol.bolNumber}.pdf`);
  writeFileSync(pdfPath, bytes);

  const qr = await QRCode.toBuffer(bolQrPayload(bol.id, bol.bolNumber), { type: 'png', margin: 1, width: 330 });
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const lines = lots.map((l, i) => `<text x="90" y="${760 + i * 46}" font-size="30">${i + 1}. ${esc(l.description)} – ${l.qtyAvailable} ${l.uom}</text>`).join('');
  const page = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1600">
    <rect width="1240" height="1600" fill="#f6f5f0"/>
    <text x="90" y="150" font-family="Arial" font-size="40" font-weight="bold">BILL OF LADING</text>
    <text x="90" y="225" font-family="Arial" font-size="64" font-weight="bold">BOL #${bol.bolNumber}</text>
    <text x="90" y="300" font-family="Arial" font-size="30">From: ${esc(yard.name)}</text>
    <text x="90" y="345" font-family="Arial" font-size="30">To: JOB#${esc(job.jobNumber)} – ${esc(job.name)}</text>
    <text x="90" y="390" font-family="Arial" font-size="30">Driver: Test Driver · Truck T-1 · ${today}</text>
    <text x="90" y="700" font-family="Arial" font-size="34" font-weight="bold">Items</text>
    <g font-family="Arial">${lines}</g>
    <text x="90" y="1450" font-family="Arial" font-size="26" fill="#777">TEST – photo of a BOL for trying Scan BOL in Bowron</text>
  </svg>`);
  const photo = await sharp(page)
    .composite([{ input: qr, left: 820, top: 90 }])
    .rotate(2, { background: '#d9d6cc' }) // slightly crooked, like a real photo
    .jpeg({ quality: 82 })
    .toBuffer();
  const jpgPath = join(outDir, `TEST-BOL-${bol.bolNumber}-photo.jpg`);
  writeFileSync(jpgPath, photo);
  console.log(JSON.stringify({ bolNumber: bol.bolNumber, bolId: bol.id, order: order.label, pdfPath, jpgPath }, null, 1));
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
