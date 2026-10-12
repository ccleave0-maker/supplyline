import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

// Equipment QR tags: one per unit, four to a letter page (cut and tape / laminate).
// Scanning a tag in SupplyLine opens the unit (where it is, record a move).

export interface EquipmentTag {
  unitNumber: string;
  description: string;
  detail: string | null;
  companyName: string;
  themeColor: string;
  qr: Buffer;
}

const s = StyleSheet.create({
  page: { padding: 24, fontFamily: 'Helvetica', flexDirection: 'row', flexWrap: 'wrap' },
  tag: { width: '50%', height: '50%', padding: 10 },
  inner: { flex: 1, border: '1.5pt solid #111111', borderRadius: 6, padding: 12, alignItems: 'center', justifyContent: 'space-between' },
  bar: { alignSelf: 'stretch', height: 8, borderRadius: 2, marginBottom: 6 },
  unit: { fontSize: 30, fontFamily: 'Helvetica-Bold' },
  desc: { fontSize: 13, textAlign: 'center' },
  small: { fontSize: 9, color: '#555555', textAlign: 'center' },
});

export async function renderEquipmentTags(tags: EquipmentTag[]): Promise<Buffer> {
  const pages: EquipmentTag[][] = [];
  for (let i = 0; i < tags.length; i += 4) pages.push(tags.slice(i, i + 4));
  return renderToBuffer(
    <Document title="Equipment tags" creator="SupplyLine">
      {pages.map((p, i) => (
        <Page key={i} size="LETTER" style={s.page}>
          {p.map((t) => (
            <View key={t.unitNumber} style={s.tag} wrap={false}>
              <View style={s.inner}>
                <View style={[s.bar, { backgroundColor: t.themeColor }]} />
                <Text style={s.unit}>{t.unitNumber}</Text>
                <Text style={s.desc}>{t.description}</Text>
                {t.detail && <Text style={s.small}>{t.detail}</Text>}
                <Image src={{ data: t.qr, format: 'png' }} style={{ width: 170, height: 170 }} />
                <Text style={s.small}>{t.companyName} · scan in SupplyLine to see or move this unit</Text>
              </View>
            </View>
          ))}
        </Page>
      ))}
    </Document>,
  );
}
