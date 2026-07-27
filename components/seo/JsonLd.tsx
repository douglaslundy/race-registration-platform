export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  // Escapa "<" pra nunca permitir que o JSON quebre pra fora da tag <script> (ex: um
  // description de evento contendo literalmente "</script>").
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
