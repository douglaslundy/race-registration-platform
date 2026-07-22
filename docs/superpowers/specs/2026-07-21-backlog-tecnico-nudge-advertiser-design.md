# Backlog técnico: helper de logout do nudge + helper de auth do anunciante

## Contexto

Dois achados Minor registrados nas revisões da sessão anterior (`docs/superpowers/plans/2026-07-21-ajustes-pequenos-perfil-anunciante.md` e sua revisão final de branch), sem ação na época por não bloquearem nada. Usuário pediu pra resolver agora, antes de iniciar o brainstorm do sistema de rating. O 3º item do mesmo backlog (reaprovação de anúncio não rechecar status/prazo) foi mantido fora por decisão explícita do usuário — mesmo padrão já aceito nas rotas irmãs, sem indicação de ser problema real.

## Item 1 — helper `signOutAndClearNudge()`

**Problema**: a flag `PROFILE_NUDGE_DISMISS_KEY` (sessionStorage, controla se o modal de completar
cadastro já foi visto nesta sessão de login) só é limpa no logout de `DashboardNav.tsx` e das 2
variantes de `Header.tsx` (desktop/mobile) — não nos 3 navs de outros papéis
(`AdminNav.tsx`/`OrganizerNav.tsx`/`AdvertiserNav.tsx`). Inofensivo hoje porque o modal só
renderiza pra `role === "ATHLETE"`, que nunca alcança esses 3 navs — mas é fragilidade latente
(se o nudge for estendido a outro papel no futuro, a flag vaza entre sessões de login).

**Solução**: nova função exportada em `components/dashboard/ProfileCompletionNudge.tsx` (mesmo
arquivo que já exporta `PROFILE_NUDGE_DISMISS_KEY`):

```ts
export function signOutAndClearNudge() {
  sessionStorage.removeItem(PROFILE_NUDGE_DISMISS_KEY);
  signOut({ callbackUrl: "/" });
}
```

Os 6 pontos de logout do app (`DashboardNav.tsx`, `Header.tsx` ×2, `AdminNav.tsx`,
`OrganizerNav.tsx`, `AdvertiserNav.tsx`) passam a chamar só essa função em vez de `signOut(...)`
direto — os 3 já corrigidos ganham consistência (removendo a duplicação inline
`sessionStorage.removeItem` + `signOut`), os 3 que faltavam ganham o fix. Importar um componente
de `components/dashboard/` a partir de nav de outra área já é precedente existente (`Header.tsx`
já importa a constante de lá desde a sessão anterior).

## Item 2 — `checkAdvertiserApiPermission()` em `lib/auth/rbac.ts`

**Problema**: `app/api/anunciante/ads/[id]/cancel/route.ts` e `app/api/anunciante/profile/route.ts`
(GET e PUT) duplicam o mesmo bloco de auth/role (`session?.user` → 401, `role !== "ADVERTISER"` →
403) — 3 cópias do mesmo par de checagens. Note uma diferença real de comportamento entre as
rotas hoje: a de cancelar também busca `AdvertiserProfile` e retorna 404 se não existir; a de
perfil não — GET retorna `{ profile: null }` normalmente, PUT cria o perfil na primeira vez via
`upsert`. O helper compartilhado não pode decidir 404 sozinho, ou quebraria esse comportamento
intencional da rota de perfil.

**Solução**: nova função em `lib/auth/rbac.ts`, seguindo o mesmo formato já usado por
`checkApiPermission`/`checkAdminOnlyApiPermission` (union discriminado, sem `redirect` — rotas de
API retornam `NextResponse`):

```ts
export type AdvertiserPermissionCheck =
  | { allowed: true; session: Session; advertiser: AdvertiserProfile | null }
  | { allowed: false; response: NextResponse };

export async function checkAdvertiserApiPermission(): Promise<AdvertiserPermissionCheck> {
  const session = await auth();
  if (!session?.user) {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if (session.user.role !== "ADVERTISER") {
    return { allowed: false, response: NextResponse.json({ error: "Não autorizado" }, { status: 403 }) };
  }
  const advertiser = await db.advertiserProfile.findUnique({ where: { userId: session.user.id } });
  return { allowed: true, session, advertiser };
}
```

Devolve `advertiser` (podendo ser `null`) e nunca decide 404 sozinho — cada rota mantém sua
própria decisão:
- `POST /api/anunciante/ads/[id]/cancel`: `if (!check.advertiser) return 404 "Perfil de
  anunciante não encontrado"` — comportamento idêntico ao atual.
- `GET`/`PUT /api/anunciante/profile`: `check.advertiser` já É o valor que `GET` retorna direto
  (`{ profile: check.advertiser }`) — a própria query duplicada que a rota fazia hoje some, sem
  mudar o resultado. `PUT` ignora `check.advertiser` (usa `check.session.user.id` pro `upsert`,
  como já fazia).

`AdvertiserProfile` importado de `@prisma/client` (tipo gerado pelo Prisma, já usado em outros
pontos do projeto do mesmo jeito).

## Fora de escopo

- Item 3 do backlog original (reaprovação de anúncio) — mantido fora por decisão do usuário.
- Qualquer mudança de comportamento visível nas 2 rotas de anunciante ou nos 6 pontos de logout —
  este trabalho é puramente refactor/consolidação, sem alterar nenhuma resposta HTTP nem UX.
- Extrair um helper equivalente pra `app/api/organizer/profile/route.ts` (mencionado como possível
  fast-follow na revisão final anterior, mas é uma rota fora do escopo desta sessão).

## Testes

- Item 1: sem teste automatizado novo (client component, sem infra de teste de componente React
  neste projeto — mesma convenção já estabelecida). A suíte existente não cobre `signOut`, então
  nada quebra.
- Item 2: os testes já existentes de `tests/advertiser-ads-cancel-route.test.ts` e
  `tests/advertiser-profile-route.test.ts` continuam válidos como estão (mockam `auth()` e
  `db.advertiserProfile.*` diretamente, não `checkAdvertiserApiPermission` — o refactor interno
  da rota não muda o que os testes observam de fora). Rodar a suíte completa depois do refactor é
  suficiente pra confirmar que nada regrediu; não é necessário reescrever os testes existentes.
