# TODO para retomada

## Lote de tarefas atual (12 itens)

### Fase 1 — Correções rápidas (sem migração)
- [x] **T1** Lote grátis (valor 0): `priceAmount` agora `.nonnegative()` na rota POST e PATCH; front exibe erro no submit.
- [x] **T2** Dark mode "Lote esgotado": adicionadas variantes `dark:` no badge (`lotes/page.tsx`) e no status do detalhe admin.
- [x] **T4** Páginas centralizadas (`mx-auto`) + `REGISTRATIONS_OPEN` traduzido (corrigido em `SetPlatformFeeForm` e via `EVENT_STATUS_LABEL` completo).
- [x] **T6** Status do admin (lista + detalhe) usando `EVENT_STATUS_LABEL` em português.
- [x] **T8** Modalidade em português via `MODALITY_LABEL` na página pública e no detalhe admin.
- [x] **T11** `lib/checkout.ts` exige percurso/categoria quando o evento os possui (validação no servidor + UX no front). Testes adicionados.

### Fase 2 — Cupons (migração)
- [x] **T9** Página `/admin/cupons` com rastreamento: desconto concedido por código (pedidos pagos), criador, e em quais eventos foi aplicado (detalhe por evento para cupons globais).
- [x] **T10** Admin cria cupom global (`eventId` nulo) ou por evento. API `/api/admin/coupons` + checkout/preview reconhecem cupom global.
- ⚠️ **Migração** `20260620000000_coupons_global_and_creator` criada mas NÃO aplicada (banco Supabase inacessível). Aplicar com `prisma migrate deploy` quando o banco voltar.

### Fase 3 — E-mail / SMTP
- [x] **T3** `lib/email.ts` + `lib/smtp-settings.ts` + `lib/notifications.ts`; card SMTP em `/admin/configuracoes` com botão de teste; confirmação enviada no checkout, webhook e polling de status.
- [x] **T5** `forgot-password`/`reset-password` reescritos (bug do token literal "reset" corrigido) usando o SMTP configurado.

### Fase 4 — Relatórios
- [x] **T7** Card "Eventos do organizador" em `/admin/usuarios/[id]`: total/concluídos/em andamento/cancelados.

### Fase 5 — Análise
- [ ] **T12** Login Google: relatório de viabilidade entregue (ver resumo da sessão). Viável e de baixo esforço (NextAuth v5 + PrismaAdapter + modelos Account/Session já prontos). Requisitos: projeto Google Cloud, OAuth Client ID, tela de consentimento, redirect URI `…/api/auth/callback/google`, envs `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. Deixado para depois.

> ⚙️ **Preferência:** SEMPRE perguntar se o usuário quer implementar antes de codar tarefas/etapas — não implementar sem confirmação explícita.

## Regras mantidas
- Não reintroduzir seed de eventos automáticos sem aprovação explícita.
- Não armazenar cartão nem dados sensíveis.
- Não apagar evento com inscrições/pedidos vinculados.

## Histórico (já corrigido)
- Upload de banner migrado para `presign` no front.
- Botão de exclusão de evento na UI do organizador; `DELETE /api/events/[id]` só remove sem dependências.
- Remoção do seed automático do evento exemplo.
