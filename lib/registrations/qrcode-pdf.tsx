import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, marginBottom: 4, textAlign: "center" },
  subtitle: { fontSize: 11, color: "#555", marginBottom: 24, textAlign: "center" },
  qrImage: { width: 260, height: 260 },
  footer: { fontSize: 10, color: "#888", marginTop: 24, textAlign: "center" },
});

export interface RegistrationQrCodePdfParams {
  athleteName: string;
  eventTitle: string;
  bibNumber: string | null;
  /** PNG do QR já gerado por generateKitQrCodePng, em base64 — mesmo token/imagem usados em
   * qualquer outro lugar da plataforma (retirada de kit, WhatsApp de confirmação), nunca um
   * identificador paralelo. */
  qrPngBase64: string;
}

/** PDF com o QR code da inscrição centralizado, identificação suficiente (nome do atleta, evento,
 * número de peito quando houver) e tamanho A5 — compacto o bastante pra imprimir várias por
 * página, grande o bastante pro QR continuar legível por leitor/celular. */
export async function generateRegistrationQrCodePdf(params: RegistrationQrCodePdfParams): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A5" style={styles.page}>
        <View>
          <Text style={styles.title}>{params.athleteName}</Text>
          <Text style={styles.subtitle}>
            {params.eventTitle}
            {params.bibNumber ? ` · Peito ${params.bibNumber}` : ""}
          </Text>
        </View>
        <Image style={styles.qrImage} src={`data:image/png;base64,${params.qrPngBase64}`} />
        <Text style={styles.footer}>Apresente este QR code na retirada do kit</Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}
