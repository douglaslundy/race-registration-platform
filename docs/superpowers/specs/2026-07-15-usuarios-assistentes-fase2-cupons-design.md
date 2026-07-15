# Usuários Assistentes — Fase 2, domínio 3: Cupons — Design

## Contexto

Terceiro domínio da Fase 2 (rollout sequencial do sistema de usuários assistentes construído na
Fase 1 — infraestrutura pronta, revisada, ainda não deployada — e já aplicado a Eventos na Fase 1,
Lotes/Categorias/Percursos na Fase 2 domínio 1, e Inscrições/Pedidos na Fase 2 domínio 2, todos
também não deployados ainda).

Este domínio cobre as ações do catálogo (`docs/superpowers/specs/2026-07-14-analise-acoes-
sistema.md`, seção 3) relacionadas a cupons: criar/editar/excluir cupom (admin e organizador),
listar cupons de um evento, exportar CSV de cupons (admin, plataforma inteira, e organizador, uso
por evento).

## Achados da leitura do código real (corrigem/refinam premissas da análise inicial)

Diferente dos dois domínios anteriores:

1. **As rotas de organizador (`app/api/events/[id]/coupons/**`) não aceitam `ADMIN` de forma
   alguma** — não checam `role`, só ownership do evento (`organizer: { userId: session.user.id }`).
   Diferente do "bug" do domínio de Inscrições (onde o *role check* aceitava `ADMIN` mas a
   resolução de dados nunca dava acesso funcional), aqui não há sequer a tentativa — é
   simplesmente uma família de rotas organizador-only, com uma família de rotas admin totalmente
   separada (`app/api/admin/coupons/**`) cobrindo o caso de admin.

2. **`GET app/api/events/[id]/coupons/route.ts` (listar cupons de um evento) não tem NENHUMA
   autenticação hoje** — nem `session` é checado. Qualquer request anônima que souber o `eventId`
   recebe a lista completa de cupons do evento (código, tipo/valor de desconto, usos). É consumida
   pela página de gestão do organizador (`app/organizador/eventos/[id]/cupons/page.tsx`).
   **Decisão confirmada com o usuário:** corrigir como parte deste domínio — adicionar sessão +
   escopo organizador/admin (mesmo padrão de `registrations.view`/`batches.create`), já que a rota
   precisa ganhar `checkApiPermission` de qualquer forma.

3. **`PATCH`/`DELETE app/api/events/[id]/coupons/[couponId]/route.ts` têm um IDOR real,
   preexistente e não relacionado a assistentes.** Ambas confirmam que o organizador é dono do
   evento `id` da URL, mas depois atualizam/excluem o cupom só por `couponId`, sem checar que esse
   cupom pertence ao evento `id`. Na prática, qualquer organizador dono de pelo menos um evento
   pode editar/excluir qualquer cupom do sistema — inclusive cupom global de admin ou de outro
   organizador — bastando saber o `couponId`. **Decisão confirmada com o usuário:** corrigir junto,
   adicionando `eventId: id` no `where` do Prisma nas duas rotas.

4. **`GET app/api/events/[id]/coupons/report-export/route.ts` já tem bypass de admin funcional
   hoje** (`session.user.role !== "ADMIN" ? {organizerId} : {}`), mesmo padrão exato de
   `registrations.view` — chave compartilhada, sem sufixo, mesma rota física servindo os dois
   papéis.

5. **`GET app/api/events/[id]/coupons/preview/route.ts` não é ação de gestão** — exige apenas
   qualquer sessão autenticada (qualquer papel) e é usada no fluxo de checkout do atleta para
   pré-visualizar o desconto de um cupom antes de finalizar a compra. O catálogo original a listou
   sob "Organizador" por engano. **Decisão confirmada com o usuário:** excluída do escopo deste
   domínio — não recebe chave de permissão, comportamento inalterado.

6. **Nenhuma das 6 rotas tocadas neste domínio tem teste hoje.** O único teste relacionado a
   cupons (`tests/unit/checkout-coupon.test.ts`) cobre a lógica de aplicação de desconto no
   checkout, não as rotas de CRUD/listagem/exportação. Como no domínio de Lotes/Categorias/
   Percursos, os testes serão escritos do zero, não estendidos.

## Decisões confirmadas com o usuário

- **Gap de autenticação em `GET .../coupons`:** corrigir junto, não apenas documentar.
- **IDOR em `PATCH`/`DELETE .../coupons/[couponId]`:** corrigir junto, não apenas documentar.
- **Rota `preview`:** fora do escopo, não é ação de gestão de organizador/admin.
- **Nomenclatura de chaves:** segue o precedente do domínio de Inscrições — rotas admin e
  organizador que fazem a mesma operação de negócio mas são arquivos físicos separados ganham
  chaves separadas, com sufixo `-any` do lado admin. Rotas que já são um único arquivo físico
  compartilhado com bypass (como `report-export`) ganham uma única chave sem sufixo.

## Chaves de permissão

