# Prompts para usar no Codex

## Prompt 1 — Scaffold inicial
Crie um projeto Next.js com TypeScript, Tailwind, Prisma e PostgreSQL para um sistema de inscrições em corridas de rua. Configure ESLint, Prettier, Vitest e Playwright. Crie a estrutura de pastas /app, /components, /lib, /prisma, /tests e /docs. Gere README.md e AGENTS.md com comandos de desenvolvimento.

## Prompt 2 — Modelagem do banco
Implemente o schema Prisma para User, AthleteProfile, OrganizerProfile, Event, EventRoute, EventCategory, TicketType, TicketBatch, Registration, Order, Payment, Coupon, RaceResult e AuditLog. Use valores monetários em centavos inteiros. Inclua enums para status de evento, inscrição, pedido e pagamento. Gere migration.

## Prompt 3 — Catálogo público
Implemente página pública para listar eventos publicados, com filtros por cidade, modalidade e data. Crie página de detalhe do evento com banner, data, local, percursos, kits, regulamento, lotes disponíveis e botão de inscrição.

## Prompt 4 — Painel do organizador
Implemente dashboard do organizador com CRUD de eventos, percursos, categorias, tipos de ingresso e lotes. O organizador pode salvar rascunho e solicitar publicação. Somente admin aprova publicação.

## Prompt 5 — Fluxo de inscrição
Implemente fluxo de inscrição para atleta autenticado. O atleta escolhe evento, percurso, categoria, lote/tipo de ingresso, tamanho de camiseta e aceita termo. Crie Order e Registration em status pendente.

## Prompt 6 — Pagamento sandbox
Integre um provider de pagamento abstrato com interface PaymentProvider. Crie implementação fake/sandbox para desenvolvimento. Implemente webhook idempotente que confirma Order e Registration. Inclua testes.

## Prompt 7 — Admin
Implemente painel admin com aprovação de eventos, visualização de pedidos, pagamentos, inscrições e audit logs. Inclua RBAC.

## Prompt 8 — Resultados
Implemente importação CSV de resultados com colunas: bib_number, athlete_name, route, category, gender, gross_time, net_time, placement_general, placement_category. Crie página pública de busca de resultados.

## Prompt 9 — Hardening
Revise segurança, validações, erros, autorização e testes. Adicione rate limiting em auth, checkout e webhook. Garanta que dados pessoais não apareçam em páginas públicas.
