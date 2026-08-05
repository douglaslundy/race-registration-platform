# `messageType` no log de mensagens (Etapa 5, menor incremento) — Design

## Contexto

Etapa 5 do mega-prompt de 10 etapas ("Logs/auditoria de envio"), hoje marcada como PARCIAL em
`IMPLEMENTATION_PLAN.md` — falta "versão de template e retry". Investigação de um bug reportado
pelo usuário ("teste de WhatsApp não chega") revelou o problema real de raiz — página do editor de
template não indicava qual canal estava sendo editado (já corrigido, commit `c3611cd`) — mas
também expôs uma limitação de verdade do sistema de auditoria: `MessageLog`
(`prisma/schema.prisma`) grava `channel`/`subject`/`recipientAddress`/`status`/etc, mas **não tem
nenhuma referência a qual alerta ou fluxo do sistema gerou aquele envio**. Pra saber se um envio
específico foi do alerta `LOW_STOCK`, `DAILY_SUMMARY`, ou um e-mail transacional de redefinição de
senha, hoje só dá pra inferir lendo o texto do `subject` — frágil e nada consultável.

Esta é a menor tarefa bem definida entre as pendências (Etapa 4 — novos alertas — depende de
decidir quais alertas criar antes de ter qualquer tamanho; a parte de "retry automático" da própria
Etapa 5 precisa de uma fila/cron nova, maior). Escopo confirmado com o usuário: cobre **todo** envio
de e-mail/WhatsApp do sistema, não só os alertas configuráveis em `/admin/alertas` — inclui também
os transacionais (redefinição de senha, convite de assistente, etc), que hoje aparecem misturados
com os alertas na mesma tela `/admin/mensagens` sem nenhuma forma de filtrar por tipo.

## O que muda

### Schema

`MessageLog` ganha uma coluna nova, `messageType String?` — nullable, já que os registros
existentes não têm como ser preenchidos retroativamente (não dá pra adivinhar o tipo confiável só
pelo `subject` — é justamente o problema que esta mudança resolve). Índice novo
`@@index([messageType, createdAt])`, mesmo padrão do índice já existente por `channel`. Migração
aditiva simples via `prisma db push`, sem dado histórico a migrar.

### Nomenclatura: `messageType`, não `alertKey`

O tipo `AlertKey` já existe em `lib/templates/registry.ts` e cobre só os ~11 alertas configuráveis
(`LOW_STOCK`, `DAILY_SUMMARY`, etc). Como o escopo desta mudança é maior (cobre também
transacionais, que não têm entrada no `ALERT_REGISTRY`), o campo novo usa um nome distinto,
`messageType: string` (string livre, não o union type `AlertKey`), pra não sugerir incorretamente
que só aceita valores do registry.

Valores usados:
- **Para os alertas configuráveis**: reaproveita o mesmo valor de `AlertKey` já usado em
  `getEffectiveTemplate(alertKey, ...)` — cada uma das 9 funções em `lib/email.ts` que já resolve
  um template (`sendLowStockEmail`, `sendAbandonedCartEmail`, `sendPaymentErrorEmail`,
  `sendReconciliationMismatchEmail`, `sendCancellationRequestedEmail`,
  `sendAdvertiserRequestPendingEmail`, `sendDailySummaryEmail`, `sendEventDailySummaryEmail`,
  `sendRegistrationConfirmationEmail` — esta última já recebe `alertKey` como parâmetro) já tem essa
  chave em escopo, uma linha antes da chamada a `sendMail`. Os call sites de WhatsApp em
  `lib/alerts/*.ts`/`lib/notifications.ts` seguem o mesmo padrão (já chamam
  `getEffectiveTemplate(alertKey, "WHATSAPP", ...)` antes de montar o texto).
- **Para os 7 fluxos transacionais sem alerta configurável**: chaves novas, só pra classificação —
  `PASSWORD_RESET`, `ASSISTANT_INVITE`, `PROXY_REGISTRATION_INVITE`, `AD_PURCHASE_CONFIRMATION`,
  `ADVERTISER_PROMOTION`, `ADVERTISER_REQUEST_APPROVED`, `ADVERTISER_REQUEST_REJECTED` — uma por
  função em `lib/email.ts` que hoje monta o e-mail direto em HTML sem passar por
  `getEffectiveTemplate` (`sendAdPurchaseConfirmationEmail`, `sendPasswordResetEmail`,
  `sendAssistantInviteEmail`, `sendProxyRegistrationInviteEmail`, `sendAdvertiserPromotionEmail`,
  `sendAdvertiserRequestApprovedEmail`, `sendAdvertiserRequestRejectedEmail`).

`sendTestEmail()` (teste de conexão SMTP em Admin → Configurações) fica de fora — não passa por
`sendMail()`, usa o transporter Nodemailer direto, nunca gravou log nenhum. Nada a mudar ali.

### Assinaturas

- `sendMail(opts: { to, subject, html, attachments?, relatedEntityType?, relatedEntityId?,
  messageType: string })` — `messageType` vira campo obrigatório do objeto de opções.