| Chave | Rota | Escopo | Bypass de admin? |
|---|---|---|---|
| `coupons.view` | `GET app/api/events/[id]/coupons/route.ts` | Compartilhado (mesmo handler pros dois papéis) | Sim — novo, rota hoje é pública sem auth nenhuma |
| `coupons.create` | `POST app/api/events/[id]/coupons/route.ts` | Organizador | Não (rota não aceita ADMIN hoje) |
| `coupons.edit` | `PATCH app/api/events/[id]/coupons/[couponId]/route.ts` | Organizador | Não (rota não aceita ADMIN hoje) — + fix do IDOR |
| `coupons.delete` | `DELETE app/api/events/[id]/coupons/[couponId]/route.ts` | Organizador | Não (rota não aceita ADMIN hoje) — + fix do IDOR |
| `coupons.report-export` | `GET app/api/events/[id]/coupons/report-export/route.ts` | Compartilhado (mesmo handler pros dois papéis) | Sim (já existe hoje, mesmo padrão de `registrations.view`) |
| `coupons.create-any` | `POST app/api/admin/coupons/route.ts` | Admin, qualquer evento ou cupom global | — (rota é ela mesma sem escopo nenhum, `checkAdminOnlyApiPermission`) |
| `coupons.edit-any` | `PATCH app/api/admin/coupons/[id]/route.ts` | Admin, qualquer cupom | — (`checkAdminOnlyApiPermission`) |
| `coupons.delete-any` | `DELETE app/api/admin/coupons/[id]/route.ts` | Admin, qualquer cupom | — (`checkAdminOnlyApiPermission`) |
| `coupons.export-all` | `GET app/api/admin/coupons/export/route.ts` | Admin, plataforma inteira | — (`checkAdminOnlyApiPermission`, sem equivalente organizador) |

9 chaves no total: 2 compartilhadas (`.view`, `.report-export`), 3 exclusivas de organizador, 4
exclusivas de admin.

## Arquitetura

Nenhuma peça de infraestrutura nova — reaproveita 100% do que a Fase 1 já construiu
(`checkApiPermission`, `checkAdminOnlyApiPermission`, `resolveActingScope`).

- **`GET .../coupons` (view)**: troca a ausência total de auth por
  `checkApiPermission("coupons.view")` + `resolveActingScope(session)`, com a resolução do evento
  usando `scope.actingAsAdmin ? db.event.findUnique(...) : db.event.findFirst({...organizerId:
  scope.organizerId ?? "__none__"})` — mesmo padrão exato de `batches.create`/`registrations.view`.
  Continua retornando os cupons do evento resolvido.
- **`POST .../coupons` (create), `PATCH`/`DELETE .../coupons/[couponId]` (edit/delete)**: trocam a
  checagem manual de ownership (`db.event.findFirst({id, organizer: {userId}})`) por
  `checkApiPermission("coupons.<ação>")` + `resolveActingScope(session)`, sempre usando
  `scope.organizerId ?? "__none__"` (nunca `scope.actingAsAdmin`), preservando a ausência de
  bypass funcional pra `ADMIN` que essas rotas já têm hoje. **Adicional:** o `where` do
  `db.coupon.update`/`db.coupon.delete` em `edit`/`delete` passa a incluir `eventId: id` (o evento
  já resolvido e escopado), fechando o IDOR — um `couponId` que não pertence ao evento escopado
  agora falha (Prisma lança erro de registro não encontrado, tratado como 404, igual ao
  comportamento de "evento não encontrado" já usado nessas rotas para outros casos de not-found).
- **`GET .../report-export`**: troca a checagem manual (`role !== "ADMIN" ? {organizerId} : {}`)
  por `checkApiPermission("coupons.report-export")` + `resolveActingScope(session)`, mesmo padrão
  de resolução de evento.
- **As 4 rotas admin** (`create-any`, `edit-any`, `delete-any`, `export-all`) trocam
  `session.user.role !== "ADMIN"` por `checkAdminOnlyApiPermission("coupons.<ação>")` — nenhuma
  delas tem filtro de escopo hoje (acesso total a qualquer cupom/evento já é o comportamento
  atual), então não há resolução de evento/organizador a ajustar, só a checagem de permissão na
  entrada da rota.
- **UI**: `app/admin/assistentes/page.tsx` ganha 6 chaves (`coupons.view`, `.report-export`,
  `.create-any`, `.edit-any`, `.delete-any`, `.export-all`). `app/organizador/assistentes/page.tsx`
  ganha 5 chaves (`coupons.view`, `.create`, `.edit`, `.delete`, `.report-export`).

## Testes

Diferente do domínio de Inscrições (onde as 11 rotas já tinham teste) e igual ao domínio de
Lotes/Categorias/Percursos, **nenhuma das 6 rotas tem teste hoje** — o plano cria os 6 arquivos de
teste do zero, cobrindo por rota: titular (organizador ou admin) continua funcionando sem
regressão, assistente com a permissão certa funciona, assistente sem a permissão é barrado com
403, requisição anônima é barrada com 401 (novo caso relevante em `coupons.view`, que hoje é
público). Nas duas rotas com fix de IDOR (`edit`, `delete`), teste adicional específico: organizador
titular de um evento não consegue editar/excluir um cupom que pertence a outro evento (ou é
global), mesmo sabendo o `couponId` — deve retornar 404, não 200.

## Fora de escopo

- Rota `preview` (ação de checkout do atleta, não de gestão) — permanece pública para qualquer
  sessão autenticada, sem chave de permissão.
- Qualquer outro domínio da Fase 2 (pagamentos/estornos, resultados, carrinhos abandonados,
  relatórios) — cada um vira seu próprio ciclo spec→plano→implementação→revisão.
- Deploy das Fases 1/2 anteriores (ainda pendente, decisão separada do usuário).
