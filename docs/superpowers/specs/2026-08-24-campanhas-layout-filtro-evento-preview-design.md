# Campanhas de WhatsApp — layout, filtro por evento, variáveis e preview na criação (design)

## Contexto

Depois de implementar destinatários avançados (seleção manual, envio avulso, excluir, preview ao
vivo, opt-outs), o usuário testou a tela e reportou 3 problemas reais, com prints anexados, pediu 2
melhorias adicionais, e — durante a conversa sobre o filtro por evento — pediu uma regra nova:
poder cadastrar uma mensagem de campanha de plataforma usando variáveis de evento/inscrição, mas
bloquear o envio com um erro claro se os destinatários não estiverem vinculados a uma inscrição de
evento real.

Investigação confirmou:

1. **Layout quebrado (confirmado, causa raiz identificada)**: `CampaignsManager.tsx` usa texto
   colorido sem borda/padding pras ações de cada campanha (Editar/Cancelar/Preparar
   destinatários/etc.), enquanto o resto do app (`lotes`, `cupons`, `percursos`, `categorias`,
   `redes-sociais`, `patrocinio`) usa um padrão consistente de botão-pill (borda + fundo leve no
   hover + padding). Esse arquivo nunca seguiu esse padrão, e ficou mais evidente à medida que mais
   ações foram adicionadas nesta sessão.
2. **Falta filtro por evento na seleção manual (confirmado, faltando mesmo)**: o modal "Selecionar
   destinatários" só lista atletas da base inteira da plataforma, sem forma de restringir a quem
   está inscrito num evento específico.
3. **Achado extra durante a investigação**: a população automática de destinatários pra campanhas
   de evento (`prepareCampaignRecipients`, branch `eventId !== null`) hoje não filtra por status de
   inscrição nenhum — inclui canceladas, pendentes de pagamento, em cancelamento e lista de espera.
   A convenção já estabelecida no resto do sistema pra "inscrição válida" pra fins de comunicação
   (`lib/kit-delivery.ts`, `lib/alerts/daily-summary-metrics.ts`) é `status: "CONFIRMED"` — só isso.
4. **Variáveis de evento/inscrição**: a maioria já existe (Fase C). 3 campos reais no banco não
   têm variável ainda: `EventRoute.distanceKm`, `Registration.bibNumber`,
   `Registration.teamName` (equipe específica da inscrição, distinta de
   `AthleteProfile.teamName`/`equipe_atleta`, que já existe).
5. **Envio pra número específico**: já existe (implementado nesta mesma sessão, dentro do modal de
   edição, ao lado de "Enviar teste") — sem trabalho novo aqui.
6. **Preview antes de salvar (confirmado, bug real)**: o preview ao vivo (`renderTemplate` +
   `SAMPLE_VALUES`) só existe dentro do modal de EDIÇÃO (`editForm`) — nunca no formulário de
   CRIAÇÃO (`form`, um bloco `showForm && (...)` separado, com seu próprio estado).

## Decisão importante confirmada com o usuário: variáveis de evento em campanha de plataforma

Hoje uma campanha de plataforma (`eventId` nulo) nunca pode usar variáveis de Evento/Organizador/
Inscrição — a validação de template rejeita no salvamento. O usuário quer o oposto: poder
**cadastrar** essas variáveis numa campanha de plataforma, mas só poder **enviar** se, na hora de
preparar destinatários, o operador tiver filtrado por **um evento específico** (não "vários
eventos na mesma campanha" — opção mais simples, confirmada explicitamente: pra atingir múltiplos
eventos com variáveis de evento, o operador cria uma campanha por evento).

Mecanismo: cada linha de `CampaignRecipient` já pode carregar um `registrationId` (campo existente,
hoje só preenchido no modo evento automático). A regra de segurança real não é "a campanha
pertence a um evento" — é "cada destinatário sabe a qual inscrição ele se refere". Então:

- Seleção manual com filtro de evento ativo → cada destinatário selecionado ganha o
  `registrationId` da sua inscrição `CONFIRMED` naquele evento (não fica mais `null`).
- Seleção manual sem filtro de evento (like hoje) → `registrationId` continua `null`.
- Campanha de plataforma passa a poder SALVAR variáveis de Evento/Organizador/Inscrição na
  mensagem (validação de template não bloqueia mais isso pra campanhas de plataforma).
