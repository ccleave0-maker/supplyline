import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

// Meeting minutes: who was there, each step's notes, checklist ticks, action items, summary.

export interface MeetingPdfData {
  title: string;
  companyName: string;
  companyCode: string;
  themeColor: string;
  logo: { data: Buffer; format: 'png' | 'jpg' } | null;
  jobLabel: string | null;
  when: string;
  attendees: { name: string; present: boolean }[];
  steps: { title: string; notes: string; items: string[]; checked: string[]; kind: string }[];
  actions: { text: string; who: string; due: string; status: string }[];
  summary: string | null;
  qr: Buffer | null;
}

const s = StyleSheet.create({
  page: { padding: 32, fontSize: 9.5, fontFamily: 'Helvetica', color: '#111111' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  logo: { height: 30, maxWidth: 130, objectFit: 'contain' },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginTop: 4 },
  muted: { color: '#555555' },
  h: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 12, marginBottom: 4, borderBottom: '0.5pt solid #bbbbbb', paddingBottom: 2 },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #dddddd', paddingVertical: 3 },
  qr: { width: 56, height: 56 },
  footer: { position: 'absolute', bottom: 14, left: 32, right: 32, flexDirection: 'row', justifyContent: 'space-between', color: '#777777', fontSize: 7 },
});

function MeetingDoc({ d }: { d: MeetingPdfData }) {
  const present = d.attendees.filter((a) => a.present).map((a) => a.name);
  const absent = d.attendees.filter((a) => !a.present).map((a) => a.name);
  return (
    <Document title={`Minutes – ${d.title}`} author={d.companyName} creator="Bowron">
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <View>
            {d.logo ? <Image src={d.logo} style={s.logo} /> : <Text style={[s.title, { color: d.themeColor }]}>{d.companyCode}</Text>}
            <Text style={s.title}>Minutes – {d.title}</Text>
            <Text style={s.muted}>
              {[d.jobLabel, d.when].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {d.qr ? <Image src={d.qr} style={s.qr} /> : null}
        </View>
        <Text>
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>Present: </Text>
          {present.join(', ') || '—'}
        </Text>
        {absent.length > 0 && (
          <Text>
            <Text style={{ fontFamily: 'Helvetica-Bold' }}>Absent: </Text>
            {absent.join(', ')}
          </Text>
        )}
        {d.summary ? (
          <>
            <Text style={s.h}>Summary</Text>
            <Text>{d.summary}</Text>
          </>
        ) : null}
        {d.steps.map((st, i) => (
          <View key={i} wrap>
            <Text style={s.h}>
              {i + 1}. {st.title}
            </Text>
            {st.kind === 'CHECKLIST' &&
              st.items.map((it) => (
                <Text key={it}>
                  {st.checked.includes(it) ? '[x]' : '[ ]'} {it}
                </Text>
              ))}
            {st.notes ? <Text>{st.notes}</Text> : st.kind !== 'CHECKLIST' ? <Text style={s.muted}>No notes.</Text> : null}
          </View>
        ))}
        <Text style={s.h}>Action items</Text>
        {d.actions.length === 0 ? (
          <Text style={s.muted}>None.</Text>
        ) : (
          <>
            <View style={[s.row, { fontFamily: 'Helvetica-Bold' }]}>
              <Text style={{ width: '58%' }}>What</Text>
              <Text style={{ width: '22%' }}>Who</Text>
              <Text style={{ width: '12%' }}>Due</Text>
              <Text style={{ width: '8%' }}>Status</Text>
            </View>
            {d.actions.map((a, i) => (
              <View key={i} style={s.row} wrap={false}>
                <Text style={{ width: '58%', paddingRight: 4 }}>{a.text}</Text>
                <Text style={{ width: '22%', paddingRight: 4 }}>{a.who}</Text>
                <Text style={{ width: '12%' }}>{a.due}</Text>
                <Text style={{ width: '8%' }}>{a.status}</Text>
              </View>
            ))}
          </>
        )}
        <View style={s.footer} fixed>
          <Text>{d.companyName} · Bowron</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export const renderMeetingPdf = (d: MeetingPdfData) => renderToBuffer(<MeetingDoc d={d} />);
