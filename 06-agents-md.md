# AGENTS.md

## Projeto
Sistema de inscrição para corridas de rua, com arquitetura extensível para outros esportes.

## Objetivo do agente
Trabalhe como engenheiro full-stack sênior. Priorize código simples, seguro, testável e tipado. Nunca implemente pagamento real sem ambiente sandbox e validação explícita de webhook.

## Stack padrão
- Next.js
- TypeScript
- PostgreSQL
- Prisma
- Tailwind
- Vitest
- Playwright

## Comandos
- Instalar dependências: `npm install`
- Rodar dev: `npm run dev`
- Lint: `npm run lint`
- Testes unitários: `npm run test`
- Testes e2e: `npm run test:e2e`
- Prisma migrate: `npx prisma migrate dev`

## Regras de implementação
1. Escreva tipos explícitos para regras financeiras.
2. Não armazene dados de cartão.
3. Webhooks devem ser idempotentes.
4. Toda rota administrativa deve validar RBAC.
5. Toda alteração de pagamento, inscrição ou repasse deve gerar AuditLog.
6. Não use valores monetários em float; use centavos inteiros.
7. Não exponha CPF, telefone ou e-mail em páginas públicas.
8. Toda feature relevante deve incluir teste.

## Definition of Done
- Código compila.
- Lint passa.
- Testes passam.
- Fluxo principal documentado.
- Migrações incluídas.
- Sem secrets hardcoded.
