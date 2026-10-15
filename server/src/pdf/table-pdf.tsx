import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

// Any list as a printable PDF: logo, title, the columns you see on screen.

export interface TablePdfData {
  title: string;
  subtitle: string | null;
  companyName: string | null;
  companyCode: string | null;
  themeColor: string;
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
  columns: { key: string; label: string; align?: 'left' | 'right'; width?: number }[];
  rows: Record<string, string | number | null>[];
}

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8, fontFamily: 'Helvetica', color: '#111111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 },
  logo: { height: 28, maxWidth: 120, objectFit: 'contain' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  muted: { color: '#555555' },
  head: { flexDirection: 'row', borderBottom: '1pt solid #111111', paddingBottom: 3, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #dddddd', paddingVertical: 2.5 },
  footer: { position: 'absolute', bottom: 12, left: 24, right: 24, flexDirection: 'row', justifyContent: 'space-between', color: '#777777', fontSize: 7 },
});

function TableDoc({ d }: { d: TablePdfData }) {
  const total = d.columns.reduce((a, c) => a + (c.width ?? 1), 0);
  const w = (c: TablePdfData['columns'][number]) => `${((c.width ?? 1) / total) * 100}%`;
  const landscape = d.columns.length > 6;
  const printed = new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Document title={d.title} author={d.companyName ?? 'Bowron'} creator="Bowron">
      <Page size="LETTER" orientation={landscape ? 'landscape' : 'portrait'} style={s.page}>
        <View style={s.header} fixed>
          <View>
            {d.logo ? <Image src={d.logo} style={s.logo} /> : d.companyCode ? <Text style={[s.title, { color: d.themeColor }]}>{d.companyCode}</Text> : null}
            <Text style={[s.title, { marginTop: 4 }]}>{d.title}</Text>
            {d.subtitle && <Text style={s.muted}>{d.subtitle}</Text>}
          </View>
          <Text style={s.muted}>{d.rows.length} row{d.rows.length === 1 ? '' : 's'}</Text>
        </View>
        <View style={s.head} fixed>
          {d.columns.map((c) => (
            <Text key={c.key} style={{ width: w(c), paddingRight: 4, textAlign: c.align ?? 'left' }}>
              {c.label}
            </Text>
          ))}
        </View>
        {d.rows.map((r, i) => (
          <View key={i} style={s.row} wrap={false}>
            {d.columns.map((c) => (
              <Text key={c.key} style={{ width: w(c), paddingRight: 4, textAlign: c.align ?? 'left' }}>
                {r[c.key] == null ? '' : String(r[c.key])}
              </Text>
            ))}
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>
            {d.companyName ? `${d.companyName} · ` : ''}Printed {printed}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderTablePdf(d: TablePdfData): Promise<Buffer> {
  return renderToBuffer(<TableDoc d={d} />);
}
