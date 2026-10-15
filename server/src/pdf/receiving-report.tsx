import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

// Receiving report: what came in, against what was expected, who took it and any
// problems. Made on every receipt; it goes with the vendor invoice for approval.

export interface ReceivingReportData {
  companyName: string;
  companyCode: string;
  themeColor: string;
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
  title: string;
  where: string;
  receivedAt: string;
  receivedBy: string;
  refs: string[];
  lines: { description: string; ref: string | null; expected: number; received: number; uom: string; problem: string | null }[];
  photos: number;
  notes: string | null;
}

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: 'Helvetica', color: '#111111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  logo: { height: 32, maxWidth: 140, objectFit: 'contain' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  muted: { color: '#555555' },
  head: { flexDirection: 'row', borderBottom: '1pt solid #111111', paddingBottom: 3, marginTop: 10, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #dddddd', paddingVertical: 3 },
  bad: { color: '#B91C1C' },
  footer: { position: 'absolute', bottom: 14, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', color: '#777777', fontSize: 7 },
});

function Report({ d }: { d: ReceivingReportData }) {
  const problems = d.lines.filter((l) => l.problem || l.received + 1e-6 < l.expected).length;
  return (
    <Document title={d.title} author={d.companyName} creator="Bowron">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {d.logo ? <Image src={d.logo} style={s.logo} /> : <Text style={[s.title, { color: d.themeColor }]}>{d.companyCode}</Text>}
            <Text style={s.title}>{d.title}</Text>
            <Text style={s.muted}>{d.refs.join(' · ')}</Text>
          </View>
          <View>
            <Text>{d.where}</Text>
            <Text style={s.muted}>Received {d.receivedAt}</Text>
            <Text style={s.muted}>by {d.receivedBy}</Text>
          </View>
        </View>
        <Text style={problems ? s.bad : undefined}>{problems ? `${problems} line(s) short, over or with a problem.` : 'Everything received as expected.'}</Text>
        <View style={s.head}>
          <Text style={{ width: '46%' }}>Item</Text>
          <Text style={{ width: '16%' }}>Ref</Text>
          <Text style={{ width: '10%', textAlign: 'right' }}>Expected</Text>
          <Text style={{ width: '10%', textAlign: 'right' }}>Received</Text>
          <Text style={{ width: '6%', paddingLeft: 4 }}>Unit</Text>
          <Text style={{ width: '12%' }}>Note</Text>
        </View>
        {d.lines.map((l, i) => {
          const off = l.problem || Math.abs(l.received - l.expected) > 1e-6;
          return (
            <View key={i} style={s.row} wrap={false}>
              <Text style={{ width: '46%', paddingRight: 4 }}>{l.description}</Text>
              <Text style={{ width: '16%' }}>{l.ref ?? ''}</Text>
              <Text style={{ width: '10%', textAlign: 'right' }}>{l.expected}</Text>
              <Text style={[{ width: '10%', textAlign: 'right' }, off ? s.bad : {}]}>{l.received}</Text>
              <Text style={{ width: '6%', paddingLeft: 4 }}>{l.uom}</Text>
              <Text style={[{ width: '12%' }, off ? s.bad : {}]}>{l.problem ?? (l.received + 1e-6 < l.expected ? 'Short' : l.received > l.expected + 1e-6 ? 'Over' : '')}</Text>
            </View>
          );
        })}
        {d.notes ? <Text style={{ marginTop: 8 }}>Notes: {d.notes}</Text> : null}
        {d.photos ? <Text style={[s.muted, { marginTop: 4 }]}>{d.photos} photo(s) taken — in Bowron with this receipt.</Text> : null}
        <View style={s.footer} fixed>
          <Text>{d.companyName} · Bowron receiving report</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export const renderReceivingReport = (d: ReceivingReportData) => renderToBuffer(<Report d={d} />);
