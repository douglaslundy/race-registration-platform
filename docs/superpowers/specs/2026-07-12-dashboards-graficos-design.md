# Dashboards admin e organizador com gráficos de linha

## Contexto

Sexto e último dos sub-projetos "rápidos" pedidos pelo usuário nesta sessão (carrinhos
abandonados ✅ → filtros/resumo no evento ✅ → resultados/import CSV ✅ → expiração de pagamentos ✅
→ repasse ao organizador ✅ → **este**). Depois deste, o próximo passo do plano original é perguntar
sobre deploy antes de iniciar o sistema de rating (que tem seu próprio processo de pesquisa +
autorização).

Ao contrário do que a memória de sessão indicava, `app/admin/page.tsx` e `app/organizador/page.tsx`
**já existem** — ambos têm cards de KPI e tabelas. A lacuna real é: **nenhum gráfico de linha em
lugar nenhum do app**, e não há nenhuma biblioteca de gráficos instalada. Usuário confirmou:
componente SVG próprio (sem dependência nova) e período padrão de 30 dias com filtro de data.

## 1. `components/ui/LineChart.tsx` — componente novo, sem dependência

Server component (sem interatividade — sem tooltip/hover), SVG puro com `viewBox` responsivo:

```tsx
interface LineChartPoint {
  label: string; // rótulo do eixo X (ex: "12/07")
  value: number;
}

export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 160,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
}) {
  if (data.every((d) => d.value === 0)) {
    return <p className="text-sm text-gray-400 text-center py-8">Sem dados no período</p>;
  }

  const width = 600;
  const padding = 20;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data
    .map((d, i) => `${padding + i * stepX},${height - padding - (d.value / max) * (height - padding * 2)}`)
    .join(" ");

  const firstLabel = data[0]?.label ?? "";
  const lastLabel = data[data.length - 1]?.label ?? "";
  const midLabel = data[Math.floor(data.length / 2)]?.label ?? "";

  return (
    <svg viewBox={`0 0 ${width} ${height + 20}`} className="w-full h-auto" role="img">
      <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
      <text x={padding} y={height + 15} fontSize="10" fill="currentColor" className="text-gray-400">{firstLabel}</text>
      <text x={width / 2} y={height + 15} fontSize="10" textAnchor="middle" fill="currentColor" className="text-gray-400">{midLabel}</text>
      <text x={width - padding} y={height + 15} fontSize="10" textAnchor="end" fill="currentColor" className="text-gray-400">{lastLabel}</text>
    </svg>
  );
}
```

`data` is always pre-filled with one point per day in range (zero-count days included) by the lib
functions in section 2 — the component itself does no date logic, just plots whatever points it's
given. "Sem dados" only shows when every value is genuinely zero (e.g. a brand-new platform with
no signups yet), not just an empty array (an empty array shouldn't happen given the lib always
fills the full day range).

## 2. `lib/dashboard-metrics.ts` — shared between admin and organizer

Three functions, all bucketing raw timestamps into one count per day across the full `[from, to]`
range (inclusive), filling zero-count days — Prisma's `groupBy` doesn't do date-truncation, and at
this app's data volume, fetching raw dates and bucketing in JS is simpler and more portable than
`$queryRaw`:

```ts
function bucketByDay(dates: Date[], from: Date, to: Date): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: { label: string; value: number }[] = [];
  for (const cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const key = cur.toISOString().slice(0, 10);
    const [, month, day] = key.split("-");
    days.push({ label: `${day}/${month}`, value: counts.get(key) ?? 0 });
  }
  return days;
}

export async function getDailySignups(from: Date, to: Date) {
  const users = await db.user.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { createdAt: true } });
  return bucketByDay(users.map((u) => u.createdAt), from, to);
}

export async function getDailyRegistrations(from: Date, to: Date, scope: { organizerId?: string; eventId?: string }) {
  const registrations = await db.registration.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(scope.eventId ? { eventId: scope.eventId } : {}),
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true },
  });
  return bucketByDay(registrations.map((r) => r.createdAt), from, to);
}
```

