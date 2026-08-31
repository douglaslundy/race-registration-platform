# Relatório — correção das falhas de segurança (auditoria 2026-08-31)

Branch: `fix/security-audit-2026-08-31` (a partir de `main` @ `d6a6558`).
Range de commits: `45c3e46..335096e` (22 commits, 1 por falha).

## Tabela

| Falha | Status | Commit(s) | Teste | Nota |
|---|---|---|---|---|
| C1 — replay de confirmação em `mp-return` | FIXED | `45c3e46` | `tests/payments-mp-return-route.test.ts` | Opção (a): a rota virou só redirect. Nenhuma escrita no banco a partir do `payment_id` da query. Confirmação real fica com webhook + cron + `PaymentStatusPoller` (todos usam o `providerPaymentId` armazenado). |
| H1 — cupom PERCENT do organizador sem teto | FIXED | `11fa1f8` | `tests/event-coupons-route.test.ts`, `tests/unit/checkout-coupon.test.ts` | Schema: `int().positive()` + `.refine(<=100)` pra PERCENT. `lib/checkout.ts` clampa `discountAmount` em `[0, batch.priceAmount]` pros dois tipos. UI `CuponsClient` com `max=100` + validação client-side. |
| H2 — manifesto da assinatura do webhook MP errado | FIXED | `c251541` | `tests/payment-webhook-signature.test.ts`, `tests/payment-mercadopago-account.test.ts` | Manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (com `;` final), `x-request-id` vindo dos 2 handlers de webhook. `JSON.parse` do payload em try/catch → `false` em corpo não-JSON. |
| M1 — `admin/users/[id]` sem 2FA em role/active/senha | FIXED | `f7eea45` | `tests/admin-users-route.test.ts` | `verify2faBody` (action `USER_SECURITY_CHANGE`) quando role/active/senha mudam vs. valor atual. Rota `request-code` nova. Fluxo de código em `UserForm`, `ChangeUserRoleButton`, `ToggleUserActiveButton` (`CodeVerificationModal`). Nome/e-mail seguem sem 2FA. |
| M2 — mudança de status de repasse sem 2FA | FIXED | `373532c` | `tests/admin-payout-status-route.test.ts`, `tests/admin-event-payouts-create-route.test.ts` | `verify2faBody` (action `PAYOUT_STATUS_CHANGE`) no PATCH de status e no POST de geração de repasse. `request-code` nova pra cada. UI: `UpdatePayoutStatusButton`, `GeneratePayoutButton`. |
| M3 — força-bruta / enumeração no login | PARTIAL | `18beb06` | `tests/unit/auth-rate-limit.test.ts` | Feito: chave de rate-limit por e-mail em lowercase; `bcrypt.compare` dummy no caminho de usuário inexistente (elimina o oráculo de timing); limite dedicado `LOGIN` (5/min). **DEFERIDO** (mudança arquitetural): store de rate-limit persistente (Postgres/Redis) e lockout/backoff temporário por conta. |
| M4 — `admin/settings` só validado no cliente | FIXED | `8aefab8` | `tests/admin-settings-route.test.ts` | `lib/settings-keys.ts`: whitelist (set explícito + prefixos conhecidos `legal.`/`mp_`/`alert_`/…), rejeita chave desconhecida; chaves numéricas exigem inteiro em range; chaves de URL (`whatsapp_api_url`, `storage_endpoint`, `storage_public_url`) exigem https + host não-privado. |
| M5 — `checkMPPaymentStatus` sem binding | FIXED | `cce5d99` | `tests/check-mp-status.test.ts`, `tests/order-status-alerts.test.ts` | Assinatura nova exige `{ expectedOrderId, expectedAmount }`; só retorna `"PAID"` se `external_reference` e `transaction_amount*100` casarem. Chamador `orders/[id]/status` ajustado. |
| M6 — `POST /api/anunciante/solicitar` sem anti-abuso | PARTIAL | `28b7bbf` | `tests/anunciante-solicitar-route.test.ts` | Feito: rate-limit por IP (sempre) e por e-mail (solicitação anônima) + checagem de MX no domínio (reusa `hasValidMxRecord`). **FORA DE ESCOPO** (documentado): CAPTCHA. |
| M7 — endpoints de clique/impressão de anúncio sem rate-limit | FIXED | `fbc5234` | `tests/ads-click-route.test.ts`, `tests/ads-click-house-route.test.ts` | `lib/ads/abuse-guard.ts`: `shouldCountAdClick` (ignora prefetch via `Sec-Purpose`/`Purpose` + dedupe IP+anúncio 30s) e `shouldCountAdImpression` (dedupe IP+slot 60s). Redirect do clique continua sempre. `AdSlotRenderer` só conta 1 impressão por IP+slot/janela. |
| M8 — filtro SSRF de `validate-url` burlável | PARTIAL | `b634174` | `tests/lib-validate-url.test.ts` | Feito: normaliza IPv4 numérico (decimal/hex/octal, 1–4 campos) antes de testar; bloqueia IPv6 ULA `fc00::/7`, link-local `fe80::/10`, IPv4-mapeado (`::ffff:` pontuado e hex), `0.0.0.0/8`, CGNAT `100.64/10`; rejeita userinfo (`user:pass@`/`metadata@host`). **DEFERIDO**: resolução de DNS em runtime / anti-DNS-rebinding — a `targetUrl` é armazenada e usada como `Location` de redirect, não fetch server-side. |
| M9 — `change-password` sem rate-limit / sem invalidação de sessão | FIXED | `b9beb99` | `tests/change-password-route.test.ts`, `tests/unit/auth-jwt-refresh.test.ts` | `checkRateLimit` por usuário+IP; migração aditiva `users.passwordChangedAt` (`DateTime?`); callback `jwt` invalida (`active=false`) token com `iat < passwordChangedAt`; e-mail "sua senha foi alterada" (`sendPasswordChangedEmail`). |
| L1 — tokens de reset em claro | FIXED | `ea87499` | `tests/reset-password-route.test.ts` | `lib/auth/verification-token.ts`: guarda `sha256(token)` no banco, link leva o valor bruto. Aplicado nos 3 pontos de criação (forgot-password, convite de assistente, convite de procuração) e na verificação (reset-password). |
| L2 — secret do webhook Evolution na query, compare `!==` | FIXED | `3a93469` | `tests/whatsapp-webhook-route.test.ts`, `tests/admin-whatsapp-routes.test.ts` | Aceita `x-webhook-secret` no header (query `?secret=` mantida só como fallback de transição) + `crypto.timingSafeEqual`. `setWebhook` registra o segredo como header no Evolution. |
| L3 — `POST /api/upload` sem quota | FIXED | `3222a21` | `tests/upload-route.test.ts` | Só `ADMIN`/`ORGANIZER`/`ASSISTANT` (os purposes são de gestão de evento) + `RATE_LIMITS.UPLOAD` (20/min por usuário). |
| L4 — checkout devolve texto cru do gateway | FIXED | `a3c4e77` | (coberto por `tests/checkout-route.test.ts` — nenhum teste assertava o texto) | Erro do gateway só no log; cliente recebe 502 com mensagem fixa. |
| L5 — internals do zod vazando pro cliente | FIXED | `888fef8` | `tests/register-route.test.ts`, `tests/reset-password-route.test.ts`, `tests/event-update-route.test.ts` | `lib/http/zod-error.ts`: `zodErrorResponse()` → 400 `{ error: "Dados inválidos" }`, detalhe só no log (dev). Aplicado em `auth/register`, `auth/reset-password`, `events/[id]` PATCH. |
| L6 — DNS lookup por tentativa em `register` | FIXED | `ccb12a0` | `tests/validate-email-domain.test.ts` | Timeout 4000→2500ms + cache por domínio (positivo 1h, negativo 10min, teto 2000). |
| L7 — oráculo nas mensagens do verify 2FA | FIXED | `90dec3e` | `tests/lib-sensitive-action-verification.test.ts` | Mesma mensagem ("expirado ou inválido") pra id desconhecido e código errado. |
| L8 — `audit/pageview` gravável em spam | FIXED | `d2e3c65` | `tests/audit-pageview-route.test.ts` | `checkRateLimit` 60/min por usuário; sob limite responde 200 sem gravar. |
| L9 — campos de texto livre sem `.max()` | FIXED | `98c2412` | (coberto pelos testes das rotas afetadas) | `.max()`/`slice` em daily-summary-recipients name(120)/value(320), cancel reason(1000), organizer refund reason(1000), manual-confirm reason(1000), reject reason (ads/anunciantes, 1000). |
| L10 — `admin/backup/import` sem validação de linha | PARTIAL | `335096e` | `tests/backup-import-route.test.ts` | Feito: `validateRows()` — cada chave de tabela precisa ser lista; linhas de `users` (id/email/role, role só papel conhecido) e `paymentAccounts` (id/label/accessToken) validadas com zod antes do 2FA/transação. **DEFERIDO**: schemas zod completos por-tabela (20 tabelas) e a decisão de não-restaurar `passwordHash`/credenciais de `paymentAccount` — a restauração real precisa delas e o import já é ADMIN + 2FA. |

