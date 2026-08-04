/**
 * Sincroniza a tabela MessageTemplate com o registry (lib/templates/registry.ts), em dois passos:
 *
 * 1. CRIA as linhas GLOBAL que ainda não existem — alertKeys/canais/papéis novos, introduzidos no
 *    código depois que o seed original rodou. Sem isso, um alerta novo fica sem linha no banco e a
 *    tela /admin/alertas não consegue oferecer "Editar"/"Personalizar" pra ele (os dois links
 *    dependem de um id de template), mesmo o alerta enviando normalmente via texto de fábrica.
 * 2. RE-SINCRONIZA os templates que NUNCA foram customizados por um admin (zero linhas em
 *    MessageTemplateVersion) com o texto de fábrica atual do registry.
 *
 * Os dois passos são idempotentes: o seed pula qualquer combinação que já tenha linha, e o refresh
 * nunca sobrescreve um template que um admin já editou (versão > 0).
 *
 * Necessário sempre que um `factoryDefault` mudar no código (correção de texto, novo conteúdo)
 * DEPOIS que o seed original já rodou em produção — sem isso, a linha antiga no banco continua
 * tendo prioridade sobre o registry (lib/templates/resolve.ts), e a mudança de código nunca chega
 * aos usuários finais. Nunca sobrescreve um template que um admin já editou (versão > 0).
 *
 * Uso (rodar direto no container de produção, mesmo padrão do seed original — ver
 * IMPLEMENTATION_PLAN.md/PROGRESSO.md pro procedimento completo com tsconfig-paths):
 *   npx ts-node --compiler-options {"module":"CommonJS"} prisma/refresh-templates.ts
 *
 * Propositalmente NÃO usa prisma/seed.ts inteiro — aquele script também cria contas de
 * demonstração (admin/organizador com senha padrão), o que nunca deve rodar em produção.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const { seedMessageTemplatesFromRegistry, refreshUnmodifiedTemplatesFromRegistry } = await import(
    "../lib/templates/seed"
  );
  // Seed ANTES do refresh: cria as linhas que faltam (alertKeys novos) pra que o refresh logo em
  // seguida já as considere. Ordem inversa deixaria o alerta novo sem linha até o próximo deploy.
  const seeded = await seedMessageTemplatesFromRegistry();
  const refreshed = await refreshUnmodifiedTemplatesFromRegistry();
  console.log(
    `Templates novos: ${seeded.created} criados, ${seeded.skipped} pulados (já existiam). ` +
      `Templates re-sincronizados: ${refreshed.refreshed} atualizados, ${refreshed.skipped} pulados (customizados ou já em dia).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
