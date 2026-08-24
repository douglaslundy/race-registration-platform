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
  aceitar um `redesSociaisText?: string | null` opcional e um `messageBody: string` obrigatório no
  parâmetro `recipient`, e retorna `{ values, redesSociaisText? }` em vez de só `values` — o 2º
  campo só vem preenchido quando a resolução foi feita NESTA chamada (precisa ser persistida pelo
  chamador). **Correção pós-revisão final** (a versão original desta adenda tinha `patrocinio`
  resolvendo incondicionalmente pra todo destinatário em modo evento — regressão real encontrada na
  revisão final do branch inteiro, que queimava a cota de `redes_sociais` mesmo em campanhas que
  nunca usam essa variável): `patrocinio` só resolve via `getSponsorPromoText(registration.eventId)`
  quando `messageBody` contém `{{patrocinio}}`; caso contrário, `""`, sem chamar a função. Mesma
  lógica pra `redes_sociais`: só entra na checagem de cache/`getSocialPromoText` quando `messageBody`
  contém `{{redes_sociais}}`; caso contrário, `""`, sem chamar a função nem consultar o cache.
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

## Adenda 2: variável de QR code da inscrição (pedido do usuário durante a execução)

Usuário pediu uma variável que envia o QR code da inscrição (o mesmo usado na retirada de kit).
Investigação confirmou que a infraestrutura já existe, reaproveitada da notificação de confirmação
de inscrição: `generateKitQrCodePng(registrationId)` (`lib/kit-qr-code.ts`, gera um PNG codificando
`Registration.id`) e `sendWhatsAppDocument(phone, base64, filename, caption, {mediatype: "image"})`
(`lib/whatsapp.ts`, já registra sucesso/falha no MessageLog).

Diferença fundamental em relação às outras variáveis: QR code não é texto, então não pode ser
substituído inline como as demais. Usar esta variável muda o MODO DE ENVIO do destinatário inteiro:
em vez de mensagem de texto, o worker envia uma imagem (o QR), usando o restante do texto renderizado
como legenda.

