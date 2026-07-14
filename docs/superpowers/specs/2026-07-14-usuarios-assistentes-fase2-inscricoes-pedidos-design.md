# Usuários Assistentes — Fase 2, domínio 2: Inscrições/Pedidos — Design

## Contexto

Segundo domínio da Fase 2 (rollout sequencial do sistema de usuários assistentes construído na
Fase 1 — infraestrutura pronta, revisada, ainda não deployada — e já aplicado ao domínio Eventos
na Fase 1 e Lotes/Categorias/Percursos na Fase 2 domínio 1, ambos também não deployados ainda).

Este domínio cobre as 11 ações do catálogo (`docs/superpowers/specs/2026-07-14-analise-acoes-
sistema.md`, seção 4) relacionadas a inscrições e pedidos: decidir cancelamento, confirmar
inscrição manualmente, editar dados do atleta, reenviar e-mail de confirmação, reenviar
notificação de erro de pagamento, expirar pagamentos pendentes, ver/exportar inscritos.

## Achados da leitura do código real (corrigem/refinam premissas da análise inicial)

Diferente do domínio anterior (Lotes/Categorias/Percursos), aqui:

1. **`GET app/api/events/[id]/registrations/route.ts` não é público** — exige sessão
   (`role` em `["ORGANIZER", "ADMIN"]`) e **já tem bypass de admin funcional hoje**:
   `db.event.findFirst({where: {id, ...(role !== "ADMIN" ? {organizerId: organizer?.id} : {})}})`
   — mesmo padrão exato de `batches.create` (Fase 2 domínio 1). Existe, portanto, **uma chave
   `.view` de verdade neste domínio**, ao contrário de Lotes/Categorias/Percursos.

2. **5 das 6 rotas de organizador** (`cancellation-decision`, `manual-confirm`,
   `resend-confirmation-email`, `resend-payment-notification`, `expire-payments`) aceitam
   `ADMIN` no *role check* (`session.user.role !== "ORGANIZER" && session.user.role !== "ADMIN"`),
   mas o filtro de dados sempre exige `event.organizer.userId === session.user.id` (ou
   equivalente via `organizerUserId` na lib de expiração) — um ADMIN real, sem
   `organizerProfile` próprio, **nunca consegue usar essas rotas de fato** apesar de o código
   parecer ter pretendido dar acesso a ele. As 4 rotas admin equivalentes (que existem
   separadamente) já dão acesso total e funcional por outro caminho, sem esse problema.

   **Decisão confirmada com o usuário:** replicar esse comportamento exatamente como está — não
   corrigir o que parece ser um bug de implementação original não solicitado. `ADMIN` continua
   sem acesso funcional pelas 5 rotas organizer (ele já tem acesso pelas 4 rotas admin
   dedicadas).

3. **`PATCH app/api/organizer/registrations/[id]/athlete/route.ts` é a única rota deste domínio
   que EXCLUI `ADMIN` explicitamente** do *role check* (`role !== "ORGANIZER"`, sem aceitar
   `ADMIN`). Não existe rota admin equivalente para editar dados de atleta.

4. **Todas as 11 rotas já têm teste hoje** (diferente do domínio anterior, onde nenhuma das 6
   rotas tinha teste) — o plano de implementação vai **estender** os 11 arquivos de teste
   existentes, não criar do zero. Cada arquivo de teste precisa ser lido antes de editado, pra
   seguir a convenção de mock exata já usada nele (mesma disciplina já usada na Task 3 da Fase 1,
   ao mexer nas 9 rotas de Eventos que já tinham teste).

## Decisões confirmadas com o usuário

- **Bug de "ADMIN aceito mas nunca funcional" nas 5 rotas organizer:** replicado exatamente como
  está — `checkApiPermission` continua aceitando `ADMIN`/`ORGANIZER` titular, mas a resolução do
  registro sempre usa `scope.organizerId ?? "__none__"`, nunca `scope.actingAsAdmin`, reproduzindo
  fielmente a ausência de acesso funcional pra ADMIN nessas 5 rotas específicas.
- **Nomenclatura de chaves:** rotas admin e organizador que fazem a mesma operação de negócio
  (ex.: decidir cancelamento) mas são arquivos de rota fisicamente separados ganham **chaves
  separadas**, com sufixo `-any` do lado admin (indicando "qualquer evento/inscrição", sem
  escopo) — ao invés de uma única chave compartilhada. Isso difere do padrão de `events.edit`
  (Fase 1), que era um único arquivo de rota servindo os dois papéis; aqui, com dois arquivos
  físicos distintos, chaves separadas evitam ambiguidade sobre o que cada uma realmente concede.

## Chaves de permissão

