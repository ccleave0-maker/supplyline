import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { formatQty } from '@supplyline/core/domain';

export interface OrderPdfData {
  companyName: string;
  companyCode: string;
  themeColor: string;
  /** PNG or JPG bytes; other formats fall back to the company code */
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
  label: string;
  /** PNG of the QR code (scan to open the list) */
  qr: Buffer | null;
  jobNumber: string;
  siteName: string;
  siteAddress: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  notes: string | null;
  lines: {
    lineNo: number;
    description: string;
    quantity: number;
    uom: string;
    costCode: string | null;
    orderedByInitials: string;
    requiredOnSite: string | null;
  }[];
}

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#111111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  logo: { height: 40, maxWidth: 160, objectFit: 'contain' },
  code: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  muted: { color: '#555555' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12, borderTop: '1pt solid #cccccc', borderBottom: '1pt solid #cccccc', paddingVertical: 6 },
  metaItem: { width: '50%', paddingVertical: 2 },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #cccccc', paddingVertical: 4 },
  head: { flexDirection: 'row', borderBottom: '1pt solid #111111', paddingBottom: 4, fontFamily: 'Helvetica-Bold' },
  cL: { width: '6%' },
  cDesc: { width: '44%', paddingRight: 6 },
  cQty: { width: '9%', textAlign: 'right', paddingRight: 6 },
  cUom: { width: '8%' },
  cCost: { width: '12%' },
  cBy: { width: '8%' },
  cDate: { width: '13%' },
  footer: { position: 'absolute', bottom: 20, left: 32, right: 32, flexDirection: 'row', justifyContent: 'space-between', color: '#777777', fontSize: 8 },
});

function OrderDoc({ d }: { d: OrderPdfData }) {
  return (
    <Document title={`${d.label} – ${d.siteName}`} author={d.companyName} creator="Bowron">
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <View>
            {d.logo ? <Image src={d.logo} style={s.logo} /> : <Text style={[s.code, { color: d.themeColor }]}>{d.companyCode}</Text>}
            <Text style={{ marginTop: 4 }}>{d.companyName}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ marginRight: 10 }}>
              <Text style={s.title}>{d.label}</Text>
              <Text style={[s.muted, { textAlign: 'right' }]}>Order list</Text>
            </View>
            {d.qr && <Image src={{ data: d.qr, format: 'png' }} style={{ width: 64, height: 64 }} />}
          </View>
        </View>

        <View style={s.meta}>
          <Text style={s.metaItem}>Job: JOB#{d.jobNumber} – {d.siteName}</Text>
          <Text style={s.metaItem}>Company: {d.companyName}</Text>
          <Text style={s.metaItem}>Submitted: {d.submittedAt ? d.submittedAt.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : 'Draft'}</Text>
          <Text style={s.metaItem}>Submitted by: {d.submittedBy ?? '—'}</Text>
          {d.siteAddress ? <Text style={s.metaItem}>Site address: {d.siteAddress}</Text> : null}
        </View>

        <View style={s.head} fixed>
          <Text style={s.cL}>L#</Text>
          <Text style={s.cDesc}>Description</Text>
          <Text style={s.cQty}>Qty</Text>
          <Text style={s.cUom}>Unit</Text>
          <Text style={s.cCost}>Cost code</Text>
          <Text style={s.cBy}>By</Text>
          <Text style={s.cDate}>Required on site</Text>
        </View>
        {d.lines.map((l) => (
          <View key={l.lineNo} style={s.row} wrap={false}>
            <Text style={s.cL}>L{l.lineNo}</Text>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={s.cQty}>{formatQty(l.quantity)}</Text>
            <Text style={s.cUom}>{l.uom}</Text>
            <Text style={s.cCost}>{l.costCode ?? ''}</Text>
            <Text style={s.cBy}>{l.orderedByInitials}</Text>
            <Text style={s.cDate}>{l.requiredOnSite ?? ''}</Text>
          </View>
        ))}

        {d.notes ? (
          <View style={{ marginTop: 12 }}>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>Notes</Text>
            <Text>{d.notes}</Text>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{d.label} · {d.lines.length} line(s)</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderOrderPdf(d: OrderPdfData): Promise<Buffer> {
  return renderToBuffer(<OrderDoc d={d} />);
}
