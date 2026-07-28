import type { Metadata } from "next";

export const metadata: Metadata = { title: "Solicitação enviada" };

export default function SolicitacaoEnviadaPage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center space-y-4">
      <h1 className="text-2xl font-bold">Solicitação enviada!</h1>
      <p className="text-gray-600 dark:text-gray-400">
        Recebemos sua solicitação e seu pagamento está sendo processado. Assim que confirmarmos o
        pagamento, sua solicitação entra em análise — você recebe um e-mail assim que for aprovada
        ou rejeitada.
      </p>
    </div>
  );
}
