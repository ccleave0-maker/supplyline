import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { formatQty } from '@supplyline/core/domain';

/** What the QR code on every BOL says. The app reads this to open the BOL for receiving. */
export const bolQrPayload = (bolId: string, bolNumber: number | null) => `SUPPLYLINE-BOL:${bolId}:${bolNumber ?? ''}`;

export function parseBolQr(text: string): { bolId: string; bolNumber: number | null } | null {
  const m = /^SUPPLYLINE-BOL:([a-z0-9]+):(\d*)$/i.exec(text.trim());
  return m ? { bolId: m[1]!, bolNumber: m[2] ? Number(m[2]) : null } : null;
}

export interface BolPdfData {
  bolId: string;
  bolNumber: number | null;
  direction: 'OUTBOUND' | 'RETURN';
  companyName: string;
  companyCode: string;
  themeColor: string;
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
  issuedAt: Date | null;
  scheduledDate: string | null;
  carrier: { name: string; phone: string | null } | null;
  driverName: string | null;
  truckUnit: string | null;
  trailer?: string | null;
  /** Estimated from the lines' unit weights */
  weightKg?: number | null;
  notes: string | null;
  stops: {
    seq: number;
    kind: 'PICKUP' | 'DROP';
    label: string; // "Pickup 1" / "Delivery 2"
    /** Planned date (+ time) at this stop */
    when: string | null;
    name: string;
    address: string | null;
    phone: string | null;
    lines: { lineNo: number; orderLabel: string | null; orderLineNo: number | null; poNumber: string | null; description: string; qty: number; uom: string; job?: string | null }[];
  }[];
}

