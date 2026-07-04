# Auto-inscrição para organizador/admin + botão "Área do atleta"

## Contexto

Hoje, `ORGANIZER` e `ADMIN` não conseguem se inscrever em eventos: existem dois bloqueios
explícitos, um na página de inscrição e outro na API de checkout. O usuário quer liberar essa
restrição e adicionar um jeito fácil de esses usuários navegarem até a área de eventos para se
inscrever, caso queiram.

## Levantamento

- **Bloqueio 1:** `app/(public)/inscricao/[slug]/page.tsx:46-53` — se `session.user.role` for
  `ADMIN` ou `ORGANIZER`, renderiza uma mensagem de "Acesso não permitido" em vez do formulário de
  checkout.
- **Bloqueio 2:** `app/api/checkout/route.ts:38-40` — mesma checagem de role, retornando 403 antes
  de processar o corpo da requisição.
- Fora esses dois pontos, nada mais impede um `ORGANIZER`/`ADMIN` de se inscrever: o botão
  "Inscrever-se" na página do evento (`app/(public)/eventos/[slug]/page.tsx:180-191`) não tem
  checagem de role — ele só depende de `canRegister`/lote disponível/login. `AthleteProfile` é
  opcional (`prisma/schema.prisma`) e o formulário de checkout já lida com a ausência de perfil,
  deixando os campos em branco para preenchimento manual — ou seja, o resto do fluxo de checkout
  (`lib/checkout.ts`, criação de `Registration`, contagem de vaga no lote) já funciona
  independentemente do papel do usuário, sem mudança necessária.
- A "área do atleta" (`/dashboard`) já é acessível a qualquer papel autenticado
  (`app/dashboard/layout.tsx` usa `requireAuth()`, sem restrição de role) — e o caminho inverso já
  existe: `components/dashboard/DashboardNav.tsx:51-58` mostra um badge amarelo "Admin"/
  "Organizador" que leva de volta para a área de origem quando um desses papéis está navegando por
  `/dashboard`.

## Design

### 1. Remover os dois bloqueios

- `app/(public)/inscricao/[slug]/page.tsx`: remover o bloco `if (session.user.role === "ADMIN" ||
  session.user.role === "ORGANIZER") { ... }` (linhas 46-53), deixando o fluxo seguir direto para
  a checagem de evento existente logo abaixo.
- `app/api/checkout/route.ts`: remover o bloco equivalente (linhas 38-40), deixando o fluxo seguir
  direto para o parse do body.

Nenhuma outra mudança de lógica: qualquer usuário autenticado (`ATHLETE`, `ORGANIZER` ou `ADMIN`)
passa a poder se inscrever em qualquer evento, inclusive organizadores se inscrevendo em eventos
que eles mesmos organizam — decisão explícita do usuário, sem bloqueio adicional de conflito de
interesse.

### 2. Botão "Área do atleta"

Adicionar um link estilizado como badge (mesma ideia visual do badge amarelo já existente em
`DashboardNav.tsx`, mas com rótulo "Área do atleta" e apontando para `/eventos`) em:

- `components/admin/AdminNav.tsx` — no grupo à direita, ao lado do `ThemeToggle`/"Sair" (fora da
  lista ordenada de links já fixada na tarefa #16 — não entra nessa lista, é um elemento visual
  separado).
- `components/organizer/OrganizerNav.tsx` — mesma posição (ao lado do nome do usuário/
  `ThemeToggle`). Como este arquivo duplica os links em uma versão mobile (`md:hidden`, linhas
  31-41), o botão precisa ser adicionado nas duas versões.

Clicar no botão leva para `/eventos` (listagem pública de eventos), de onde o usuário pode navegar
normalmente e se inscrever como qualquer atleta.

## Fora de escopo

- Qualquer indicador visual distinguindo inscrições feitas por contas de organizador/admin nas
  telas de inscritos (não foi pedido).
- Bloquear organizador de se inscrever no próprio evento (decisão explícita: permitir).
- Mudanças em `AthleteProfile` ou no formulário de checkout — já funcionam sem perfil preenchido.
