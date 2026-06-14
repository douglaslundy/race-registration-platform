import Link from "next/link";

const STEPS = [
  {
    num: "1",
    title: "Crie sua conta",
    desc: "Cadastre-se gratuitamente como organizador e acesse o painel em minutos.",
  },
  {
    num: "2",
    title: "Configure o evento",
    desc: "Adicione percursos, categorias, lotes de inscrição, regulamento e fotos.",
  },
  {
    num: "3",
    title: "Publique e divulgue",
    desc: "Com um clique seu evento fica visível para milhares de atletas na plataforma.",
  },
  {
    num: "4",
    title: "Gerencie tudo online",
    desc: "Acompanhe inscrições, pagamentos e liste os atletas em tempo real.",
  },
];

const FEATURES = [
  {
    icon: "🏷️",
    title: "Lotes de inscrição",
    desc: "Crie quantos lotes quiser com preços, datas e capacidades independentes.",
  },
  {
    icon: "💳",
    title: "Pagamento integrado",
    desc: "Pix, cartão de crédito e boleto. Os atletas pagam direto na plataforma.",
  },
  {
    icon: "📋",
    title: "Relatórios completos",
    desc: "Exporte lista de inscritos, tamanhos de camiseta e dados de contato.",
  },
  {
    icon: "🎟️",
    title: "Cupons de desconto",
    desc: "Crie cupons percentuais ou de valor fixo para patrocinadores e parceiros.",
  },
  {
    icon: "🗺️",
    title: "Percursos e categorias",
    desc: "Configure múltiplos percursos por distância e categorias por perfil de atleta.",
  },
  {
    icon: "📱",
    title: "100% responsivo",
    desc: "Atletas se inscrevem pelo celular com a mesma facilidade do computador.",
  },
];

export default function OrganizerCTA({ appName }: { appName: string }) {
  return (
    <section className="bg-gray-950 text-white">
      {/* Hero */}
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <span className="inline-block text-xs font-semibold uppercase tracking-widest text-primary-400 bg-primary-900/40 border border-primary-700/50 rounded-full px-4 py-1 mb-5">
          Para organizadores
        </span>
        <h2 className="text-3xl md:text-4xl font-extrabold text-white mb-4 leading-tight">
          Leve seu evento para o<br className="hidden md:block" /> próximo nível
        </h2>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-10">
          A {appName} oferece tudo que você precisa para criar, divulgar e gerenciar
          eventos esportivos de forma simples, rápida e profissional.
        </p>
        <Link
          href="/auth/cadastro"
          className="inline-block bg-primary-600 hover:bg-primary-500 text-white font-bold px-8 py-3 rounded-lg text-base transition-colors"
        >
          Criar conta de organizador
        </Link>
      </div>

      {/* Como funciona */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-14">
          <h3 className="text-xl font-bold text-center text-white mb-10">Como funciona</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map((step) => (
              <div key={step.num} className="relative text-center">
                <div className="w-11 h-11 rounded-full bg-primary-600 text-white font-extrabold text-lg flex items-center justify-center mx-auto mb-4">
                  {step.num}
                </div>
                <h4 className="font-semibold text-white mb-2">{step.title}</h4>
                <p className="text-gray-400 text-sm leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recursos */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-14">
          <h3 className="text-xl font-bold text-center text-white mb-10">O que você tem acesso</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex gap-4"
              >
                <span className="text-2xl leading-none mt-0.5">{f.icon}</span>
                <div>
                  <p className="font-semibold text-white mb-1">{f.title}</p>
                  <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA final */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-14 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <p className="text-xl font-bold text-white mb-1">Pronto para começar?</p>
            <p className="text-gray-400 text-sm">
              Cadastre-se agora e publique seu primeiro evento gratuitamente.
            </p>
          </div>
          <Link
            href="/auth/cadastro"
            className="shrink-0 inline-block bg-primary-600 hover:bg-primary-500 text-white font-bold px-8 py-3 rounded-lg text-base transition-colors"
          >
            Começar agora
          </Link>
        </div>
      </div>
    </section>
  );
}