Both filters apply together (not `if eventId, ignore organizerId`) — when the organizer dashboard
passes both (`organizerId` always, `eventId` only if the admin/organizer picked one in the
`<select>`), the query is `eventId AND event.organizerId`, not just `eventId` alone. This matters:
if it were `eventId`-only whenever an `eventId` is present, an organizer could pass
`?eventId=<some-other-organizers-event-id>` in the URL and see that event's registration counts —
a cross-tenant data leak, even though the `<select>` itself only ever lists the organizer's own
events (the dropdown doesn't stop someone from hand-editing the query string).

export async function getDailyCouponUsage(from: Date, to: Date, scope: { organizerId?: string }) {
  const orders = await db.order.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      couponId: { not: null },
      ...(scope.organizerId ? { event: { organizerId: scope.organizerId } } : {}),
    },
    select: { createdAt: true },
  });
  return bucketByDay(orders.map((o) => o.createdAt), from, to);
}
```

`couponId: { not: null }` matches the exact moment `Coupon.usedCount` is incremented in
`lib/checkout.ts:103` (`tx.coupon.update({ data: { usedCount: { increment: 1 } } })`, unconditional
on payment status) — same definition of "usage" as the rest of the app already uses, no new
concept invented.

## 3. `app/admin/page.tsx` — 3 charts + date filter

Gains a `de`/`ate` GET filter (same `parseDateInput` pattern as `/admin/relatorio`), defaulting to
the last 30 days (inclusive, so exactly 30 points):

```ts
const to = parseDateInput(ate, true) ?? new Date();
const from = parseDateInput(de, false) ?? (() => {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  d.setHours(0, 0, 0, 0);
  return d;
})();
```

An `eventId` GET param (via a `<select>` populated from `db.event.findMany({ select: { id, title
}, orderBy: { title: "asc" } })`, all events, no organizer scope) narrows the registrations chart
only — signups and coupon usage stay platform-wide regardless of the event filter, since neither
concept is meaningfully "per event" the way registrations are.

Three new `<div className="card">` blocks added below the existing KPI grids (before "Atividade
recente"): "Novos cadastros" (`getDailySignups`), "Inscrições" (`getDailyRegistrations(from, to,
{eventId})`, with the event `<select>` inside this card's header), "Cupons utilizados"
(`getDailyCouponUsage(from, to, {})`, unscoped).

## 4. `app/organizador/page.tsx` — 2 charts (no signups chart — platform-wide, not organizer data)

Same `de`/`ate` filter pattern, same 30-day default. `eventId` filter scoped to
`db.event.findMany({ where: { organizerId: organizer.id }, ... })` (only this organizer's events,
mirroring the existing pattern already used in `app/organizador/relatorio/page.tsx:92-96`).

Two new cards: "Inscrições" (`getDailyRegistrations(from, to, { organizerId: organizer.id, eventId
})`), "Cupons utilizados" (`getDailyCouponUsage(from, to, { organizerId: organizer.id })`).

## Testes

- `lib/dashboard-metrics.ts`: `bucketByDay` isn't exported (internal helper) but is exercised
  indirectly through all three exported functions — tests mock `db.user.findMany` /
  `db.registration.findMany` / `db.order.findMany` and assert the returned array has one entry per
  day in a small range (e.g. 3 days), correct zero-fill for a day with no matching row, correct
  count for a day with multiple rows, and correct `label` format (`DD/MM`). Also test that
  `getDailyRegistrations`/`getDailyCouponUsage` build the right `where` clause for each of the
  three scope combinations (unscoped, organizerId only, eventId only).
- No test for the two page components — no page in this project has a dedicated test today (same
  convention followed in every prior sub-project this session).
- No test for `LineChart.tsx` — pure presentational SVG output, no logic beyond what's already
  covered by `bucketByDay`'s tests feeding it correct data; visually verified instead (see below).

## Fora de escopo

- Zoom/pan/tooltip interactivity on the charts — static SVG only, per the user's choice to avoid a
  charting dependency.
- Any change to the existing KPI cards, tables, or other content already on either dashboard page
  — purely additive.
- A "por evento" breakdown for the coupon-usage or signups charts — only the registrations chart
  gets the event filter, per the original task description.
- Monthly/weekly grouping toggle — daily buckets only, matching the confirmed 30-day default.