const s = StyleSheet.create({
  page: { padding: 30, fontSize: 9, fontFamily: 'Helvetica', color: '#111111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  logo: { height: 38, maxWidth: 150, objectFit: 'contain' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  big: { fontSize: 22, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555555' },
  meta: { flexDirection: 'row', flexWrap: 'wrap', borderTop: '1pt solid #bbbbbb', borderBottom: '1pt solid #bbbbbb', paddingVertical: 5, marginBottom: 10 },
  metaItem: { width: '33%', paddingVertical: 2 },
  stop: { marginBottom: 10, border: '1pt solid #cccccc', padding: 6 },
  stopHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  stopTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  head: { flexDirection: 'row', borderBottom: '1pt solid #111111', paddingBottom: 3, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #dddddd', paddingVertical: 3 },
  cN: { width: '5%' },
  cOrder: { width: '24%' },
  cPo: { width: '13%' },
  cDesc: { width: '40%', paddingRight: 4 },
  cQty: { width: '10%', textAlign: 'right', paddingRight: 4 },
  cUom: { width: '8%' },
  sigs: { flexDirection: 'row', marginTop: 6 },
  sig: { flex: 1, marginRight: 8 },
  sigLine: { borderBottom: '0.8pt solid #333333', height: 18, marginBottom: 2 },
  footer: { position: 'absolute', bottom: 16, left: 30, right: 30, flexDirection: 'row', justifyContent: 'space-between', color: '#777777', fontSize: 8 },
});

function Sig({ who }: { who: string }) {
  return (
    <View style={s.sig}>
      <View style={s.sigLine} />
      <Text style={s.muted}>{who}: name, signature, date / time</Text>
    </View>
  );
}

function BolDoc({ d, qr }: { d: BolPdfData; qr: Buffer }) {
  const title = d.direction === 'RETURN' ? 'RETURN BILL OF LADING' : 'BILL OF LADING';
  const number = d.bolNumber != null ? `BOL #${d.bolNumber}` : 'DRAFT – NOT ISSUED';
  return (
    <Document title={`${number} – ${d.companyName}`} author={d.companyName} creator="SupplyLine">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {d.logo ? <Image src={d.logo} style={s.logo} /> : <Text style={[s.title, { color: d.themeColor }]}>{d.companyCode}</Text>}
            <Text style={{ marginTop: 3 }}>{d.companyName}</Text>
            <Text style={[s.title, { marginTop: 8 }]}>{title}</Text>
            <Text style={s.big}>{number}</Text>
          </View>
          <View style={{ alignItems: 'center' }}>
            <Image src={{ data: qr, format: 'png' }} style={{ width: 92, height: 92 }} />
            <Text style={[s.muted, { fontSize: 7 }]}>Scan in SupplyLine to receive</Text>
          </View>
        </View>

        <View style={s.meta}>
          <Text style={s.metaItem}>Date: {(d.issuedAt ?? new Date()).toLocaleDateString('en-CA')}</Text>
          <Text style={s.metaItem}>Ship date: {d.scheduledDate ?? '—'}</Text>
          <Text style={s.metaItem}>Stops: {d.stops.length}</Text>
          <Text style={s.metaItem}>Carrier: {d.carrier ? d.carrier.name : '—'}</Text>
          <Text style={s.metaItem}>Carrier phone: {d.carrier?.phone ?? '—'}</Text>
          <Text style={s.metaItem}>Driver / truck: {[d.driverName, d.truckUnit].filter(Boolean).join(' / ') || '—'}</Text>
          {d.trailer ? <Text style={s.metaItem}>Trailer: {d.trailer}</Text> : null}
          {d.weightKg ? <Text style={s.metaItem}>Est. weight: {d.weightKg.toLocaleString('en-CA')} kg ({Math.round(d.weightKg / 0.45359237).toLocaleString('en-CA')} lb)</Text> : null}
        </View>

        {d.stops.map((st) => (
          <View key={st.seq} style={s.stop} wrap={false}>
            <View style={s.stopHead}>
              <Text style={s.stopTitle}>
                {st.label}: {st.name}
                {st.when ? `  —  ${st.kind === 'PICKUP' ? 'Pickup' : 'Delivery'} ${st.when}` : ''}
              </Text>
              <Text style={s.muted}>{[st.address, st.phone].filter(Boolean).join('  ·  ')}</Text>
            </View>
            {st.lines.length > 0 ? (
              <>
                <View style={s.head}>
                  <Text style={s.cN}>#</Text>
                  <Text style={s.cOrder}>Order / L#</Text>
                  <Text style={s.cPo}>PO #</Text>
                  <Text style={s.cDesc}>Description</Text>
                  <Text style={s.cQty}>Qty</Text>
                  <Text style={s.cUom}>Unit</Text>
                </View>
                {st.lines.map((l, i) => (
                  <View key={l.lineNo}>
                    {/* Milk runs: a heading for each job's section */}
                    {l.job && l.job !== st.lines[i - 1]?.job && new Set(st.lines.map((x) => x.job)).size > 1 && <Text style={[s.muted, { marginTop: 4, fontFamily: 'Helvetica-Bold' }]}>{l.job}</Text>}
                  <View style={s.row}>
                    <Text style={s.cN}>{l.lineNo}</Text>
                    <Text style={s.cOrder}>
                      {l.orderLabel ? `${l.orderLabel} L${l.orderLineNo}` : 'Added item'}
                    </Text>
                    <Text style={s.cPo}>{l.poNumber ?? ''}</Text>
                    <Text style={s.cDesc}>{l.description}</Text>
                    <Text style={s.cQty}>{formatQty(l.qty)}</Text>
                    <Text style={s.cUom}>{l.uom}</Text>
                  </View>
                  </View>
                ))}
              </>
            ) : (
              <Text style={s.muted}>No items at this stop.</Text>
            )}
            <View style={s.sigs}>
              {st.kind === 'PICKUP' ? (
                <>
                  <Sig who="Shipper" />
                  <Sig who="Carrier" />
                </>
              ) : (
                <>
                  <Sig who="Carrier" />
                  <Sig who="Received by" />
                </>
              )}
            </View>
          </View>
        ))}

        {d.notes ? (
          <View>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>Notes</Text>
            <Text>{d.notes}</Text>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text>{number}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderBolPdf(d: BolPdfData): Promise<Buffer> {
  const qr = await QRCode.toBuffer(bolQrPayload(d.bolId, d.bolNumber), { type: 'png', margin: 1, width: 360, errorCorrectionLevel: 'M' });
  return renderToBuffer(<BolDoc d={d} qr={qr} />);
}