- Na hora de agendar/disparar (`schedule` route), se a mensagem usa alguma variável dessas
  categorias E existir pelo menos 1 `CampaignRecipient` da campanha com `registrationId: null`,
  a rota rejeita com 400 e uma mensagem clara. Campanhas de evento (que sempre preenchem
  `registrationId`) nunca são afetadas por essa checagem — ela só é relevante pro caso novo.

## Arquitetura

### 1. Layout — `components/campaigns/CampaignsManager.tsx`

Substituir os `className` de cada botão de ação de linha (Editar, Cancelar ×2, Preparar
destinatários, Selecionar destinatários, Pausar, Retomar, Duplicar, Excluir) pelo padrão-pill já
usado em `lotes`/`cupons`/etc.:

```tsx
className="text-xs px-2 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20 transition-colors"
```

Variantes por cor (mesma estrutura, troca só a cor):
- Vermelho (Cancelar, Excluir): `border-red-200 text-red-600 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20`
- Verde (Preparar destinatários, Selecionar destinatários, Retomar): `border-green-200 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-900/20`
- Âmbar (Pausar): `border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20`
- Cinza (Duplicar): `border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800`

O container `<div className="flex gap-2 shrink-0">` ganha `flex-wrap justify-end` pra não estourar
horizontalmente com 6 ações numa tela estreita.

### 2. Filtro por evento na seleção manual (com vínculo de inscrição)

**Backend:**
- `app/api/admin/campaigns/recipients-directory/route.ts` e `.../ids/route.ts`: aceitam
  `eventId` opcional na querystring; quando presente, o `where` ganha
  `registrations: { some: { eventId, status: "CONFIRMED" } }`.
- Novo `app/api/admin/campaigns/events-directory/route.ts`: `GET`, permissão `campaigns.view`,
  lista eventos (`db.event.findMany`, paginado, `q` busca por `title`), retorna
  `{ rows: {id, title}[], total, page, pageSize, totalPages }` — mesmo contrato dos outros
  diretórios. Não existe endpoint reaproveitável hoje (`app/api/events/route.ts` só tem `POST`).
- `lib/campaigns/recipients.ts`: `prepareCampaignRecipients` ganha um 4º parâmetro opcional
  `manualEventId?: string`. Quando `eventId` (parâmetro já existente, o escopo da CAMPANHA) é nulo
  E `athleteUserIds` E `manualEventId` são informados juntos, `fetchCandidateBatch` busca, pra
  cada `athleteUserId`, a inscrição `CONFIRMED` dele nesse evento específico
  (`db.registration.findFirst({ where: { eventId: manualEventId, athleteUserId, status:
  "CONFIRMED" } })`) e usa o `id` dela como `registrationId` da linha — em vez de `null`. Se um
  candidato não tiver essa inscrição (caso raro — a lista já veio filtrada pelo diretório, mas o
  status pode ter mudado entre listar e preparar), cai de volta pra `registrationId: null` (o
  destinatário ainda recebe a mensagem, só as variáveis de evento saem em branco pra ele
  especificamente, igual o comportamento já existente de `renderTemplate` pra variável não
  resolvida — sem quebrar o envio de todo mundo por causa de 1 pessoa).

**UI (`CampaignsManager.tsx`)**: o modal de seleção manual ganha um `<select>` de evento
(populado via `events-directory`, lista simples sem paginação — tende a ser pequena) acima do
campo de busca de atletas. Ao escolher um evento, `loadManualDirectory`/`selectAllManual` passam a
incluir `eventId` na querystring, e `confirmManualPrepare` passa a enviar
`{ athleteUserIds, manualEventId: selectedEventId || undefined }` no corpo.

### 3. Fix do gap de status em campanhas de evento

`lib/campaigns/recipients.ts`, branch `eventId !== null` de `fetchCandidateBatch` (campanhas de
evento tradicionais, automáticas): o `where` de `db.registration.findMany` passa de `{ eventId }`
para `{ eventId, status: "CONFIRMED" }` — mesma convenção de `kit-delivery.ts`.

### 4. Variáveis novas

