# Usuários Assistentes — Fase 2, domínio 4: Pagamentos/Estornos — Design

## Contexto

Quarto domínio da Fase 2 (rollout sequencial do sistema de usuários assistentes construído na
Fase 1 — infraestrutura pronta, revisada, ainda não deployada — e já aplicado a Eventos na Fase 1,
Lotes/Categorias/Percursos, Inscrições/Pedidos e Cupons na Fase 2, nenhum deployado ainda).

Este domínio cobre as 8 ações do catálogo (`docs/superpowers/specs/2026-07-14-analise-acoes-
sistema.md`, seção 5) relacionadas a pagamentos e estornos: estornar pagamento, resolver estorno
manualmente, conciliar pagamentos com o gateway, exportar CSV de pagamento (individual e em
lote) — cada uma admin e/ou organizador.

Sessão em modo piloto automático (usuário pediu explicitamente pra seguir em frente decidindo
sempre pelo recomendado, sem pausar por confirmação). Todas as decisões abaixo seguem
diretamente o precedente já estabelecido nos 3 domínios anteriores — nenhuma é uma escolha nova
de design, só aplicação consistente do padrão já validado.

## Achados da leitura do código real

1. **As 3 rotas de organizador deste domínio (`refund`, `manual-resolve`, `reconciliation`)
   filtram por `organizer: { userId: session.user.id }` (relação até `User.id`), não por
   `organizerId` (campo direto de `OrganizerProfile.id`)** — diferente de todos os domínios já
   convertidos (Lotes/Categorias/Percursos, Inscrições/Pedidos, Cupons), que já usavam
   `event.organizerId` como FK direta. Isso significa que `resolveActingScope` (que resolve
   `organizerId` = `OrganizerProfile.id`) **não serve pra filtrar essas 3 queries diretamente** —
   usar `scope.organizerId` aqui exigiria trocar a forma da query (`organizer: {id: ...}` em vez
   de `organizer: {userId: ...}`), o que é uma mudança maior e desnecessária.

   **Este é exatamente o mesmo problema já resolvido na Fase 2 domínio 2, Task 7
   (`app/api/organizer/expire-payments/route.ts`)**: a solução lá foi uma resolução LOCAL de
   `organizerUserId` (não via `resolveActingScope`) — titular usa `session.user.id` diretamente,
   `ASSISTANT` faz 1 query extra em `db.user.findUnique({where: {id: session.user.id}, select:
   {createdByUserId: true}})` pra subir até o `User.id` do criador, com fallback `"__none__"`
   seguro (nunca bate com nenhum `User.id` real). Este domínio replica esse mesmo padrão local
   nas 3 rotas de organizador — `lib/auth/rbac.ts` continua sem nenhuma mudança.

2. **As 3 rotas de organizador aceitam `ADMIN` no *role check*** (`role !== "ORGANIZER" && role
   !== "ADMIN"`) **mas nunca dão acesso funcional a ele** — mesmo "bug" replicado fielmente nos 3
   domínios anteriores: `ADMIN` titular nunca tem `organizerUserId` que bata com um evento real
   (sua própria conta não é dona de nenhum evento), e um assistente-de-admin também nunca bate
   (`createdByUserId` de um admin não é dono de evento nenhum). **Decisão: replicar como está,**
   sem dar bypass funcional a `ADMIN` nessas 3 rotas — ele já tem acesso total pelas 5 rotas admin
   dedicadas.

3. **As 5 rotas admin não têm NENHUM filtro de escopo hoje** (acesso total e incondicional a
   qualquer pagamento/estorno/conciliação da plataforma) — mesmo padrão das rotas `-any`/`-all`
   dos domínios anteriores (`registrations.*-any`, `coupons.*-any`, `coupons.export-all`).

