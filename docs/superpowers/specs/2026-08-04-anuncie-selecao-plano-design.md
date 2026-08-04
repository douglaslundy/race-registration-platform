# Seleção de plano em `/anuncie` (Etapa 7) — Design

## Contexto

Etapa 7 do mega-prompt de 10 etapas. Auditoria da Etapa 1 (`IMPLEMENTATION_PLAN.md` §2.5) já
identificou o gap: `app/(public)/anuncie/page.tsx` já é público (sem exigir login), já reaproveita o
padrão de `SubscribeButton`/PIX (`RequestAdvertiserForm` mostra `PixPaymentCard` após enviar), e o
fluxo de "login adiado até o checkout" já está implementado corretamente — `isLoggedIn` já controla
se os campos de nome/e-mail/senha aparecem, e `POST /api/anunciante/solicitar` já trata os dois
casos (`existingUserId` vs. `newAccount`). O único gap real: a página sempre submete
`plans[0].id` (`RequestAdvertiserForm adPlanId={plans[0].id}`), mesmo mostrando cards visuais pra
vários planos — não existe seleção de plano pelo visitante.

## Decisões já fechadas com o usuário

- **Escopo**: só seleção de plano. Sem seleção de forma de pagamento (continua fixo em PIX, mesmo
  comportamento de hoje).
- **UX**: clicar no card do plano seleciona (sem botão "Escolher" separado).

## O que muda

Novo componente `components/advertiser/AdvertiserPlanPicker.tsx` (`"use client"`), que:
- Recebe a lista de `plans` (mesmo shape hoje buscado em `AnunciePage` via `db.adPlan.findMany`) e
  `isLoggedIn` como props.
- Mantém `selectedPlanId` em `useState`, inicializado com `plans[0].id` (mesmo comportamento atual
  — plano mais barato pré-selecionado, já que `orderBy: { priceAmount: "asc" }` não muda).
- Renderiza a mesma grade de cards que existe hoje em `AnunciePage`, mas cada card vira um
  `<button type="button">` (ou `<div role="button" tabIndex={0}>` com `onClick`/`onKeyDown`,
  decisão de implementação — deve ser focável e acionável por teclado) que chama
  `setSelectedPlanId(plan.id)` ao clicar. O card do plano selecionado ganha destaque visual (borda/
  fundo diferenciado — mesmo padrão de estado "selecionado" já usado em outros lugares do projeto,
  ex. seleção de método de pagamento no checkout).
- Renderiza `<RequestAdvertiserForm adPlanId={selectedPlanId} isLoggedIn={isLoggedIn} />` abaixo da
  grade, dentro do mesmo componente — o formulário reage à seleção porque `adPlanId` muda.

`app/(public)/anuncie/page.tsx` encolhe: continua buscando `session`, `enabled`, `plans` (nada
muda nessa parte), mas delega a renderização de "grade de planos + formulário" pro
`AdvertiserPlanPicker`, passando só `plans` e `isLoggedIn`. O bloco atual (linhas 39-60, grade +
card do formulário) é substituído por uma única chamada ao novo componente.

**Sem mudança nenhuma** em `RequestAdvertiserForm.tsx` (já aceita `adPlanId` como prop, já é
reativo — remontar com `adPlanId` diferente é comportamento padrão do React) nem em
`app/api/anunciante/solicitar/route.ts` (já recebe `adPlanId` no body, não precisa saber que agora
vem de uma seleção em vez de um valor fixo).

## Casos de borda

- `plans.length === 1`: `AdvertiserPlanPicker` ainda funciona normalmente (1 card, já vem
  selecionado, sem necessidade de esconder a seleção — simplicidade sobre um caso especial que não
  atrapalha).
- Troca de plano depois de já ter começado a preencher o formulário: como o formulário não guarda
  estado fora do próprio `RequestAdvertiserForm`, trocar `adPlanId` não deve limpar os campos já
  digitados — isso só aconteceria se `RequestAdvertiserForm` fosse desmontado/remontado. Decisão:
  **não** usar `key={selectedPlanId}` no `RequestAdvertiserForm` (isso forçaria remount e perderia o
  que a pessoa já digitou) — só a prop muda, o componente permanece montado.

## Sem `alert()`/`confirm()`/`prompt()`

Regra fixa do `CLAUDE.md`. Esta mudança não introduz nenhuma ação destrutiva nem confirmação — não
precisa de `ConfirmModal`/`ErrorModal`.

## Testes

- `AdvertiserPlanPicker.tsx`: sem teste dedicado (convenção já estabelecida — componente
  `"use client"` não tem teste dedicado neste projeto, mesma decisão de `SocialLinksForm`/
  `RequestAdvertiserForm` já existentes).
- Nenhuma rota de API muda — sem teste novo de backend.

## Critérios de aceite

- Visitante em `/anuncie` vê os cards de planos, clica em um diferente do primeiro, e o formulário
  passa a submeter esse `adPlanId` (confirmável lendo o `fetch` body ou testando manualmente).
- Plano inicialmente selecionado é o mais barato (`plans[0]`), igual ao comportamento atual.
- Trocar de plano não limpa os campos já preenchidos no formulário.
- Fluxo de login adiado (usuário deslogado preenche nome/e-mail/senha; usuário logado com outro
  papel não vê esses campos) continua idêntico — nenhuma mudança nessa parte.
- Suíte completa + `tsc --noEmit` + `npm run build` limpos, mesma exigência de sempre.