`lib/templates/variables.ts` (`ALL_VARIABLES`): 3 entradas novas, categoria "Inscrição":
`distancia_percurso` (`EventRoute.distanceKm`, formatado como texto, ex. "5 km"), `numero_peito`
(`Registration.bibNumber`), `equipe_inscricao` (`Registration.teamName`).
`lib/campaigns/resolve-recipient-variables.ts`: resolve as 3 no branch de modo evento — o `select`
de `db.registration.findUnique` ganha `bibNumber: true`, `teamName: true` na raiz, e
`route: { select: { name: true, distanceKm: true } }` (hoje só seleciona `name`).

### 5. Variáveis de evento em campanha de plataforma + guarda no envio

**`lib/campaigns/variables.ts`**: `getAllowedCampaignVariables`/`getAllowedCampaignVariableNames`
ganham um 2º parâmetro opcional `forceEventCategories = false`. Quando `true`, libera as categorias
de evento mesmo com `eventId` nulo. Nova função exportada, reaproveitando `EVENT_ONLY_CATEGORIES`
e `ALL_VARIABLES` já existentes:

```ts
export function messageUsesEventScopedVariables(messageBody: string): boolean {
  const eventScopedNames = new Set(
    ALL_VARIABLES.filter((v) => EVENT_ONLY_CATEGORIES.includes(v.category)).map((v) => v.name),
  );
  const found = [...messageBody.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
  return found.some((name) => eventScopedNames.has(name));
}
```

**Rotas de criar/editar campanha de plataforma** (`app/api/admin/campaigns/route.ts` POST,
`[campaignId]/route.ts` PATCH): trocar a chamada `getAllowedCampaignVariableNames(null)` por
`getAllowedCampaignVariableNames(null, true)` — só nessas 2 rotas (as de plataforma). As rotas
event-scoped (`app/api/events/...`) não mudam — já passam o `eventId` real, que já libera as
categorias sem precisar do novo parâmetro.

**Rotas de agendar/disparar** (`app/api/admin/campaigns/[campaignId]/schedule/route.ts` e a
event-scoped): antes de aceitar o agendamento/disparo, se
`messageUsesEventScopedVariables(context.campaign.messageBody)` for verdadeiro, contar
`db.campaignRecipient.count({ where: { campaignId, registrationId: null } })` — se maior que 0,
rejeitar com 400: `"Esta mensagem usa variáveis de evento, mas nem todos os destinatários estão
vinculados a uma inscrição de evento. Prepare os destinatários filtrando por um evento específico
antes de agendar ou disparar."`. Campanhas de evento tradicionais nunca disparam essa checagem (elas
sempre preenchem `registrationId`).

### 6. Preview no formulário de criação

Réplica do painel já implementado no modal de edição, trocando `editForm.messageBody` por
`form.messageBody` e o ref `editBodyRef` por `createBodyRef` (já existe, já usado pelo inserter de
variável do formulário de criação).

## Testes

- Layout: sem suíte de componente (convenção já estabelecida) — verificado por leitura de código.
- Filtro por evento + vínculo de inscrição: testes novos pros 2 diretórios (com/sem `eventId`),
  pro novo endpoint de eventos, e pra `prepareCampaignRecipients` com `manualEventId` (resolve
  `registrationId` corretamente; cai pra `null` quando a inscrição não é encontrada).
- Fix de status: teste novo confirmando `status: "CONFIRMED"` no modo evento automático; regressão
  garantindo que o modo plataforma sem filtro não muda.
- Variáveis novas: testes resolvendo as 3 a partir de um registro completo; `getAllowedCampaignVariableNames`
  as inclui só quando apropriado.
- Guarda de envio: testes pra `messageUsesEventScopedVariables` (detecta/não detecta variável de
  evento no texto); testes pras rotas de schedule rejeitando quando há `registrationId: null` e
  variável de evento em uso, aceitando quando não usa variável de evento OU todos têm
  `registrationId`.
- Preview na criação: sem suíte de componente — verificado por leitura de código.

## Adenda: liberar patrocínio/redes sociais em campanhas (pedido do usuário durante a execução)

`patrocinio` e `redes_sociais` foram excluídas do catálogo de campanhas na Fase D com a justificativa
"têm efeito colateral (incrementam cota de envio)". Investigação nesta adenda mostrou que essa
justificativa está **parcialmente incorreta**:

