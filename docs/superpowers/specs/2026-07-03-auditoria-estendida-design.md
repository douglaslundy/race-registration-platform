# Design: auditoria estendida (ambiente, páginas acessadas, carrinhos abandonados)

Sub-projeto 7 de um conjunto maior de pedidos.

## Contexto (o que já existe)

- `AuditLog` (`prisma/schema.prisma`): `{ id, userId?, action, entityType, entityId?, metadata? (Json), ipAddress?, createdAt }`. Já cobre um bom catálogo de ações baseadas em entidade (`EVENT_CREATED`, `REGISTRATION_CANCELLED`, `PAYMENT_WEBHOOK`, `CHECKOUT_COMPLETED`, etc.) gravadas em ~20 rotas diferentes.
- `/admin/auditoria` (`app/admin/auditoria/page.tsx`): única tela, só admin, com filtros por ação/entidade/userId/data, ordenação, paginação e exportação CSV. `lib/admin/audit.ts` tem os helpers puros `buildAdminAuditWhere`/`buildAdminAuditOrderBy` (com testes).
- `lib/admin/labels.ts`: `ACTION_LABEL`/`ENTITY_LABEL` (rótulos amigáveis) e `ACTION_COLOR` (dentro da própria página) mapeando cada `action` conhecida para uma cor de badge.
- `User.role`: enum `ATHLETE | ORGANIZER | ADMIN | SUPPORT | PARTNER` — todo `AuditLog` com `userId` preenchido pode ser associado a um papel via join; entradas sem `userId` (ex.: `PAYMENT_WEBHOOK`) são disparadas pelo sistema, não por um usuário.
- `checkAbandonedCarts()` (`lib/alerts/abandoned-cart.ts`, sub-projeto 6b): já varre `Order`s `PENDING` mais antigos que um limiar configurável e notifica por e-mail/WhatsApp (se ligados) — mas não grava nada em `AuditLog` hoje.
- Nenhum mecanismo de `middleware.ts` existe no projeto. As 3 áreas logadas (`app/dashboard/layout.tsx`, `app/organizador/layout.tsx`, `app/admin/layout.tsx`) são Server Components que já chamam `requireAuth`/`requireOrganizer`/`requireAdmin` e envolvem todas as páginas daquela área.

## Decisões (confirmadas com o usuário)

1. Sem telas novas — um filtro de "Ambiente" (Admin/Organizador/Atleta/Sistema) na já existente `/admin/auditoria`.
2. Páginas acessadas: só dentro das 3 áreas logadas (não rastreia páginas públicas nem visitantes anônimos), cobrindo **todas** as páginas de cada área (não uma lista seleta).
3. Carrinho abandonado: `checkAbandonedCarts()` passa a gravar `AuditLog` para cada pedido detectado, independente de e-mail/WhatsApp estarem ligados — reaproveita a detecção existente.

## Arquitetura

### Filtro de ambiente (sem migração de schema)

O "ambiente" de uma entrada de auditoria é derivado do `role` do usuário associado (via join em `user.role`), não uma coluna nova:
- **Admin** → `user.role = "ADMIN"`
- **Organizador** → `user.role = "ORGANIZER"`
- **Atleta** → `user.role = "ATHLETE"`
- **Sistema** → `userId` é `null` (ex.: `PAYMENT_WEBHOOK`, e o novo `CART_ABANDONED`)

`lib/admin/audit.ts`: `buildAdminAuditWhere` ganha um parâmetro `environment?: "ADMIN" | "ORGANIZER" | "ATHLETE" | "SYSTEM"`, traduzido para `{ user: { role: "ADMIN" } }` (etc.) ou `{ userId: null }` para `"SYSTEM"`.

`app/admin/auditoria/page.tsx` ganha um novo campo de filtro no formulário (`<select name="environment">`) e passa o valor para `buildAdminAuditWhere`; o `include` da query já traz `user`, então nenhuma consulta extra é necessária.

### Páginas acessadas

