/**
 * Re-sincroniza os templates de mensagem que NUNCA foram customizados por um admin (zero linhas em
 * MessageTemplateVersion) com o texto de fábrica atual do registry (lib/templates/registry.ts).
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
  const { refreshUnmodifiedTemplatesFromRegistry } = await import("../lib/templates/seed");
  const result = await refreshUnmodifiedTemplatesFromRegistry();
  console.log(`Templates re-sincronizados: ${result.refreshed} atualizados, ${result.skipped} pulados (customizados ou já em dia).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
