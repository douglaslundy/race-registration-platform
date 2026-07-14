# Usuários Assistentes — Fase 2, domínio 1: Lotes/Categorias/Percursos — Design

## Contexto

A Fase 1 (`docs/superpowers/specs/2026-07-14-usuarios-assistentes-fase1-design.md`) construiu toda
a infraestrutura de usuários assistentes (schema `ASSISTANT`/`createdByUserId`/
`AssistantPermission`, helpers de RBAC `resolveActingScope`/`checkApiPermission`/
`checkAdminOnlyApiPermission`, fluxo de criação/promoção, telas de gestão) e provou o padrão de
ponta a ponta no domínio Eventos. Está implementada, revisada e aprovada, mas **ainda não
deployada** (decisão do usuário de seguir direto pra Fase 2 antes de deployar).

A Fase 2 é o rollout desse mesmo padrão já validado pros domínios restantes do escopo v1
(`docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`), um domínio por vez — decisão já
tomada de dividir em sub-projetos sequenciais em vez de um plano único gigante, já que o escopo
completo (~50 ações em 7 domínios) seria grande demais pra revisar com segurança de uma vez.

Este documento cobre o **primeiro domínio da Fase 2: Lotes, Categorias e Percursos** — escolhido
por complementar diretamente o domínio Eventos já pronto (mesmo fluxo de trabalho do organizador
ao configurar um evento).

## Achado da análise que molda este desenho

As 6 rotas deste domínio (`app/api/events/[id]/batches/**`,
`app/api/events/[id]/categories/**`, `app/api/events/[id]/routes/**`) **não têm bypass de admin
hoje** — checam só `organizer: { userId: session.user.id }`. Um admin titular não consegue
gerenciar lotes/categorias/percursos de nenhum organizador via essas rotas hoje, a menos que
tenha um `OrganizerProfile` próprio (o que admins normais não têm).

**Decisão confirmada com o usuário:** manter esse comportamento exatamente como está — este
trabalho só estende a mesma capacidade que o organizador já tem pro assistente dele, sem abrir um
bypass de admin novo que não existia antes. Isso é uma decisão deliberada de não expandir escopo
além do pedido original (adicionar suporte a assistentes), não uma correção do "gap estrutural"
identificado na análise.

## Escopo

Como consequência da decisão acima, **todas as chaves de permissão deste domínio são
exclusivamente de organizador** — não existe nenhuma chave admin-only aqui (diferente de Eventos,
que teve 4 chaves admin-only). Um assistente-de-admin nunca vê nenhuma dessas chaves no checklist
de criação, porque nenhuma faz sentido pra ele (o próprio admin titular não tem acesso a essas
rotas).

## Chaves de permissão

| Chave | Ação | Rota afetada |
|---|---|---|
| `batches.view` | Ver lotes, categorias e percursos (visualização unificada — hoje aparecem juntos na mesma tela de configuração do evento) | `GET app/api/events/[id]/batches/route.ts`, `GET app/api/events/[id]/categories/route.ts`, `GET app/api/events/[id]/routes/route.ts` |
| `batches.create` | Criar lote de ingresso | `POST app/api/events/[id]/batches/route.ts` |
| `batches.edit` | Editar lote (preço, capacidade, ativação, datas, ativo/inativo) | `PATCH app/api/events/[id]/batches/[batchId]/route.ts` |
| `batches.delete` | Excluir lote | `DELETE app/api/events/[id]/batches/[batchId]/route.ts` |
| `categories.create` | Criar categoria | `POST app/api/events/[id]/categories/route.ts` |
| `categories.edit` | Editar categoria | `PATCH app/api/events/[id]/categories/[categoryId]/route.ts` |
| `categories.delete` | Excluir categoria | `DELETE app/api/events/[id]/categories/[categoryId]/route.ts` |
| `routes.create` | Criar percurso | `POST app/api/events/[id]/routes/route.ts` |
| `routes.edit` | Editar percurso | `PATCH app/api/events/[id]/routes/[routeId]/route.ts` |
| `routes.delete` | Excluir percurso | `DELETE app/api/events/[id]/routes/[routeId]/route.ts` |

Marcar qualquer ação de escrita implica automaticamente `batches.view` (mesma regra já
estabelecida na Fase 1) — a UI de criação garante isso, o backend não precisa impor.

## Arquitetura

Nenhuma peça de infraestrutura nova — reaproveita 100% do que a Fase 1 já construiu:

- **Sem migração de schema.** `AssistantPermission.actionKey` já é uma string livre; as 10 chaves
  novas são só valores novos gravados na mesma tabela existente.
- **Rotas**: cada uma das 6 rotas troca sua checagem manual de dono (`organizer: { userId:
  session.user.id }`) por `checkApiPermission(actionKey)` + `resolveActingScope(session)`, mesmo
  padrão exato já usado nas rotas de Eventos na Fase 1 (`scope.organizerId` no lugar da resolução
  direta de `organizerProfile`). Como não há bypass de admin, nenhuma rota deste domínio usa
  `checkAdminOnlyApiPermission` — todas usam `checkApiPermission` normal, mas a query de posse
  (`findFirst({where:{id, eventId: {..., organizerId: scope.organizerId}}}`, ou equivalente,
  dependendo de como cada rota resolve o evento pai) precisa continuar existindo, já que
  `checkApiPermission` sozinha não escopa por evento/organizador — só confirma que a permissão
  existe.
- **UI**: `app/organizador/assistentes/page.tsx` ganha as 10 chaves novas na lista de
  `actionOptions` (nenhuma chave nova em `app/admin/assistentes/page.tsx`, já que não há chave
  admin-only neste domínio). O componente `components/assistants/AssistantManager.tsx` não muda
  de código — só a lista de `actionOptions` passada pela página do organizador cresce. A lógica de
  "escrita implica view" (já flagada como um pouco frágil pra múltiplos domínios na revisão final
  da Fase 1) precisa ser revisada agora que há 3 domínios (`events`, `batches`, `categories`,
  `routes` — na prática 4 prefixos de chave) na mesma tela: a implicação precisa mapear cada
  prefixo de escrita (`batches.`, `categories.`, `routes.`) pra SUA PRÓPRIA chave `.view`
  correspondente — não existe um único `.view` compartilhado entre os 3 sub-recursos deste
  domínio no nível de implementação (só na apresentação humana da tabela acima, que os agrupa
  visualmente); tecnicamente `batches.create` implica `batches.view`, `categories.create` implica
  `batches.view` também (é a MESMA chave de view compartilhada pelos 3 sub-recursos, conforme a
  tabela) — ou seja, a implicação é: qualquer chave que comece com `batches.`, `categories.` ou
  `routes.` implica a chave literal `batches.view` (não uma chave `.view` derivada do próprio
  prefixo, já que só existe uma chave de view pra este domínio inteiro).

## Testes

Mesmo padrão da Fase 1: pra cada uma das 6 rotas, teste de titular funcionando como antes
(sem regressão), teste de assistente com a permissão certa funcionando, teste de assistente sem a
permissão barrado com 403. Nenhum teste de `checkAdminOnlyApiPermission` é necessário aqui (não
há chave admin-only neste domínio).

## Fora de escopo

- Bypass de admin pra este domínio (decisão explícita, ver acima).
- Qualquer outro domínio da Fase 2 (inscrições/pedidos, cupons, pagamentos/estornos, resultados,
  carrinhos abandonados, relatórios) — cada um vira seu próprio ciclo spec→plano→implementação
  depois deste.
- Deploy da Fase 1 (ainda pendente, decisão separada do usuário).
