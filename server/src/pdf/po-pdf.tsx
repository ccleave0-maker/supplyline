import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { formatQty } from '@supplyline/core/domain';

// Purchase order PDF. The packing-list version has the same lines and
// quantities with every price and total removed (for the yard / receivers).

export interface PoPdfData {
  poNumber: string;
  /** PNG of the QR code (scan to receive / open the PO) */
  qr: Buffer;
  status: string;
  companyName: string;
  companyCode: string;
  themeColor: string;
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
  vendor: { name: string; contactName: string | null; email: string | null; phone: string | null };
  target: string;
  orderedDate: string | null;
  expectedDate: string | null;
  deliverTo: string;
  shipToText: string | null;
  /** Ship via (carrier + our account #), a chosen ship-to, and the contacts (name, phone, email) */
  shipVia?: string | null;
  shipTo?: string | null;
  contacts?: { label: string; name: string; phone: string | null; email: string | null }[];
  shipDirect?: boolean;
  notes: string | null;
  issuedByName: string | null;
  lines: { lineNo: number; ref: string | null; description: string; qty: number; uom: string; unitCost: number | null; extended: number | null }[];
  totals: { subtotal: number; gst: number; pst: number; hst: number; total: number };
  rates: { gst: number; pst: number; hst: number };
  /** "PST exempt – exemption # 1234 (form attached)" etc. */
  taxNote: string | null;
}

