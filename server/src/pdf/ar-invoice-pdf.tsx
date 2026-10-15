import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { formatQty } from '@supplyline/core/domain';

// Our invoice to a customer.

export interface ArPdfData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  companyName: string;
  companyCode: string;
  themeColor: string;
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
  customer: { name: string; contactName: string | null; address: string | null };
  project: string | null;
  description: string | null;
  lines: { description: string; qty: number; uom: string; unitPrice: number; amount: number }[];
  subtotal: number;
  gst: number;
  gstRate: number;
  pst: number;
  pstRate: number;
  holdbackPct: number | null;
  holdbackAmount: number;
  total: number;
  amountDue: number;
  gstNumber: string | null;
}

const money = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  logo: { height: 38, maxWidth: 150, objectFit: 'contain' },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  muted: { color: '#555555' },
  box: { border: '1pt solid #cccccc', padding: 8, marginBottom: 12, width: '48%' },
  head: { flexDirection: 'row', borderBottom: '1pt solid #111111', paddingBottom: 3, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #dddddd', paddingVertical: 3 },
  tot: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
});

function ArDoc({ d }: { d: ArPdfData }) {
  return (
    <Document title={`Invoice ${d.invoiceNumber} – ${d.companyName}`} author={d.companyName} creator="Bowron">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {d.logo ? <Image src={d.logo} style={s.logo} /> : <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: d.themeColor }}>{d.companyCode}</Text>}
            <Text style={{ marginTop: 3 }}>{d.companyName}</Text>
            {d.gstNumber && <Text style={s.muted}>GST # {d.gstNumber}</Text>}
          </View>
          <View>
            <Text style={s.title}>INVOICE</Text>
            <Text style={{ textAlign: 'right', fontSize: 12 }}>{d.invoiceNumber}</Text>
            <Text style={[s.muted, { textAlign: 'right' }]}>Date: {d.invoiceDate}</Text>
            <Text style={[s.muted, { textAlign: 'right' }]}>Due: {d.dueDate}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={s.box}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Bill to</Text>
            <Text>{d.customer.name}</Text>
            {d.customer.contactName && <Text>{d.customer.contactName}</Text>}
            {d.customer.address && <Text>{d.customer.address}</Text>}
          </View>
          <View style={s.box}>
            <Text style={{ fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Project</Text>
            <Text>{d.project ?? '—'}</Text>
            {d.description && <Text style={s.muted}>{d.description}</Text>}
          </View>
        </View>
        <View style={s.head}>
          <Text style={{ width: '52%' }}>Description</Text>
          <Text style={{ width: '12%', textAlign: 'right' }}>Qty</Text>
          <Text style={{ width: '8%', paddingLeft: 4 }}>Unit</Text>
          <Text style={{ width: '14%', textAlign: 'right' }}>Price</Text>
          <Text style={{ width: '14%', textAlign: 'right' }}>Amount</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={{ width: '52%', paddingRight: 4 }}>{l.description}</Text>
            <Text style={{ width: '12%', textAlign: 'right' }}>{formatQty(l.qty)}</Text>
            <Text style={{ width: '8%', paddingLeft: 4 }}>{l.uom}</Text>
            <Text style={{ width: '14%', textAlign: 'right' }}>{money(l.unitPrice)}</Text>
            <Text style={{ width: '14%', textAlign: 'right' }}>{money(l.amount)}</Text>
          </View>
        ))}
        <View style={{ alignSelf: 'flex-end', width: '42%', marginTop: 8 }}>
          <View style={s.tot}>
            <Text>Subtotal</Text>
            <Text>{money(d.subtotal)}</Text>
          </View>
          {d.gstRate > 0 && (
            <View style={s.tot}>
              <Text>GST {pct(d.gstRate)}</Text>
              <Text>{money(d.gst)}</Text>
            </View>
          )}
          {d.pstRate > 0 && (
            <View style={s.tot}>
              <Text>PST {pct(d.pstRate)}</Text>
              <Text>{money(d.pst)}</Text>
            </View>
          )}
          <View style={[s.tot, { fontFamily: 'Helvetica-Bold', borderTop: '1pt solid #111111', marginTop: 2, paddingTop: 3 }]}>
            <Text>Invoice total</Text>
            <Text>{money(d.total)}</Text>
          </View>
          {d.holdbackAmount > 0 && (
            <>
              <View style={s.tot}>
                <Text>Less holdback {d.holdbackPct}%</Text>
                <Text>-{money(d.holdbackAmount)}</Text>
              </View>
              <View style={[s.tot, { fontFamily: 'Helvetica-Bold' }]}>
                <Text>Amount due now</Text>
                <Text>{money(d.amountDue)}</Text>
              </View>
            </>
          )}
        </View>
      </Page>
    </Document>
  );
}

export async function renderArInvoicePdf(d: ArPdfData): Promise<Buffer> {
  return renderToBuffer(<ArDoc d={d} />);
}