| Chave | Rota | Escopo | Bypass de admin? |
|---|---|---|---|
| `registrations.view` | `GET app/api/events/[id]/registrations/route.ts` | Compartilhado (mesmo handler pros dois papéis) | Sim (já existe hoje, mesmo padrão de `batches.create`) |
| `registrations.cancellation-decision` | `POST app/api/organizer/registrations/[id]/cancellation-decision/route.ts` | Organizador | Não (replica o "bug" — ADMIN aceito no role check mas nunca funcional aqui) |
| `registrations.cancellation-decision-any` | `POST app/api/admin/registrations/[id]/cancellation-decision/route.ts` | Admin, qualquer inscrição | — (rota é ela mesma sem escopo nenhum, `checkAdminOnlyApiPermission`) |
| `registrations.manual-confirm` | `POST app/api/organizer/registrations/[id]/manual-confirm/route.ts` | Organizador | Não (sem rota admin equivalente) |
| `registrations.edit-athlete` | `PATCH app/api/organizer/registrations/[id]/athlete/route.ts` | Organizador | Não (hoje nem `ADMIN` é aceito no role check) |
| `registrations.resend-confirmation-email` | `POST app/api/organizer/registrations/[id]/resend-confirmation-email/route.ts` | Organizador | Não |
| `registrations.resend-confirmation-email-any` | `POST app/api/admin/registrations/[id]/resend-confirmation-email/route.ts` | Admin, qualquer inscrição | — (`checkAdminOnlyApiPermission`) |
| `registrations.resend-payment-notification` | `POST app/api/organizer/registrations/[id]/resend-payment-notification/route.ts` | Organizador | Não |
| `registrations.resend-payment-notification-any` | `POST app/api/admin/registrations/[id]/resend-payment-notification/route.ts` | Admin, qualquer inscrição | — (`checkAdminOnlyApiPermission`) |
| `registrations.expire-payments` | `POST app/api/organizer/expire-payments/route.ts` | Organizador | Não |
| `registrations.expire-payments-any` | `POST app/api/admin/expire-payments/route.ts` | Admin, plataforma inteira | — (`checkAdminOnlyApiPermission`) |

11 chaves no total: 1 compartilhada (`.view`), 6 exclusivas de organizador, 4 exclusivas de admin.

## Arquitetura

Nenhuma peça de infraestrutura nova — reaproveita 100% do que a Fase 1 já construiu:

- **`GET .../registrations` (view)**: troca `session.user.role !== "ADMIN" ? {organizerId} : {}`
  (resolução manual de `organizerProfile`) por `checkApiPermission("registrations.view")` +
  `resolveActingScope(session)`, com a resolução do evento usando
  `scope.actingAsAdmin ? db.event.findUnique(...) : db.event.findFirst({...organizerId: scope.organizerId ?? "__none__"})`
  — mesmo padrão exato de `batches.create` na Fase 2 domínio 1.
- **As 4 rotas admin** (`cancellation-decision`, `resend-confirmation-email`,
  `resend-payment-notification`, `expire-payments`, todas com sufixo `-any`) trocam
  `session.user.role !== "ADMIN"` por `checkAdminOnlyApiPermission("registrations.<ação>-any")`
  — nenhuma delas tem filtro de escopo hoje (bypass total já é o comportamento atual), então não
  há resolução de evento/organizador a ajustar, só a checagem de permissão na entrada da rota.
- **As 6 rotas organizador** trocam a checagem manual de papel por
  `checkApiPermission("registrations.<ação>")` + `resolveActingScope(session)`, com a resolução
  do registro/evento sempre usando `scope.organizerId ?? "__none__"` (nunca
  `scope.actingAsAdmin`), preservando a ausência de bypass funcional pra `ADMIN` que essas rotas
  já têm hoje.
- **`decideRegistrationCancellation`** (serviço compartilhado por `cancellation-decision` e
  `cancellation-decision-any`) recebe um `where` do Prisma já montado pela rota chamadora — não
  precisa de nenhuma mudança, cada rota continua montando seu próprio `where` (com ou sem escopo
  de organizador) antes de chamar o serviço.
- **UI**: `app/admin/assistentes/page.tsx` ganha as 5 chaves admin (`registrations.view` +
  as 4 com sufixo `-any`). `app/organizador/assistentes/page.tsx` ganha as 7 chaves organizador
  (`registrations.view` + as 6 sem sufixo).

## Testes

Diferente do domínio anterior, **todas as 11 rotas já têm teste**. O plano estende cada arquivo
de teste existente com os casos novos (organizador titular continua funcionando sem regressão,
assistente com a permissão certa funciona, assistente sem a permissão é barrado com 403; nas 4
rotas admin, admin titular continua funcionando, assistente-de-admin com a permissão funciona,
assistente-de-organizador mesmo com a chave errada concedida por engano é barrado). Cada arquivo
de teste precisa ser lido primeiro pra seguir a convenção de mock exata já usada nele — não
inventar um padrão novo.

## Fora de escopo

- Corrigir o "bug" de `ADMIN` aceito mas nunca funcional nas 5 rotas organizer (decisão
  explícita — replicar como está).
- Dar a `PATCH .../athlete` acesso de `ADMIN` que ela não tem hoje.
- Qualquer outro domínio da Fase 2 (cupons, pagamentos/estornos, resultados, carrinhos
  abandonados, relatórios) — cada um vira seu próprio ciclo spec→plano→implementação→revisão.
- Deploy das Fases 1/2 anteriores (ainda pendente, decisão separada do usuário).
