# Notificação em pedidos órfãos + índices de performance + tooltip + filtro nos KPIs

## Contexto

Quatro itens pedidos pelo usuário em 2026-07-13, depois do deploy da leva anterior (validação de
e-mail + Recharts + layout). Investigação (3 buscas paralelas) encontrou a causa raiz de cada um:

1. **Botão de notificação ausente em pedidos órfãos cancelados**: o botão "reenviar notificação"
   (`components/registrations/ResendPaymentNotificationButton.tsx`) nas páginas de inscritos do
   admin/organizador só aparece quando existe um `Payment` com status `EXPIRED`/`CANCELLED`
   (`app/admin/eventos/[id]/inscritos/page.tsx:269`, mesma linha equivalente no organizador). Os
   pedidos cancelados por `cancelAbandonedOrder` (tarefa de hoje, "pedidos órfãos") nunca tiveram
   nenhum `Payment` — o botão nem aparece, e mesmo se aparecesse, a rota por trás
   (`resend-payment-notification/route.ts:30-32`) e `notifyPaymentError`
   (`lib/alerts/payment-error.ts:18-28`) exigem um `Payment` pra buscar comprador/evento — não há
   caminho hoje que resolva essa informação a partir só do `Order`.
2. **Lentidão navegando**: duas causas prováveis, ambas resolvidas com índices ausentes — (a)
   `AuditLog` não tem índice em `createdAt`, mas é ordenada por `createdAt` tanto no "Atividade
   recente" do dashboard admin quanto em `/admin/auditoria`, e cresce a cada navegação (o
   `PageViewLogger` grava uma linha por navegação); (b) as 3 funções de
   `lib/dashboard-metrics.ts` buscam todas as linhas de `User`/`Registration`/`Order` filtradas por
   `createdAt` sem nenhum índice nesse campo em nenhuma das três tabelas — rodam em toda visita ao
   dashboard.
3. **Tooltip do gráfico mostra "value" genérico**: Recharts usa o `dataKey` (`"value"`) como nome
   da série no tooltip por padrão — a prop `name` do componente `<Line>` sobrescreve isso.
4. **Filtro só afeta o gráfico, não os cards de KPI**: confirmado — os cards de KPI dos dois
   dashboards usam contagens de todo o histórico, sem nenhum filtro de data. Usuário confirmou:
   os cards passam a refletir só o período filtrado (substituindo o total geral, não somando um
   segundo número), e o filtro sobe pro topo da página, acima dos cards.

## 1. Notificação em pedidos órfãos

### 1a. `lib/alerts/payment-error.ts` — extrair lógica compartilhada, adicionar caminho por `Order`

Refatora `notifyPaymentError` pra reaproveitar uma função interna compartilhada
(`sendCancellationInviteNotification`), e adiciona `notifyOrderCancelledWithoutPayment` —
mesmo texto de e-mail/WhatsApp, mesma configuração (`getPaymentErrorAlertSettings`, o mesmo
toggle já usado pelo caminho existente — é conceitualmente o mesmo tipo de alerta, só o gatilho
técnico muda), `entityType: "Order"` no lugar de `"Payment"` (mantém o `AlertLog` distinguível):