const money = (n: number | null) => (n == null ? '' : n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' }));
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: 'Helvetica', color: '#111111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  logo: { height: 38, maxWidth: 150, objectFit: 'contain' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  big: { fontSize: 20, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555555' },
  boxes: { flexDirection: 'row', marginBottom: 10 },
  box: { flex: 1, border: '1pt solid #cccccc', padding: 6, marginRight: 6 },
  boxTitle: { fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', borderTop: '1pt solid #bbbbbb', borderBottom: '1pt solid #bbbbbb', paddingVertical: 5, marginBottom: 10 },
  metaItem: { width: '33%', paddingVertical: 2 },
  head: { flexDirection: 'row', borderBottom: '1pt solid #111111', paddingBottom: 3, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #dddddd', paddingVertical: 3 },
  totals: { alignSelf: 'flex-end', width: '40%', marginTop: 8 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: { fontFamily: 'Helvetica-Bold', fontSize: 11, borderTop: '1pt solid #111111', marginTop: 2, paddingTop: 3 },
  footer: { position: 'absolute', bottom: 16, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', color: '#777777', fontSize: 8 },
});

function PoDoc({ d, packing }: { d: PoPdfData; packing: boolean }) {
  const cols = packing
    ? { n: '6%', ref: '22%', desc: '54%', qty: '10%', uom: '8%' }
    : { n: '5%', ref: '17%', desc: '38%', qty: '9%', uom: '7%', unit: '12%', ext: '12%' };
  const title = packing ? 'PACKING LIST' : 'PURCHASE ORDER';
  return (
    <Document title={`${title} ${d.poNumber} – ${d.companyName}`} author={d.companyName} creator="SupplyLine">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {d.logo ? <Image src={d.logo} style={s.logo} /> : <Text style={[s.title, { color: d.themeColor }]}>{d.companyCode}</Text>}
            <Text style={{ marginTop: 3 }}>{d.companyName}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ alignItems: 'center', marginRight: 10 }}>
            <Image src={{ data: d.qr, format: 'png' }} style={{ width: 72, height: 72 }} />
            <Text style={[s.muted, { fontSize: 6 }]}>Scan in SupplyLine</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.title}>{title}</Text>
            <Text style={s.big}>PO {d.poNumber}</Text>
            {d.status !== 'ISSUED' && d.status !== 'CLOSED' && <Text style={{ color: '#b00020', fontFamily: 'Helvetica-Bold' }}>{d.status === 'DRAFT' ? 'DRAFT – NOT ISSUED' : d.status === 'CANCELLED' ? 'CANCELLED' : 'WAITING FOR APPROVAL'}</Text>}
          </View>
          </View>
        </View>

        <View style={s.boxes}>
          <View style={s.box}>
            <Text style={s.boxTitle}>Vendor</Text>
            <Text>{d.vendor.name}</Text>
            {d.vendor.contactName && <Text>{d.vendor.contactName}</Text>}
            {d.vendor.phone && <Text>{d.vendor.phone}</Text>}
            {d.vendor.email && <Text>{d.vendor.email}</Text>}
            {(d.contacts ?? [])
              .filter((c) => c.label === 'Ordered with')
              .map((c) => (
                <Text key={c.name}>Ordered with: {[c.name, c.phone, c.email].filter(Boolean).join(' · ')}</Text>
              ))}
          </View>
          <View style={s.box}>
            <Text style={s.boxTitle}>Deliver to</Text>
            <Text>{d.shipTo ?? d.deliverTo}</Text>
            {d.shipToText && <Text style={s.muted}>{d.shipToText}</Text>}
            {d.shipDirect && <Text style={s.muted}>Ship direct to the job site</Text>}
            {d.shipVia && <Text>Ship via: {d.shipVia}</Text>}
            {(d.contacts ?? [])
              .filter((c) => c.label !== 'Ordered with')
              .map((c) => (
                <Text key={c.label + c.name}>
                  {c.label}: {[c.name, c.phone, c.email].filter(Boolean).join(' · ')}
                </Text>
              ))}
          </View>
          <View style={[s.box, { marginRight: 0 }]}>
            <Text style={s.boxTitle}>For</Text>
            <Text>{d.target}</Text>
          </View>
        </View>

        <View style={s.meta}>
          <Text style={s.metaItem}>Date ordered: {d.orderedDate ?? '—'}</Text>
          <Text style={s.metaItem}>Expected delivery (ETA): {d.expectedDate ?? '—'}</Text>
          <Text style={s.metaItem}>Ordered by: {d.issuedByName ?? '—'}</Text>
        </View>

        <View style={s.head}>
          <Text style={{ width: cols.n }}>#</Text>
          <Text style={{ width: cols.ref }}>Ref</Text>
          <Text style={{ width: cols.desc, paddingRight: 4 }}>Description</Text>
          <Text style={{ width: cols.qty, textAlign: 'right', paddingRight: 4 }}>Qty</Text>
          <Text style={{ width: cols.uom }}>Unit</Text>
          {!packing && <Text style={{ width: cols.unit, textAlign: 'right' }}>Unit price</Text>}
          {!packing && <Text style={{ width: cols.ext, textAlign: 'right' }}>Amount</Text>}
        </View>
        {d.lines.map((l) => (
          <View key={l.lineNo} style={s.row} wrap={false}>
            <Text style={{ width: cols.n }}>{l.lineNo}</Text>
            <Text style={{ width: cols.ref }}>{l.ref ?? ''}</Text>
            <Text style={{ width: cols.desc, paddingRight: 4 }}>{l.description}</Text>
            <Text style={{ width: cols.qty, textAlign: 'right', paddingRight: 4 }}>{formatQty(l.qty)}</Text>
            <Text style={{ width: cols.uom }}>{l.uom}</Text>
            {!packing && <Text style={{ width: cols.unit, textAlign: 'right' }}>{money(l.unitCost)}</Text>}
            {!packing && <Text style={{ width: cols.ext, textAlign: 'right' }}>{money(l.extended)}</Text>}
          </View>
        ))}

        {!packing && (
          <View style={s.totals}>
            <View style={s.totalRow}>
              <Text>Subtotal</Text>
              <Text>{money(d.totals.subtotal)}</Text>
            </View>
            {d.rates.hst > 0 ? (
              <View style={s.totalRow}>
                <Text>HST {pct(d.rates.hst)}</Text>
                <Text>{money(d.totals.hst)}</Text>
              </View>
            ) : (
              <>
                <View style={s.totalRow}>
                  <Text>GST {pct(d.rates.gst)}</Text>
                  <Text>{money(d.totals.gst)}</Text>
                </View>
                <View style={s.totalRow}>
                  <Text>PST {d.rates.pst > 0 ? pct(d.rates.pst) : ''}</Text>
                  <Text>{d.rates.pst > 0 ? money(d.totals.pst) : 'Exempt / n/a'}</Text>
                </View>
              </>
            )}
            <View style={[s.totalRow, s.grand]}>
              <Text>Total (CAD)</Text>
              <Text>{money(d.totals.total)}</Text>
            </View>
          </View>
        )}
        {d.taxNote && <Text style={{ marginTop: 8, fontFamily: 'Helvetica-Bold' }}>{d.taxNote}</Text>}
        {packing && <Text style={[s.muted, { marginTop: 8 }]}>Packing list – prices removed. Check quantities on arrival and record them in SupplyLine.</Text>}
        {d.notes && (
          <View style={{ marginTop: 10 }}>
            <Text style={s.boxTitle}>Notes</Text>
            <Text>{d.notes}</Text>
          </View>
        )}
        <View style={s.footer} fixed>
          <Text>
            {d.companyName} · PO {d.poNumber}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPoPdf(d: PoPdfData, packing = false): Promise<Buffer> {
  return renderToBuffer(<PoDoc d={d} packing={packing} />);
}
