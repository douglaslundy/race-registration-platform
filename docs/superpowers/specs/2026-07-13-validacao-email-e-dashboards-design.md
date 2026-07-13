# Validação de e-mail no cadastro + melhorias de dashboard (Recharts + layout)

## Contexto

Pedido do usuário em 2026-07-13, em uma única mensagem com vários itens relacionados (todos
UI/qualidade de dados, sem depender uns dos outros exceto pelo fato de tocarem os mesmos
dashboards construídos mais cedo nesta sessão):

1. Validar o e-mail no cadastro — usuário encontrou e-mails como "usuario@gmail.coml" (TLD
   inexistente) passando pelo cadastro hoje.
2. Renomear a página admin pra "Dashboard" (mais intuitivo); a página do organizador equivalente
   já se chama "Dashboard".
3. Trocar os gráficos de linha (SVG próprio, construído mais cedo nesta sessão) por uma biblioteca
   de gráficos de verdade — os atuais "estão muito ruins".
4. Nos dois dashboards (admin e organizador, por decisão do usuário): os filtros de data/evento
   ficam inline, justificados entre si (só quebram linha por responsividade).
5. Nos dois dashboards: um gráfico por linha (não mais um grid de 2-3 colunas).

## 1. Validação de e-mail — checagem de domínio via DNS (registro MX)

`z.string().email()` (usado em `app/api/auth/register/route.ts:11`) só valida formato — aceita
qualquer coisa com a forma `algo@algo.tld`, mesmo que o domínio não exista. Decisão confirmada com
o usuário: checar se o domínio do e-mail tem registro MX de verdade (não só uma lista de TLDs
comuns), com timeout de ~4s — **se a consulta DNS travar ou der erro inesperado, deixa passar o
cadastro** (fail-open); só rejeita quando a consulta *responde* dizendo que o domínio não existe.

Novo `lib/validate-email-domain.ts`:

```ts
import dns from "node:dns";

const MX_LOOKUP_TIMEOUT_MS = 4000;

export async function hasValidMxRecord(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  if (!domain) return false;

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(true); // timeout: não bloqueia o cadastro por instabilidade de rede/DNS
      }
    }, MX_LOOKUP_TIMEOUT_MS);

    dns.resolveMx(domain, (err, addresses) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        // domínio genuinamente sem registro MX -> inválido; qualquer outro erro -> deixa passar
        resolve(err.code === "ENOTFOUND" || err.code === "ENODATA" ? false : true);
      } else {
        resolve(addresses.length > 0);
      }
    });
  });
}
```

`app/api/auth/register/route.ts` chama essa função **depois** do `registerSchema.safeParse` (só
gasta uma consulta DNS se o formato já passou), antes de checar se o e-mail já existe:

```ts
if (!(await hasValidMxRecord(email))) {
  return NextResponse.json({ error: "Domínio de e-mail inválido ou inexistente" }, { status: 400 });
}
```

## 2. Renomear "admin" para "Dashboard"

- `app/admin/page.tsx`: `<h1>Painel Administrativo</h1>` → `<h1>Dashboard</h1>`.
- `components/admin/AdminNav.tsx`: o link de marca/home (`<Link href="/admin" ...>Admin</Link>`,
  hoje o único link que funciona como "voltar pro início" do admin) → texto muda pra "Dashboard",
  mesmo padrão que o organizador já usa (`<Link href="/organizador" ...>Dashboard</Link>` em
  `OrganizerNav.tsx:14`). Só o texto muda — `href`, classe, posição continuam os mesmos.

## 3. Recharts no lugar do SVG próprio

