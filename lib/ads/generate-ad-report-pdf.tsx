import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 12 },
  title: { fontSize: 18, marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  label: { color: "#555" },
});

export interface AdReportPdfParams {
  companyName: string;
  adLabel: string;
  periodStart: Date;
  periodEnd: Date;
  impressions: number;
  clicks: number;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

export async function generateAdReportPdf(params: AdReportPdfParams): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Relatório de anúncio</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Empresa</Text>
          <Text>{params.companyName}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Posição</Text>
          <Text>{params.adLabel}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Período</Text>
          <Text>{formatDate(params.periodStart)} a {formatDate(params.periodEnd)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Impressões</Text>
          <Text>{params.impressions.toLocaleString("pt-BR")}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Cliques</Text>
          <Text>{params.clicks.toLocaleString("pt-BR")}</Text>
        </View>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