## Resumo por status

- **FIXED**: C1, H1, H2, M1, M2, M4, M5, M7, M9, L1, L2, L3, L4, L5, L6, L7, L8, L9 (18)
- **PARTIAL** (parte segura feita, resto documentado): M3, M6, M8, L10 (4)
- **DEFERRED total**: nenhum

## Itens deferidos (detalhe)

1. **M3** — store de rate-limit persistente (Postgres/Redis) + lockout/backoff temporário por conta. É mudança de arquitetura (o rate-limit hoje é um `Map` em memória por worker). O oráculo de timing e a multiplicação de orçamento por caixa foram fechados; o limite foi apertado (5/min).
2. **M6** — CAPTCHA no cadastro de anunciante. Rate-limit + MX cobrem spam automatizado básico; CAPTCHA exige provider externo e mudança de UX.
3. **M8** — resolução de A/AAAA em runtime / pin de IP contra DNS rebinding. As URLs validadas são armazenadas e servidas como `Location` de redirect (não há fetch server-side da `targetUrl`), então o risco residual é baixo. As formas de bypass estáticas (IP numérico, IPv6 ULA/link-local/mapeado, userinfo) foram fechadas.
4. **L10** — schemas zod completos por-tabela e política de não-restaurar segredos. Validação de shape das tabelas sensíveis (`users`, `paymentAccounts`) + garantia de tipo-lista foi feita; o resto é volume (20 tabelas) com risco residual baixo (ADMIN + 2FA).

## Migração de banco

`prisma/migrations/20260831000000_add_user_password_changed_at/migration.sql` — aditiva, coluna nullable `users.passwordChangedAt TIMESTAMP(3)`. Precisa de `prisma migrate deploy` (ou `db push`) no deploy.

## Gate final

- `npx vitest run` (suíte inteira): **292 arquivos / 2293 testes — todos verdes**
- `npx tsc --noEmit`: **limpo**
- `npm run build`: **exit 0** (build completo, sem erros)