- `sendWhatsAppMessage(phone: string, text: string, messageType: string, options?: {
  relatedEntityType?, relatedEntityId? })` — `messageType` vira 3º parâmetro posicional
  obrigatório (não dentro de `options`, de propósito: um parâmetro obrigatório força o
  TypeScript a recusar compilar qualquer call site não atualizado, garantindo que nenhum dos ~18
  pontos de chamada fica esquecido silenciosamente).
- `recordMessageLog(params: RecordMessageLogParams)` ganha `messageType?: string` (opcional aqui,
  já que é a única função que também precisa continuar aceitando chamadas sem esse campo em
  cenários futuros de manutenção — mas `sendMail`/`sendWhatsAppMessage`, os dois únicos chamadores
  reais hoje, sempre o preenchem).

### `MESSAGE_TYPE_LABEL`

Mapa novo em `lib/message-logs.ts` (mesmo arquivo de `MessageLogFilters`/`RecordMessageLogParams` —
decisão do usuário, sem criar arquivo novo só pra uma constante), com os 18 valores (11 de alerta +
7 transacionais) mapeados pro rótulo em português usado na tela:

```ts
export const MESSAGE_TYPE_LABEL: Record<string, string> = {
  LOW_STOCK: "Vagas se esgotando",
  ABANDONED_CART: "Carrinho abandonado",
  PAYMENT_ERROR: "Erro de pagamento",
  RECONCILIATION_MISMATCH: "Divergência de conciliação",
  CANCELLATION_REQUESTED: "Solicitação de cancelamento",
  ADVERTISER_REQUEST_PENDING: "Solicitação de anunciante pendente",
  DAILY_SUMMARY: "Resumo diário",
  DAILY_SUMMARY_EVENT: "Resumo diário do evento",
  ORDER_CONFIRMED: "Confirmação de inscrição",
  ORDER_CONFIRMED_PROXY_BUYER: "Confirmação de inscrição (procuração — comprador)",
  ORDER_CONFIRMED_PROXY_ATHLETE: "Confirmação de inscrição (procuração — atleta)",
  PASSWORD_RESET: "Redefinição de senha",
  ASSISTANT_INVITE: "Convite de assistente",
  PROXY_REGISTRATION_INVITE: "Convite de inscrição por procuração",
  AD_PURCHASE_CONFIRMATION: "Confirmação de compra de anúncio",
  ADVERTISER_PROMOTION: "Promoção a anunciante",
  ADVERTISER_REQUEST_APPROVED: "Solicitação de anunciante aprovada",
  ADVERTISER_REQUEST_REJECTED: "Solicitação de anunciante rejeitada",
};
```

### UI

`/admin/mensagens` e `/organizador/mensagens` (mesmo componente `MessageLogList`, formulário de
filtro próprio em cada `page.tsx`, mesmo padrão dos filtros de canal/status já existentes) ganham:
- Um `<select name="type">` com `Object.entries(MESSAGE_TYPE_LABEL)` como opções + "Todos".
- Uma coluna "Tipo" em `MessageLogList.tsx`, mostrando `MESSAGE_TYPE_LABEL[row.messageType] ??
  "Desconhecido"` — registros antigos (sem `messageType`) mostram "Desconhecido", não quebram nem
  somem da lista.

`listMessageLogs()` (`lib/message-logs.ts`) ganha `messageType?: string` em `MessageLogFilters`,
aplicado no `where` do Prisma do mesmo jeito que `channel`/`status` já são hoje (`AND` implícito via
spread do objeto `where`, mesmo padrão).

## Casos de borda

- Registros já gravados antes desta mudança: `messageType: null`, mostram "Desconhecido" na tela,
  não entram em nenhum filtro específico de tipo (só aparecem quando o filtro está em "Todos").
- `sendTestEmail()`: fora do escopo, não passa por `sendMail()`.
- Nenhuma mudança de comportamento de envio (texto, destinatário, retry, etc) — é estritamente
  metadado a mais no log já existente.

## Testes

Os testes existentes que verificam chamadas a `sendMail`/`sendWhatsAppMessage` (diretamente ou via
mock) — nos arquivos de `lib/alerts/*.ts`, `lib/notifications.ts`,
`app/api/admin/ads/private/[id]/send-report/route.ts` e seus respectivos `tests/*.test.ts` —
precisam do `messageType` a mais nas asserções de chamada (`toHaveBeenCalledWith(...)`), mecânico,
sem lógica nova a testar. `lib/message-logs.ts` ganha teste novo (ou estende o existente, se houver)
cobrindo: `messageType` é persistido corretamente por `recordMessageLog`; `listMessageLogs` filtra
por `messageType` corretamente, incluindo o caso `null`/"Desconhecido".

## Critérios de aceite

- Todo envio novo de e-mail/WhatsApp do sistema (os 11 alertas configuráveis + os 7 transacionais)
  grava `messageType` no `MessageLog`.
- `/admin/mensagens` e `/organizador/mensagens` mostram a coluna "Tipo" e permitem filtrar por ele.
- Registros antigos (sem `messageType`) continuam aparecendo normalmente, rotulados "Desconhecido".
- `sendTestEmail()` inalterado.
- Suíte completa + `tsc --noEmit` + `npm run build` limpos, mesma exigência de sempre.
