import type { Metadata } from "next";
import { getAppName } from "@/lib/settings";

export const metadata: Metadata = { title: "Política de Privacidade" };
export const dynamic = "force-dynamic";

export default async function PrivacidadePage() {
  const appName = await getAppName();

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">Política de Privacidade</h1>
      <p className="text-sm text-gray-500 mb-8">Última atualização: maio de 2025</p>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700 dark:text-gray-300">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">1. Dados coletados</h2>
          <p>A plataforma <strong>{appName}</strong> coleta os seguintes dados para prestação do serviço: nome, e-mail, CPF, data de nascimento, telefone, endereço e dados de saúde quando necessário para a inscrição no evento.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">2. Finalidade do tratamento</h2>
          <p>Os dados são utilizados exclusivamente para: processamento de inscrições, comunicações relacionadas aos eventos, cumprimento de obrigações legais e melhoria dos nossos serviços.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">3. Compartilhamento de dados</h2>
          <p>Seus dados são compartilhados com o organizador do evento no qual você se inscreveu e com provedores de pagamento para processamento da transação. A <strong>{appName}</strong> não vende seus dados a terceiros.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">4. Seus direitos (LGPD)</h2>
          <p>Você tem direito a: acessar seus dados, corrigi-los, solicitar a exclusão, revogar consentimento e solicitar portabilidade. Entre em contato conosco para exercer esses direitos.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">5. Retenção de dados</h2>
          <p>Mantemos seus dados pelo período necessário para a prestação do serviço e cumprimento de obrigações legais (mínimo 5 anos para registros financeiros).</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">6. Segurança</h2>
          <p>A <strong>{appName}</strong> adota medidas técnicas e organizacionais para proteger seus dados, incluindo criptografia, controle de acesso e backups regulares.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">7. Contato</h2>
          <p>Para questões sobre privacidade, entre em contato através dos canais disponíveis na plataforma.</p>
        </section>

        <p className="text-sm text-gray-500 mt-8 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
          <strong>Nota:</strong> Este é um conteúdo placeholder. O texto final deve ser elaborado com assessoria jurídica especializada em LGPD.
        </p>
      </div>
    </main>
  );
}