`components/ui/LineChart.tsx` (construído mais cedo nesta sessão como SVG puro, sem dependência)
passa a usar [Recharts](https://recharts.org) — confirmado compatível com React 19 a partir da
v3.x (`peerDependencies: react ^19.0.0`, verificado). Vira client component (Recharts precisa
medir o DOM no browser):

```tsx
"use client";

import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface LineChartPoint {
  label: string;
  value: number;
}

export default function LineChart({
  data,
  color = "#0ea5e9",
  height = 260,
}: {
  data: LineChartPoint[];
  color?: string;
  height?: number;
}) {
  if (data.every((d) => d.value === 0)) {
    return <p className="text-sm text-gray-400 text-center py-8">Sem dados no período</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
        <Tooltip />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}
```

Same prop signature as before (`data`, `color`, `height`) — `app/admin/page.tsx` and
`app/organizador/page.tsx` don't need their `<LineChart data={...} color="..." />` call sites
changed at all, only the component's internals and its import source. `data`'s shape
(`{label, value}[]`) already matches what `lib/dashboard-metrics.ts` returns — no changes needed
there either.

`recharts` (`^3.9.0`) added as a real dependency (`npm install recharts`) — reverses the earlier
no-new-dependency decision from the original dashboards task, per explicit user request now that
the hand-rolled version turned out to look bad in practice.

## 4. Layout — filtros inline justificados + um gráfico por linha (admin e organizador)

Mesma mudança nos dois arquivos (`app/admin/page.tsx`, `app/organizador/page.tsx`):

**Filtro:** hoje é um único `<form className="flex items-center gap-2 text-sm flex-wrap">` com
todos os controles soltos em sequência (data De, data Até, select Evento, botão Filtrar), que
ficam grudados à esquerda. Passa a agrupar em 3 blocos (datas juntas, evento, botão) dentro de um
container `justify-between`, que já é responsivo por natureza — os blocos só empilham quando não
cabem lado a lado (`flex-wrap` já cobre isso, sem mudar):

```tsx
<form method="GET" className="flex items-center justify-between flex-wrap gap-4 text-sm">
  <div className="flex items-center gap-2">
    <label className="text-gray-600">De</label>
    <input type="date" name="de" defaultValue={de ?? from.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
    <label className="text-gray-600">Até</label>
    <input type="date" name="ate" defaultValue={ate ?? to.toISOString().slice(0, 10)} className="input-field py-1 text-sm" />
  </div>
  <div className="flex items-center gap-2">
    <label className="text-gray-600">Evento (inscrições)</label>
    <select name="eventId" defaultValue={eventId ?? ""} className="input-field py-1 text-sm">
      <option value="">Todos os eventos</option>
      {events.map((e) => (
        <option key={e.id} value={e.id}>{e.title}</option>
      ))}
    </select>
  </div>
  <button type="submit" className="btn-primary py-1 px-4 text-sm">Filtrar</button>
</form>
```

(`events` → `chartEvents` no arquivo do organizador, mesmo nome já usado lá hoje — só a estrutura
JSX do form muda, as variáveis continuam as mesmas.)

**Gráficos:** hoje é um `<div className="grid grid-cols-1 md:grid-cols-3 gap-4">` (admin, 3
colunas) ou `md:grid-cols-2` (organizador, 2 colunas) envolvendo os cards de gráfico. Vira uma
pilha vertical simples, cada gráfico ocupando a largura toda:

```tsx
<div className="space-y-6">
  <div className="card">
    <h2 className="text-sm font-semibold mb-3">Novos cadastros</h2>
    <LineChart data={signupsData} color="#7c3aed" />
  </div>
  {/* ...demais gráficos, mesma estrutura de card, um por vez... */}
</div>
```

(Admin mantém os 3 cards nessa pilha; organizador mantém os 2 dele — só a `<div>` que os envolve
muda de `grid` pra `space-y-6`, o conteúdo de cada card não muda.)

## Testes

- `lib/validate-email-domain.ts`: mockar `dns.resolveMx` — domínio com MX válido → `true`; erro
  `ENOTFOUND`/`ENODATA` → `false`; erro genérico (ex.: `ETIMEOUT`, `ESERVFAIL`) → `true` (fail-open);
  e-mail sem `@`/domínio vazio → `false` sem sequer chamar `resolveMx`. Timeout real (usar
  `vi.useFakeTimers()`) → `true` depois de ~4s.
- `tests/register-route.test.ts` (já existe): estender com um teste que mocka
  `hasValidMxRecord` retornando `false` e confirma 400; e confirmar que os testes de sucesso
  existentes continuam passando com o mock retornando `true` (precisa mockar o módulo inteiro).
- Sem teste para `LineChart.tsx` (troca de biblioteca, mesmo contrato de props, comportamento
  visual — este projeto não testa componentes de página/apresentação) nem para os dois arquivos de
  página (mesma convenção já estabelecida nesta sessão: nenhuma página tem teste dedicado).

## Fora de escopo

- Verificação de deliverability além de MX (ex.: SPF/DKIM, catch-all detection, disposable-email
  blocklist) — não pedido, MX já cobre o caso relatado ("gmail.coml").
- Mudar a marca/logo do admin (`AdminNav.tsx` não tem um `{appName}` separado como o organizador
  tem) — só o texto do link existente muda, não a estrutura do nav.
- Adicionar tooltip/zoom/interatividade além do que o Recharts já oferece por padrão.
- Mudar as cores dos gráficos ou os dados que cada um mostra — só a biblioteca de renderização e o
  layout ao redor mudam.
