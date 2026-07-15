# Usuários Assistentes — Fase 2, domínio 6: Carrinhos Abandonados + Relatórios — Design

## Contexto

Sexto e último domínio da Fase 2 (rollout sequencial do sistema de usuários assistentes). Cobre
as seções 7 e 8 do catálogo (`docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`):
reenviar alerta de carrinho abandonado (admin + organizador) e exportar relatório financeiro
(admin + organizador). A conciliação, listada na seção 7 do catálogo, já foi coberta no domínio 4
(Pagamentos/Estornos). Os dois grupos são pequenos (2 rotas cada) e foram combinados num único
ciclo.

Sessão em modo piloto automático (decidir sempre pelo recomendado, sem pausar por confirmação).

## Achados da leitura do código real

1. **`POST organizer/abandoned-carts/notify`** filtra por `organizer: {userId: session.user.id}`
   (User.id) tanto no pedido individual quanto no `buildAbandonedCartWhere(..., {organizerUserId})`
   do envio em massa — usa a **resolução LOCAL de `organizerUserId`** (padrão do domínio
   Pagamentos), não `resolveActingScope`. O *role check* atual aceita `ADMIN` mas nunca dá acesso
   funcional (mesmo "bug" replicado nos domínios anteriores — o teste existente até documenta
   isso: "Admin hitting organizer route should still scope by admin's userId"). Replicar.

2. **`POST admin/abandoned-carts/notify`** é admin-only sem escopo — `checkAdminOnlyApiPermission`
   direto. Nota do catálogo: o mesmo endpoint aceita envio individual (`orderId`) e em massa
   (`all` + filtros) — uma única chave cobre os dois modos, como o catálogo recomenda.

3. **`GET organizer/report/export`** exige hoje apenas sessão (qualquer papel logado) e então
   resolve `organizerProfile` por `userId` — quem não tem perfil (atleta, admin) recebe 404
   "Perfil de organizador não encontrado". O filtro usa `organizerId` (`OrganizerProfile.id`),
   então aqui **`resolveActingScope` serve diretamente**: assistente-de-organizador herda o
   `organizerId` do criador; admin titular e assistente-de-admin continuam sem acesso funcional
   (`organizerId` null → 404, replicando o comportamento atual do admin sem perfil). Com
   `checkApiPermission`, atleta passa a receber 403 em vez de 404 — endurecimento correto e
   consistente com os demais domínios.

4. **`GET admin/report/export`** é admin-only sem escopo — `checkAdminOnlyApiPermission` direto.

5. **Testes existentes:** `organizer-abandoned-carts-notify-route.test.ts` (9 testes),
   `admin-abandoned-carts-notify-route.test.ts`, `admin-report-route.test.ts` — todos serão
   estendidos. `organizer/report/export` **não tem teste** — casos de permissão escritos do zero.

## Chaves de permissão

| Chave | Rota | Escopo | Bypass de admin? |
|---|---|---|---|
| `abandoned-carts.notify` | `POST app/api/organizer/abandoned-carts/notify/route.ts` | Organizador (resolução local de `organizerUserId`) | Não (replica o "bug") |
| `abandoned-carts.notify-any` | `POST app/api/admin/abandoned-carts/notify/route.ts` | Admin, plataforma inteira | — (`checkAdminOnlyApiPermission`) |
| `reports.export` | `GET app/api/organizer/report/export/route.ts` | Organizador (via `resolveActingScope`) | Não (admin sem perfil continua 404, como hoje) |
| `reports.export-all` | `GET app/api/admin/report/export/route.ts` | Admin, plataforma inteira | — (`checkAdminOnlyApiPermission`) |

4 chaves: 2 de organizador, 2 de admin.

## Arquitetura

- **`organizer/abandoned-carts/notify`**: `checkApiPermission("abandoned-carts.notify")` +
  resolução local de `organizerUserId` (bloco idêntico ao de Pagamentos/expire-payments);
  `organizerUserId` substitui `session.user.id` no `where` do pedido individual e no
  `scope.organizerUserId` do envio em massa. `auditLog.userId` continua `session.user.id`.
- **`admin/abandoned-carts/notify`**: troca `role !== "ADMIN"` por
  `checkAdminOnlyApiPermission("abandoned-carts.notify-any")`.
- **`organizer/report/export`**: `checkApiPermission("reports.export")` +
  `resolveActingScope(session)`; se `scope.organizerId` for null (admin, assistente-de-admin, ou
  organizador sem perfil), 404 "Perfil de organizador não encontrado" (comportamento atual
  preservado); senão o filtro usa `scope.organizerId` no lugar de `organizer.id`.
- **`admin/report/export`**: troca `role !== "ADMIN"` por
  `checkAdminOnlyApiPermission("reports.export-all")`.
- **UI**: admin ganha `abandoned-carts.notify-any` e `reports.export-all`; organizador ganha
  `abandoned-carts.notify` e `reports.export`.

## Testes

Estender os 3 arquivos existentes com os casos de assistente (com permissão funciona escopado ao
criador; sem permissão 403; nas rotas admin, assistente-de-organizador com chave errada barrado).
Criar casos novos pra `organizer/report/export` (sem arquivo hoje): organizador titular exporta,
assistente-de-organizador exporta com o `organizerId` do criador, admin titular recebe 404 (sem
acesso funcional, como hoje), assistente sem permissão 403. Testes existentes intactos, exceto
possíveis ajustes 403→401 de semântica de sessão ausente (mesmo padrão dos domínios anteriores),
se houver.

## Fora de escopo

- Seções restantes do catálogo que são admin-only de alto risco e ficaram explicitamente pra
  depois (Usuários, Configurações da Plataforma, WhatsApp, Auditoria, Backup/Restore, Repasses) —
  não fazem parte do rollout de assistentes por ora.
- Deploy (decisão separada do usuário).