**Decisão confirmada com o usuário**: nova variável `qrcode_inscricao`, categoria "Inscrição" — cai
automaticamente sob a mesma guarda da Task 6 (`messageUsesEventScopedVariables`), já que Inscrição
está em `EVENT_ONLY_CATEGORIES`: uma campanha só pode agendar/disparar usando esta variável se todo
destinatário tiver `registrationId`. No preview (texto, ambos os modais), o token é substituído pelo texto de amostra (`sample`) da
variável, que descreve explicitamente o comportamento real ("a mensagem será enviada como imagem,
com este texto como legenda") — **correção pós-revisão final**: a versão original desta adenda dizia
que o token "some substituído por string vazia" no preview; na implementação real o preview usa
`SAMPLE_VALUES` (não uma string vazia), e a revisão final do branch inteiro julgou esse resultado
melhor que o especificado aqui, por explicar o modo de envio diretamente no preview — corrigindo a
spec para refletir o comportamento implementado, não o contrário. Na resolução real (envio de
campanha), o valor É `""` (ver `resolveCampaignRecipientVariables` abaixo), já que ali o texto
existe só pra o token sumir do corpo renderizado, nunca pra aparecer como legenda visível.

### Arquitetura

- **`lib/templates/variables.ts`**: nova entrada em `ALL_VARIABLES`, categoria "Inscrição",
  descrição explicando que o envio vira imagem com o texto restante como legenda.
- **`lib/campaigns/resolve-recipient-variables.ts`**: `values.qrcode_inscricao = ""` sempre (nunca
  texto real — só existe pra o token ser removido do corpo renderizado; o preview mostra o texto ao
  redor do token, sem o token em si).
- **`app/api/cron/send-campaign-messages/route.ts`**: detecta `/\{\{qrcode_inscricao\}\}/.test(campaign.messageBody)`
  no corpo BRUTO (antes de renderizar). Se presente: gera o PNG via `generateKitQrCodePng(recipient.registrationId)`
  e envia com `sendWhatsAppDocument(freshPhone, base64, "qrcode-inscricao.png", body, {mediatype: "image", messageType: "CAMPAIGN_MESSAGE"})`
  em vez de `sendWhatsAppMessage`. Um `registrationId` nulo nesse ponto (nunca deveria acontecer,
  dada a guarda da Task 6) lança um erro ANTES do try de envio — não conta pro circuit breaker,
  mesma convenção já usada pra qualquer erro que não seja uma falha de envio real.
- Nenhuma mudança em `lib/campaigns/variables.ts` — a categoria "Inscrição" já é tratada
  genericamente por `getAllowedCampaignVariables`/`messageUsesEventScopedVariables` (Task 6), sem
  necessidade de caso especial pra este nome.
- Nenhuma mudança de schema — reaproveita `CampaignRecipient.registrationId`, que já existe.

### Testes

- `resolveCampaignRecipientVariables`: `values.qrcode_inscricao` é sempre `""` em modo evento.
- Worker: mensagem com `{{qrcode_inscricao}}` chama `sendWhatsAppDocument` com o PNG gerado a partir
  do `registrationId`, não chama `sendWhatsAppMessage`; mensagem sem a variável continua chamando
  `sendWhatsAppMessage` normalmente; `registrationId` nulo com a variável presente lança erro antes
  do envio, sem contar pro circuit breaker.

## Adenda 3: correções da revisão final do branch inteiro

A revisão final (depois das 8 tasks, olhando o branch como um todo) encontrou 1 achado Crítico e
alguns Importantes/Menores que nenhuma revisão por task isolada podia ver:

- **Crítico, corrigido**: `patrocinio`/`redes_sociais` resolviam incondicionalmente pra todo
  destinatário em modo evento (Task 5), mesmo quando a mensagem nunca usa essas variáveis — uma
  campanha comum de evento queimava cota real de `SocialLinkSend` (via `getSocialPromoText`) sem
  necessidade. Corrigido: `resolveCampaignRecipientVariables` agora recebe `messageBody` e só
  resolve cada uma quando o token correspondente aparece no corpo bruto — mesmo padrão de detecção
  já usado por `qrcode_inscricao` (Adenda 2) e por `messageUsesEventScopedVariables` (Task 6). Ver
  correção na seção "Arquitetura" da Adenda 1, acima.
- **Importante, corrigido**: `app/api/admin/campaigns/variables/route.ts` (catálogo que alimenta o
  seletor "+ Inserir variável" da UI) e `app/api/admin/campaigns/alert-options/route.ts` não tinham
  sido atualizados pra `forceEventCategories: true` junto com as rotas de criar/editar (Task 6) — o
  operador não conseguia descobrir/inserir por clique as variáveis de Evento/Organizador/Inscrição
  liberadas pelas Tasks 4/5/6/8 numa campanha de plataforma. Corrigido (mesmo argumento `(null, true)`
  já usado nas rotas de criar/editar).
- **Importante, mitigado**: campanhas que usam `{{qrcode_inscricao}}` nunca reportam Entregue/Lido no
  resumo do painel (`sendWhatsAppDocument` não retorna `providerMessageId`, e o webhook de status só
  casa por esse id) — limitação pré-existente do envio de mídia, não uma regressão desta feature, mas
  agora fica visível numa campanha de verdade (antes só no fluxo de confirmação de inscrição). Em vez
  de resolver a causa raiz (fora de escopo — exigiria mudança no provedor/webhook), o painel passa a
  mostrar uma nota explicando a limitação quando a mensagem usa essa variável.
- **Menor, corrigido**: "Enviar teste" e "Enviar pra número" (envio avulso, `SAMPLE_VALUES`) agora
  rejeitam com erro claro quando a mensagem usa `{{qrcode_inscricao}}` — o avulso não tem uma
  inscrição real vinculada pra gerar o QR, e antes da correção mandava um texto confuso com o
  placeholder literal do `sample` em vez de uma imagem.
- **Menor, corrigido**: `PAGE_SIZE` do seletor de evento (`events-directory`) subiu de 20 pra um
  valor bem mais folgado — o limite rígido de 20 tornava eventos além dos 20 primeiros
  (`ORDER BY title ASC`) impossíveis de selecionar no filtro, não uma simplificação de UX como a
  entrada original de "Fora de escopo" abaixo presumia.
- **Menor, corrigido**: descrição de `qrcode_inscricao` ganhou uma nota sobre o limite de caracteres
  de legenda de mídia do WhatsApp (~1024, contra ~4096 de mensagem de texto) — um corpo promocional
  longo que funciona bem como texto pode ser truncado/rejeitado ao virar legenda de imagem.

## Fora de escopo (YAGNI)

- Suporte a "vários eventos na mesma campanha" — confirmado explicitamente como fora de escopo;
  pra isso o operador cria uma campanha por evento.
- Reimplementar envio avulso — já existe, correto como está (usa `SAMPLE_VALUES`, não afetado pela
  guarda de envio, que só importa pro disparo real via fila/worker).
- Ampliar a largura da página raiz (`max-w-2xl`) — fora do pedido explícito.
- Paginação no seletor de evento do modal de seleção manual — lista de eventos tende a ser pequena.
