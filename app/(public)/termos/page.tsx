import type { Metadata } from "next";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function TermosPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-2">Termos de Uso</h1>
      <p className="text-sm text-gray-500 mb-8">Última atualização: maio de 2025</p>

      <div className="prose prose-gray max-w-none space-y-6 text-gray-700">
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">1. Aceitação dos termos</h2>
          <p>Ao utilizar a plataforma Corridas App, você concorda com estes Termos de Uso. Se não concordar, não utilize nossos serviços.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">2. Descrição do serviço</h2>
          <p>A Corridas App é uma plataforma intermediadora de inscrições para eventos esportivos. Não somos organizadores dos eventos listados e não nos responsabilizamos pela realização, cancelamento ou alteração dos eventos pelos organizadores.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">3. Responsabilidade do atleta</h2>
          <p>O atleta declara estar em condições físicas adequadas para participar do evento e isenta a plataforma de responsabilidade por acidentes durante o evento.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">4. Pagamentos e reembolsos</h2>
          <p>Os pagamentos são processados por provedores terceiros. A política de reembolso é definida por cada organizador de evento. Consulte as condições específicas de cada evento antes de se inscrever.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">5. Taxas da plataforma</h2>
          <p>A Corridas App cobra uma taxa de serviço sobre o valor da inscrição, conforme exibido no momento do checkout.</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">6. Alterações nos termos</h2>
          <p>Podemos atualizar estes termos a qualquer momento. O uso continuado da plataforma após as alterações implica aceitação dos novos termos.</p>
        </section>

        <p className="text-sm text-gray-500 mt-8 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
          <strong>Nota:</strong> Este é um conteúdo placeholder. O texto final deve ser elaborado com assessoria jurídica.
        </p>
      </div>
    </main>
  );
}