Novo componente client `components/audit/PageViewLogger.tsx`:
```tsx
"use client";
// usePathname() + useEffect: a cada mudança de path, POST fire-and-forget
// para /api/audit/pageview com { path: pathname }. Nunca bloqueia a UI,
// nunca mostra erro ao usuário (é só um log em segundo plano).
```

Inserido uma vez em cada um dos 3 layouts logados (`DashboardLayout`, `OrganizadorLayout`, `AdminLayout` — edição aditiva de uma linha em cada, sem alterar `requireAuth`/`requireOrganizer`/`requireAdmin` nem a estrutura existente).

Nova rota `POST /api/audit/pageview`: exige sessão (401 se ausente), valida `{ path: string }` (zod), grava `AuditLog { userId: session.user.id, action: "PAGE_VIEWED", entityType: "Page", entityId: path, metadata: { path } }`. Responde rápido (`{ ok: true }`) — não faz nenhuma outra validação de negócio.

### Carrinho abandonado na auditoria

Em `lib/alerts/abandoned-cart.ts`, dentro do laço de `checkAbandonedCarts()`, para cada pedido elegível (`PENDING` + mais antigo que o limiar), grava incondicionalmente `AuditLog { userId: order.buyerUserId, action: "CART_ABANDONED", entityType: "Order", entityId: order.id, metadata: { eventTitle } }` — antes ou depois de tentar os canais de e-mail/WhatsApp, sem depender deles estarem ligados. Isso significa que mesmo com os alertas desligados, o histórico de carrinhos abandonados fica visível em `/admin/auditoria`. Como essa gravação não depende de configuração nenhuma, ela roda toda vez que a rota de cron processa um pedido elegível — **não tem deduplicação** (diferente do envio de e-mail/WhatsApp): cada execução do cron que ainda encontra o pedido como `PENDING` grava uma nova entrada. Isso é aceitável porque `AuditLog` é um histórico de eventos, não um estado; múltiplas entradas para o mesmo pedido ao longo do tempo (uma por execução do cron enquanto ele seguir pendente) refletem corretamente "esse carrinho continua abandonado".

### Rótulos e cores

`lib/admin/labels.ts`: adiciona `PAGE_VIEWED: "Página acessada"` e `CART_ABANDONED: "Carrinho abandonado"` ao `ACTION_LABEL`; adiciona `Page` ao `ENTITY_LABEL`. `app/admin/auditoria/page.tsx`'s `ACTION_COLOR`: adiciona as mesmas duas chaves (cores neutras/informativas, já que não são erros nem sucessos).

## Fora de escopo

- Rastreamento de páginas públicas ou de visitantes não autenticados.
- Telas de auditoria dedicadas para organizador ou atleta (o filtro de ambiente é só para o admin).
- Qualquer alerta/notificação disparado por um registro de página acessada — é só um log passivo.
- Deduplicação do registro de `CART_ABANDONED` (ver justificativa acima).
- Alterar a lógica de detecção de carrinho abandonado em si (limiar, canais) — só adiciona a gravação de auditoria à rotina já existente.

## Testes

- Testes unitários para `buildAdminAuditWhere` cobrindo o novo parâmetro `environment` (cada um dos 4 valores + ausência do filtro).
- Testes de rota para `POST /api/audit/pageview` (401 sem sessão, 400 com corpo inválido, 200 gravando o `AuditLog` esperado).
- Teste unitário para `checkAbandonedCarts` confirmando que o novo `AuditLog` é gravado para cada pedido elegível, independente dos canais estarem ligados ou desligados (estendendo os testes já existentes desse módulo).
- Sem testes de UI/componente (convenção já estabelecida) para `PageViewLogger` e o novo filtro na tela — verificação manual.
- Verificação manual: navegar como atleta/organizador/admin e confirmar que aparecem entradas `PAGE_VIEWED` corretas em `/admin/auditoria`; filtrar por cada ambiente e confirmar que só aparecem as entradas esperadas; rodar o cron de carrinho abandonado com um pedido antigo e confirmar a entrada `CART_ABANDONED`.
