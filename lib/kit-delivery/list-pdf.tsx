import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

/**
 * PDF da aba "Todos os inscritos" da entrega de kits — a lista já filtrada e ordenada no cliente,
 * pronta pra abrir no navegador e mandar pra impressora. Gerado pela rota
 * `/api/events/[id]/kit-deliveries/list/pdf`.
 */

export interface KitDeliveryListPdfItem {
  participantName: string;
  participantCpf: string | null;
  bibNumber: string | null;
  shirtSize: string | null;
  categoryName: string | null;
  delivered: boolean;
  deliveredAt: Date | null;
  deliveredByName: string | null;
  receivedByName: string | null;
}

export interface KitDeliveryListPdfParams {
  eventTitle: string;
  filtersLabel: string;
  generatedAt: Date;
  deliveredCount: number;
  pendingCount: number;
  items: KitDeliveryListPdfItem[];
}

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
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#ddd",
    paddingVertical: 3,
  },
  cell: { paddingRight: 4 },
  empty: { marginTop: 16, color: "#777" },
});

const COLS = [
  { key: "name", label: "Nome", width: "18%" },
  { key: "cpf", label: "CPF", width: "10%" },
  { key: "category", label: "Categoria", width: "12%" },
  { key: "shirt", label: "Camiseta", width: "7%" },
  { key: "bib", label: "Peito", width: "6%" },
  { key: "status", label: "Status", width: "8%" },
  { key: "deliveredAt", label: "Entregue em", width: "13%" },
  { key: "assistant", label: "Assistente", width: "13%" },
  { key: "receivedBy", label: "Retirado por", width: "13%" },
] as const;

function formatDateTime(value: Date | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export async function generateKitDeliveryListPdf(params: KitDeliveryListPdfParams): Promise<Buffer> {
  const { eventTitle, filtersLabel, generatedAt, deliveredCount, pendingCount, items } = params;

  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>Entrega de kits — {eventTitle}</Text>
        <Text style={styles.meta}>Filtros: {filtersLabel}</Text>
        <Text style={styles.meta}>
          {deliveredCount + pendingCount} inscrito(s) na lista · {deliveredCount} entregue(s) ·{" "}
          {pendingCount} pendente(s)
        </Text>
        <Text style={styles.meta}>Gerado em {generatedAt.toLocaleString("pt-BR")}</Text>

        <View style={styles.headerRow} fixed>
          {COLS.map((c) => (
            <Text key={c.key} style={[styles.cell, { width: c.width }]}>
              {c.label}
            </Text>
          ))}
        </View>

        {items.length === 0 ? (
          <Text style={styles.empty}>Nenhum inscrito para os filtros selecionados.</Text>
        ) : (
          items.map((i, idx) => (
            <View key={idx} style={styles.row} wrap={false}>
              <Text style={[styles.cell, { width: COLS[0].width }]}>{i.participantName}</Text>
              <Text style={[styles.cell, { width: COLS[1].width }]}>{i.participantCpf ?? "—"}</Text>
              <Text style={[styles.cell, { width: COLS[2].width }]}>{i.categoryName ?? "—"}</Text>
              <Text style={[styles.cell, { width: COLS[3].width }]}>{i.shirtSize ?? "—"}</Text>
              <Text style={[styles.cell, { width: COLS[4].width }]}>{i.bibNumber ?? "—"}</Text>
              <Text style={[styles.cell, { width: COLS[5].width }]}>
                {i.delivered ? "Entregue" : "Pendente"}
              </Text>
              <Text style={[styles.cell, { width: COLS[6].width }]}>{formatDateTime(i.deliveredAt)}</Text>
              <Text style={[styles.cell, { width: COLS[7].width }]}>{i.deliveredByName ?? "—"}</Text>
              <Text style={[styles.cell, { width: COLS[8].width }]}>{i.receivedByName ?? "—"}</Text>
            </View>
          ))
        )}
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