4. **Duas rotas admin de exportação, ações distintas, sem ambiguidade de nome:**
   `GET admin/payments/[id]/export` (CSV detalhado de 1 pagamento específico) e
   `GET admin/payments/export` (CSV de todos os pagamentos, com filtros de busca/data/status).
   Nenhuma das duas tem equivalente organizador (catálogo confirma: organizador não tem rota de
   visualizar/exportar pagamentos, só agir sobre eles via estorno/conciliação).

5. **Nota do catálogo:** a rota de estorno do admin recebe `paymentId` bruto; a do organizador
   recebe `registrationId` e busca o último pagamento pago (`payments: {where: {status: "PAID"},
   orderBy: {paidAt: "desc"}, take: 1}`) — contratos de API diferentes, mas mesmo serviço
   `refundPayment()` por trás e mesma permissão conceitual ("Estornar pagamento"). Nenhuma mudança
   nesse serviço compartilhado — cada rota continua montando seu próprio `where`/parâmetro antes
   de chamar `refundPayment()`/`resolveRefundManually()`.

6. **6 das 8 rotas já têm teste hoje** (confirmado lendo `tests/` diretamente, não só o
   catálogo) — `manual-resolve` (organizador e admin), `reconciliation` (organizador e admin) e
   as 2 rotas de exportação de pagamento. Só as 2 rotas de `refund` (organizador e admin) não têm
   teste nenhum. Mais parecido com Inscrições/Pedidos (a maioria já tinha teste) do que com
   Lotes/Categorias/Percursos ou Cupons (nenhuma tinha).

## Decisões

- **Resolução de escopo nas 3 rotas de organizador:** resolução LOCAL de `organizerUserId`
  (padrão já validado em `expire-payments`), não `resolveActingScope`. Nenhuma mudança em
  `lib/auth/rbac.ts`.
- **Sem bypass de admin em nenhuma das 3 chaves de organizador** — replica o "bug" existente
  (ADMIN aceito no role check, nunca funcional), mesma decisão já tomada nos domínios anteriores
  pra casos equivalentes.
- **Nomenclatura de chaves:** ações conceitualmente iguais em arquivos de rota fisicamente
  separados (admin vs. organizador) ganham chaves separadas com sufixo `-any` do lado admin —
  mesmo padrão de `registrations.*`/`coupons.*`. As 2 rotas de exportação admin, sem equivalente
  organizador, ganham nomes próprios sem ambiguidade (`payments.export` pro detalhe individual,
  `payments.export-all` pro lote da plataforma) — mesmo padrão de `coupons.export-all`.

## Chaves de permissão

| Chave | Rota | Escopo | Bypass de admin? |
|---|---|---|---|
| `payments.refund` | `POST app/api/organizer/registrations/[id]/refund/route.ts` | Organizador | Não (replica o "bug" — ADMIN aceito no role check mas nunca funcional) |
| `payments.refund-any` | `POST app/api/admin/payments/[id]/refund/route.ts` | Admin, qualquer pagamento | — (`checkAdminOnlyApiPermission`, sem filtro) |
| `payments.manual-resolve` | `POST app/api/organizer/refunds/[paymentId]/manual-resolve/route.ts` | Organizador | Não (idem) |
| `payments.manual-resolve-any` | `POST app/api/admin/refunds/[paymentId]/manual-resolve/route.ts` | Admin, qualquer pagamento | — (`checkAdminOnlyApiPermission`, sem filtro) |
| `payments.reconciliation` | `POST app/api/organizer/reconciliation/route.ts` | Organizador | Não (idem) |
| `payments.reconciliation-any` | `POST app/api/admin/reconciliation/route.ts` | Admin, plataforma inteira | — (`checkAdminOnlyApiPermission`, sem filtro) |
| `payments.export` | `GET app/api/admin/payments/[id]/export/route.ts` | Admin, qualquer pagamento | — (`checkAdminOnlyApiPermission`, sem equivalente organizador) |
| `payments.export-all` | `GET app/api/admin/payments/export/route.ts` | Admin, plataforma inteira (com filtros) | — (`checkAdminOnlyApiPermission`, sem equivalente organizador) |

