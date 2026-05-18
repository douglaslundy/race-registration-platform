# AGENTS.md

## Projeto
Sistema de inscrição para corridas de rua, com arquitetura extensível para outros esportes.

## Objetivo do agente
Trabalhe como engenheiro full-stack sênior. Priorize código simples, seguro, testável e tipado.
Nunca implemente pagamento real sem ambiente sandbox e validação explícita de webhook.

## Stack
- Next.js 14 (App Router) + TypeScript
- PostgreSQL + Prisma ORM
- Tailwind CSS
- Auth.js (NextAuth v5)
- Vitest (unit/integration) + Playwright (e2e)

## Comandos
```bash
npm install          # instalar dependências
npm run dev          # rodar dev
npm run lint         # lint
npm run test         # testes unitários
npm run test:e2e     # testes e2e
npm run db:migrate   # prisma migrate dev
npm run db:generate  # prisma generate
npm run db:studio    # prisma studio
```

## Regras de implementação
1. Tipos explícitos para regras financeiras.
2. Não armazenar dados de cartão.
3. Webhooks devem ser idempotentes.
4. Toda rota administrativa valida RBAC.
5. Toda alteração de pagamento/inscrição/repasse gera AuditLog.
6. Valores monetários em centavos inteiros (nunca float).
7. Não expor CPF, telefone ou e-mail em páginas públicas.
8. Toda feature relevante inclui teste.

## Definition of Done
- Código compila
- Lint passa
- Testes passam
- Migrações incluídas
- Sem secrets hardcoded
