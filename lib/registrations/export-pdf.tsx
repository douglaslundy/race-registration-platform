import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

/** PDF resumido dos inscritos do evento (rota `/api/events/[id]/registrations/pdf`). As linhas
 * vêm de `buildRegistrationExportRows` — mesmas colunas/ordem do CSV/XLSX, filtradas aqui. */

const COLS = [
  { index: 0, label: "Peito", width: "6%" },
  { index: 1, label: "Nome", width: "21%" },
  { index: 2, label: "Nascimento", width: "10%" },
  { index: 3, label: "Idade", width: "5%" },
  { index: 4, label: "Sexo", width: "8%" },
  { index: 7, label: "Cidade", width: "13%" },
  { index: 5, label: "Equipe", width: "12%" },
  { index: 13, label: "Camiseta", width: "8%" },
  { index: 11, label: "Lote", width: "10%" },
  { index: 12, label: "Valor pago", width: "10%" },
] as const;

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica" },
  title: { fontSize: 14, marginBottom: 2 },
  meta: { fontSize: 8, color: "#555", marginBottom: 1 },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderColor: "#333",
    paddingBottom: 3,
    marginTop: 10,
    fontFamily: "Helvetica-Bold",
  },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#ddd", paddingVertical: 3 },
  cell: { paddingRight: 4 },
  empty: { marginTop: 16, color: "#777" },
});

export async function generateRegistrationsPdf(params: {
  eventTitle: string;
  generatedAt: Date;
  rows: string[][];
}): Promise<Buffer> {
  const { eventTitle, generatedAt, rows } = params;
  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>Inscritos — {eventTitle}</Text>
        <Text style={styles.meta}>
          {rows.length} inscrito(s) · Gerado em {generatedAt.toLocaleString("pt-BR")}
        </Text>
        <View style={styles.headerRow} fixed>
          {COLS.map((c) => (
            <Text key={c.label} style={[styles.cell, { width: c.width }]}>
              {c.label}
            </Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <Text style={styles.empty}>Nenhum inscrito para os filtros selecionados.</Text>
        ) : (
          rows.map((row, idx) => (
            <View key={idx} style={styles.row} wrap={false}>
              {COLS.map((c) => (
                <Text key={c.label} style={[styles.cell, { width: c.width }]}>
                  {row[c.index] || "—"}
                </Text>
              ))}
            </View>
          ))
        )}
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