8 chaves no total: 3 exclusivas de organizador, 5 exclusivas de admin. Nenhuma chave
compartilhada/com bypass neste domínio (diferente de Cupons, que tinha `.view`/`.report-export`).

## Arquitetura

Nenhuma peça de infraestrutura nova — reaproveita 100% do que a Fase 1 já construiu
(`checkApiPermission`, `checkAdminOnlyApiPermission`), mais o padrão de resolução local de
`organizerUserId` já usado em `expire-payments` (Fase 2 domínio 2).

- **As 3 rotas de organizador** (`refund`, `manual-resolve`, `reconciliation`) trocam a checagem
  manual de papel por `checkApiPermission("payments.<ação>")`, seguida da mesma resolução local
  já usada em `expire-payments`:
  ```ts
  let organizerUserId = session.user.id;
  if (session.user.role === "ASSISTANT") {
    const assistant = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    organizerUserId = assistant?.createdByUserId ?? "__none__";
  }
  ```
  Cada rota então usa `organizerUserId` no lugar de `session.user.id` exatamente onde a query já
  filtrava por `organizer: {userId: ...}` (ou, em `reconciliation`, no parâmetro
  `organizerUserId` passado a `reconcilePayments()`). Nenhuma outra parte da lógica de negócio
  muda.
- **As 5 rotas admin** trocam `session.user.role !== "ADMIN"` por
  `checkAdminOnlyApiPermission("payments.<ação>-any"/"payments.export"/"payments.export-all")` —
  nenhuma tem filtro de escopo hoje, então não há resolução a ajustar, só a checagem de permissão
  na entrada da rota.
- **UI**: `app/admin/assistentes/page.tsx` ganha 5 chaves (`payments.refund-any`,
  `.manual-resolve-any`, `.reconciliation-any`, `.export`, `.export-all`).
  `app/organizador/assistentes/page.tsx` ganha 3 chaves (`payments.refund`, `.manual-resolve`,
  `.reconciliation`).

## Testes

6 das 8 rotas já têm teste hoje e serão estendidas (lidas primeiro, casos novos adicionados sem
tocar nos existentes) — só as 2 rotas de `refund` são escritas do zero. Mesma estrutura de casos
usada nos domínios anteriores: titular continua funcionando sem regressão, assistente com a permissão
certa funciona, assistente sem a permissão é barrado com 403; nas rotas admin `-any`/`export`,
admin titular continua funcionando, assistente-de-admin com a permissão funciona,
assistente-de-organizador mesmo com a chave errada concedida por engano é barrado (mesmo padrão
de teste usado em `admin-coupons-route.test.ts` pra `checkAdminOnlyApiPermission`). Nas 3 rotas de
organizador, teste dedicado confirmando que `ADMIN` titular recebe 404/sem resultado (SEM bypass
funcional), e teste dedicado do assistente fazendo a query extra de `createdByUserId` — mesmo
padrão já usado em `tests/organizer-expire-payments-route.test.ts` (existente, confirmado): mocka
`dbMock.user.findUnique` retornando `{createdByUserId: "org-user-1"}` e afirma que a função de
negócio foi chamada com esse `organizerUserId` resolvido, não com o `id` do assistente.

## Fora de escopo

- `app/api/cron/reconciliation/route.ts` — rota de cron job (autenticação por segredo, não por
  sessão de usuário), não é uma ação de usuário e não faz parte do sistema de assistentes.
- Domínio de Repasses (Payouts, catálogo seção 6) — só admin, sem mutação de organizador; fica
  pra decisão futura se algum dia fizer sentido dar acesso de assistente a isso.
- Qualquer outro domínio da Fase 2 (resultados, carrinhos abandonados, relatórios) — cada um vira
  seu próprio ciclo spec→plano→implementação→revisão.
- Deploy das Fases 1/2 anteriores (ainda pendente, decisão separada do usuário).
