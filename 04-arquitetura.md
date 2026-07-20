# Arquitetura Recomendada

## Stack sugerida para MVP
- Frontend: Next.js + TypeScript + Tailwind
- Backend: Next.js API routes ou NestJS
- Banco: PostgreSQL
- ORM: Prisma
- Autenticação: Auth.js ou Clerk/Supabase Auth
- Pagamentos: Mercado Pago, Pagar.me, Stripe ou Asaas, conforme operação no Brasil
- Storage: S3 compatível
- E-mail: Resend, Postmark ou AWS SES
- Fila: BullMQ + Redis ou serviço gerenciado
- Deploy: VPS própria (Docker + Traefik), sem serviços de deploy gerenciado de terceiros

## Módulos
1. Public Site
2. Auth
3. Event Management
4. Registration
5. Checkout
6. Payment Webhooks
7. Organizer Dashboard
8. Admin Console
9. Results
10. Reporting
11. Notifications
12. Audit

## Decisão técnica
Para começar rápido com Codex, prefira monorepo Next.js:
- /app: rotas públicas e dashboards
- /components: UI
- /lib: regras de negócio
- /prisma: schema e migrations
- /tests: testes
- /docs: documentação do produto

## Segurança
- RBAC obrigatório.
- Webhook com assinatura verificada.
- Idempotência em pagamentos.
- Logs sem dados sensíveis.
- Proteção contra enumeração de inscrições.
- Rate limiting em auth, checkout e webhook.