```ts
async function sendCancellationInviteNotification(params: {
  entityId: string;
  entityType: "Payment" | "Order";
  buyer: { name: string; email: string; athleteProfile: { phone: string | null } | null };
  event: { title: string; slug: string };
  bypassDedupe?: boolean;
}): Promise<void> {
  const settings = await getPaymentErrorAlertSettings();
  if (!settings.emailEnabled && !settings.whatsappEnabled) return;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "";
  const eventUrl = `${baseUrl}/eventos/${params.event.slug}`;

  if (settings.emailEnabled) {
    const cfg = await getSmtpConfig();
    if (isSmtpReady(cfg)) {
      const claimed = params.bypassDedupe ? true : await claimAlert(ALERT_TYPE, params.entityType, params.entityId, "EMAIL");
      if (claimed) {
        try {
          await sendPaymentErrorEmail({ to: params.buyer.email, name: params.buyer.name, eventTitle: params.event.title, eventSlug: params.event.slug });
        } catch (err) {
          if (!params.bypassDedupe) await unclaimAlert(ALERT_TYPE, params.entityId, "EMAIL");
          throw err;
        }
      }
    }
  }

  if (settings.whatsappEnabled && params.buyer.athleteProfile?.phone) {
    const claimed = params.bypassDedupe ? true : await claimAlert(ALERT_TYPE, params.entityType, params.entityId, "WHATSAPP");
    if (claimed) {
      try {
        await sendWhatsAppMessage(
          params.buyer.athleteProfile.phone,
          `Sua inscrição em "${params.event.title}" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: ${eventUrl}`,
        );
      } catch (err) {
        if (!params.bypassDedupe) await unclaimAlert(ALERT_TYPE, params.entityId, "WHATSAPP");
        throw err;
      }
    }
  }
}

export async function notifyPaymentError(paymentId: string, options?: { bypassDedupe?: boolean }): Promise<void> {
  try {
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
      select: {
        order: {
          select: {
            event: { select: { title: true, slug: true } },
            buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
          },
        },
      },
    });
    if (!payment) return;
    await sendCancellationInviteNotification({
      entityId: paymentId,
      entityType: "Payment",
      buyer: payment.order.buyer,
      event: payment.order.event,
      bypassDedupe: options?.bypassDedupe,
    });
  } catch (err) {
    console.error("[notifyPaymentError] failed:", err);
  }
}

export async function notifyOrderCancelledWithoutPayment(orderId: string, options?: { bypassDedupe?: boolean }): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        event: { select: { title: true, slug: true } },
        buyer: { select: { name: true, email: true, athleteProfile: { select: { phone: true } } } },
      },
    });
    if (!order) return;
    await sendCancellationInviteNotification({
      entityId: orderId,
      entityType: "Order",
      buyer: order.buyer,
      event: order.event,
      bypassDedupe: options?.bypassDedupe,
    });
  } catch (err) {
    console.error("[notifyOrderCancelledWithoutPayment] failed:", err);
  }
}
```

`notifyPaymentError`'s external behavior (signature, messages, dedupe keys) is byte-identical to
today — pure internal refactor for that function, purely additive for the new one.

### 1b. Reuse the SAME route and button — no new endpoint, no new component

`app/api/admin/registrations/[id]/resend-payment-notification/route.ts` and its organizer
equivalent gain a second branch: if there's no `Payment` row but the registration itself is
`CANCELLED`, call the new order-based notifier instead of 400-ing:

```ts
  const registration = await db.registration.findFirst({
    where: { id },
    select: {
      status: true,
      orderId: true,
      order: {
        select: {
          payments: { where: { status: { in: ["EXPIRED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!registration) {
    return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const payment = registration.order.payments[0];

  if (payment) {
    await notifyPaymentError(payment.id, { bypassDedupe: true });
    await db.auditLog.create({
      data: { userId: session.user.id, action: "PAYMENT_ERROR_NOTIFICATION_RESENT", entityType: "Payment", entityId: payment.id, metadata: { registrationId: id } },
    });
    return NextResponse.json({ success: true });
  }

  if (registration.status === "CANCELLED") {
    await notifyOrderCancelledWithoutPayment(registration.orderId, { bypassDedupe: true });
    await db.auditLog.create({
      data: { userId: session.user.id, action: "PAYMENT_ERROR_NOTIFICATION_RESENT", entityType: "Order", entityId: registration.orderId, metadata: { registrationId: id } },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Nenhum pagamento expirado/cancelado encontrado para esta inscrição" }, { status: 400 });
```

(Organizer route identical, plus its existing `organizerId` scoping on the registration lookup —
unchanged.)

### 1c. UI gating — show the button for the orphan case too

`app/admin/eventos/[id]/inscritos/page.tsx:269` and the organizer equivalent, change:

```tsx
{(payment?.status === "EXPIRED" || payment?.status === "CANCELLED") && (
```

to:

```tsx
{((payment?.status === "EXPIRED" || payment?.status === "CANCELLED") || (r.status === "CANCELLED" && !payment)) && (
```

No change to the button component itself or the endpoint prop passed to it — same button, same
URL, the route now just handles both cases.

## 2. Índices de performance

Adiciona `@@index([createdAt])` em `AuditLog`, `User`, `Registration`, `Order` — migração
aditiva, sem risco de perda de dado, mesmo padrão de todas as migrações desta sessão:

```prisma
model AuditLog {
  // ...campos existentes...
  @@index([createdAt])
}

model User {
  // ...campos existentes...
  @@index([createdAt])
}

model Registration {
  // ...campos existentes...
  @@index([createdAt])
}

model Order {
  // ...campos existentes...
  @@index([createdAt])
}
```