- `getSponsorPromoText` (`lib/event-sponsors.ts`) — **sem efeito colateral nenhum**, sem limite por
  destinatário. Patrocínio é conteúdo pago do organizador, aparece sempre que ativo. Pode ser
  liberada sem nenhuma proteção extra.
- `getSocialPromoText` (`lib/event-social-links.ts`) — **tem** efeito colateral real: cada chamada
  bem-sucedida incrementa `SocialLinkSend.count` (cota por link × destinatário), numa transação,
  não é idempotente.

Como o worker de campanha processa recipientes um de cada vez (nunca renderiza uma vez só pra todo
mundo), a preocupação original ("nunca fizeram sentido pra uma campanha que renderiza o mesmo texto
pra centenas/milhares de destinatários") não se aplica — mas existe um risco real e diferente: se o
envio falhar e for tentado de novo (até 3 tentativas), `getSocialPromoText` seria chamada de novo a
cada tentativa, incrementando a cota mais de uma vez pra uma mensagem que só foi (ou nunca foi)
efetivamente entregue uma vez.

**Decisão confirmada com o usuário**: resolver `redes_sociais` só na 1ª tentativa de envio de cada
destinatário, guardar o texto resolvido, e reaproveitar nas tentativas seguintes sem chamar
`getSocialPromoText` de novo (sem reincrementar a cota).

### Arquitetura

- **Schema**: novo campo `CampaignRecipient.redesSociaisText String?` — guarda o texto já resolvido
  na 1ª tentativa. `null` = ainda não resolvido.
- **`lib/campaigns/variables.ts`**: remove `"patrocinio"` e `"redes_sociais"` de `EXCLUDED_NAMES`;
  atualiza o comentário da constante refletindo a distinção real entre as duas.
- **`lib/campaigns/resolve-recipient-variables.ts`**: `resolveCampaignRecipientVariables` passa a
  aceitar um `redesSociaisText?: string | null` opcional no parâmetro `recipient`, e retorna
  `{ values, redesSociaisText? }` em vez de só `values` — o 2º campo só vem preenchido quando a
  resolução foi feita NESTA chamada (precisa ser persistida pelo chamador). `patrocinio` resolve via
  `getSponsorPromoText(registration.eventId)`, sem cache, sem condição especial. `redes_sociais`:
  se `recipient.redesSociaisText` já veio preenchido, reaproveita; senão, chama
  `getSocialPromoText(registration.eventId, recipient.athleteUserId)` e marca o resultado pra ser
  persistido.
- **`app/api/cron/send-campaign-messages/route.ts`**: depois de resolver as variáveis, se
  `redesSociaisText` veio definido (resolução fresca), persiste imediatamente
  (`db.campaignRecipient.update({ where: { id }, data: { redesSociaisText } })`) — **antes** de
  tentar o envio, pra que uma falha de envio subsequente não force uma nova resolução/incremento na
  próxima tentativa.

### Testes

- `lib/campaigns/variables.ts`: `patrocinio`/`redes_sociais` aparecem em `getAllowedCampaignVariableNames`
  quando `eventId`/`forceEventCategories` liberam a categoria Evento.
- `resolveCampaignRecipientVariables`: resolve `patrocinio` sempre; resolve `redes_sociais` fresco
  quando `redesSociaisText` não é informado, e retorna o valor pra persistir; reaproveita sem
  chamar `getSocialPromoText` de novo quando `redesSociaisText` já vem preenchido.
- Worker: persiste `redesSociaisText` antes da tentativa de envio; uma 2ª tentativa (attempts > 0)
  não chama `getSocialPromoText` de novo quando o valor já está cacheado.

## Fora de escopo (YAGNI)

- Suporte a "vários eventos na mesma campanha" — confirmado explicitamente como fora de escopo;
  pra isso o operador cria uma campanha por evento.
- Reimplementar envio avulso — já existe, correto como está (usa `SAMPLE_VALUES`, não afetado pela
  guarda de envio, que só importa pro disparo real via fila/worker).
- Ampliar a largura da página raiz (`max-w-2xl`) — fora do pedido explícito.
- Paginação no seletor de evento do modal de seleção manual — lista de eventos tende a ser pequena.