Fora de escopo: mudar a frequência/lógica do `PageViewLogger` (grava uma linha de `AuditLog` por
navegação) — o índice já resolve o sintoma reportado (consultas lentas); reduzir o volume de
gravação seria uma otimização separada, não pedida.

## 3. Label personalizado no tooltip do gráfico

`components/ui/LineChart.tsx` ganha uma prop `name` opcional, repassada pro `<Line>`:

```tsx
export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 260,
  name,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
  name?: string;
}) {
  // ...
  <Line type="monotone" dataKey="value" name={name} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
  // ...
}
```

Cada chamada em `app/admin/page.tsx`/`app/organizador/page.tsx` ganha o `name` correspondente ao
card onde está: `"Novos cadastros"`, `"Inscrições"`, `"Cupons utilizados"` — os mesmos textos que
já aparecem no `<h2>` de cada card, só repetidos como prop.

## 4. Filtro no topo + KPIs escopados ao período

Decisão confirmada com o usuário: os cards de KPI passam a mostrar só o total do período
filtrado (substitui o total geral, não soma um segundo número). Mesma mudança nos dois
dashboards (`app/admin/page.tsx`, `app/organizador/page.tsx`):

- **Reordenar**: o formulário de filtro (`de`/`ate`/`eventId`) sobe pra logo abaixo do `<h1>`,
  antes dos cards de KPI — precisa que `from`/`to`/`events`/`chartEvents` já estejam calculados
  antes de renderizar os cards (só reordena o JSX, o cálculo de datas já acontece cedo no
  componente).
- **Admin**: as 4 queries do primeiro grid de KPIs (`totalUsers`, `totalEvents`, `totalOrders`,
  `revenue`) e as 3 do segundo grid (`confirmedRegistrations`/`pendingRegistrations`/
  `cancelledRegistrations`) ganham `createdAt: { gte: from, lte: to }` — mesma base de tempo
  (`createdAt`) já usada pelos gráficos na mesma página, pra não repetir o erro de "duas
  definições diferentes pro mesmo número" já visto nesta sessão. Os 3 cards de inscrições também
  ganham o filtro `eventId` quando selecionado (mesmo escopo que já vale pro gráfico de
  inscrições) — `totalUsers`/`totalEvents`/`totalOrders`/`revenue` continuam sem escopo de
  `eventId` (não fazem sentido por evento, mesma decisão já tomada pro gráfico de cadastros/
  cupons).
- **Organizador**: mesma lógica — `eventCount`, `totalRegistrations`, `revenueAgg` e os 3 cards de
  status de inscrição ganham `createdAt` no período; os 3 cards de status também ganham `eventId`
  quando selecionado.
- **Labels**: cards que mudam de "total geral" pra "no período" ganham o texto ajustado —
  "Usuários" → "Novos usuários", "Eventos" → "Novos eventos", "Pedidos pagos" → "Pedidos pagos no
  período", "Receita" → "Receita no período", "Total de inscrições" (organizador) → "Inscrições no
  período" — pra não confundir quem já está acostumado com os números antigos.

## Testes

- `lib/alerts/payment-error.ts`: `tests/alert-payment-error.test.ts` (já existe) ganha testes pra
  `notifyOrderCancelledWithoutPayment` espelhando os já existentes de `notifyPaymentError` (e-mail
  ok, WhatsApp ok, sem telefone, dedupe claim/unclaim) — mesma cobertura, `entityType: "Order"` no
  lugar de `"Payment"`. Os testes existentes de `notifyPaymentError` precisam continuar passando
  sem alteração (comportamento externo idêntico após o refactor).
- Rotas `resend-payment-notification` (admin e organizador): estender os testes existentes com o
  caso "sem payment, registration CANCELLED" (chama `notifyOrderCancelledWithoutPayment`, grava
  auditoria com `entityType: "Order"`) e confirmar que o caso "sem payment e registration não
  CANCELLED" continua retornando 400 como antes.
- Sem teste para os índices (migração pura) nem para `LineChart.tsx`/páginas (convenção já
  estabelecida nesta sessão — presentational/páginas sem teste dedicado).

## Fora de escopo

- Reduzir a frequência de gravação do `PageViewLogger` — o índice já resolve o sintoma relatado.
- Adicionar um segundo número (total geral) nos cards de KPI — decisão do usuário foi substituir,
  não somar.
- Mudar o que o filtro `eventId` afeta além do que já afeta hoje (`registrationsData` + agora os 3
  cards de status de inscrição) — cadastros/cupons continuam sempre "toda a plataforma".
