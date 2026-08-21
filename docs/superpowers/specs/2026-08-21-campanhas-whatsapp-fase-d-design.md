# Campanhas de WhatsApp — Fase D: Agendamento + envio real (design)

## Contexto

Fases A-C construíram tudo que precede o envio de verdade: CRUD de campanha, população de
destinatários (`CampaignRecipient`), e composição de mensagem com preview/teste usando dados de
amostra. Esta fase (D) é a que faz uma campanha **realmente sair pro WhatsApp de atletas de
verdade** — com agendamento, execução em segundo plano, limite de envio, novas tentativas em
falha, e um disjuntor automático (circuit breaker) pra falhas em série.

O `taskwhatsapp.md` original exige, pra esta parte: opção de disparar agora ou agendar
data/horário (fuso `America/Sao_Paulo`); o agendamento sobreviver a restart/deploy/múltiplos
processos/indisponibilidade temporária; rate limiting; novas tentativas; circuit breaker.

## Descoberta importante: Evolution API não é a API oficial do WhatsApp Business

A Evolution API automatiza uma sessão de WhatsApp Web/App normal via QR code (mesmo mecanismo do
Baileys) — **não** é a Cloud API oficial da Meta. Isso muda a natureza do "rate limit": não existe
um teto numérico documentado tipo "429 depois de X req/s". O risco real é **banimento da conta**
por detecção de spam do próprio WhatsApp — e é o MESMO número já usado pros alertas transacionais
(confirmação de inscrição, erro de pagamento etc., `lib/whatsapp-settings.ts` — uma única
instância pra tudo). Um banimento pararia toda a comunicação por WhatsApp da plataforma, não só
campanhas.

Decisão confirmada com o usuário: **priorizar segurança sobre velocidade**, com folga extra em
relação ao já conservador proposto.

## Decisões de escopo (confirmadas com o usuário)

1. **O intervalo do próprio cron é o limitador de taxa** — nenhum "sleep" dentro do processo,
   nenhum estado em memória que se perde num restart. Cada execução do cron processa **no máximo 1
   destinatário**. Cron padrão: a cada 1 minuto → ~1 mensagem/minuto, bem mais conservador que
   qualquer coisa "por segundo". Configurável depois (via `PlatformSetting`) sem precisar mexer em
   código, se o número provar ser mais resiliente com o tempo.
2. **3 tentativas** antes de marcar como falha definitiva. Sem lógica de backoff separada — o
   próprio ritmo de 1/minuto já espaça as novas tentativas naturalmente (a linha só continua
   elegível e é pega nas próximas execuções, na mesma ordem de fila).
3. **Circuit breaker automático**: 5 falhas consecutivas **globais** (todas as campanhas competem
   pelo mesmo número de WhatsApp, então a falha de uma é sinal de problema sistêmico pra todas) →
   todas as campanhas `RUNNING` viram `PAUSED` automaticamente. Retomar por enquanto é manual
   (direto no banco, já que o botão de pausar/retomar da UI é da Fase F) — mas `PAUSED` é o mesmo
   status que F vai reaproveitar, então não há retrabalho.
4. **Segurança básica contra tick sobreposto, não concorrência real**: antes de processar, o tick
   confere se algum `CampaignRecipient` já está em `PROCESSING`; se estiver, não faz nada nesse
   tick (idempotente, tenta de novo no próximo minuto). Isso evita duplo-processamento óbvio dentro
   de UM container, mas **não** é uma trava distribuída (não protege contra múltiplas instâncias do
   app rodando o mesmo cron) — resolver isso de verdade é o escopo explícito da Fase F.

## Arquitetura

### Schema: 3 campos novos em `CampaignRecipient`

```prisma
model CampaignRecipient {
  // ... campos existentes (Fase B) ...
  attempts          Int       @default(0)
  providerMessageId String?
  sentAt            DateTime?
  // failureReason já existe desde a Fase B
}
```

Nenhum campo novo em `Campaign` — `scheduledAt` já existe desde a Fase A, nunca usado até agora.

### `sendWhatsAppMessage` passa a devolver o `providerMessageId`

Mudança pequena e retrocompatível em `lib/whatsapp.ts`: a assinatura muda de `Promise<void>` para
`Promise<{ providerMessageId?: string }>`. Nenhum call site existente quebra (nenhum usa o valor de
retorno hoje). Necessário porque a Fase E (status de entrega) vai precisar correlacionar um webhook
de entrega/leitura de volta pro `CampaignRecipient` certo, e o id só existe no momento do envio —
capturar agora é o produto natural de uma operação que esta fase já faz, não schema adiantado sem
uso (ao contrário de `campaignsEnabled` ou `CampaignRecipient` em si nas fases anteriores, que
eram, de fato, adiantados).

### Refinamento em `getAllowedCampaignVariables` (Fase C): excluir `patrocinio` e `redes_sociais`

Achado durante o design desta fase: essas 2 variáveis da categoria "Evento" têm **efeito
colateral** (incrementam contador de cota de envio por link/patrocinador,
`lib/event-social-links.ts`/lógica equivalente de patrocínio) e foram desenhadas pra um contexto de
**um envio por inscrição** (um alerta de confirmação por vez). Numa campanha, o mesmo texto seria
renderizado pra centenas/milhares de destinatários — chamar esses resolvedores nesse volume
gastaria a cota de forma descontrolada e nunca foi o uso pretendido. `getAllowedCampaignVariables`
(`lib/campaigns/variables.ts`) passa a excluir explicitamente esses 2 nomes mesmo em modo evento,
via uma lista de exclusão, deixando as outras ~10 variáveis da categoria Evento intactas.

### `lib/campaigns/resolve-recipient-variables.ts` (novo)

Dado um `CampaignRecipient`, monta o `Record<string, string>` de valores REAIS (não mais
`SAMPLE_VALUES`) pras variáveis permitidas no modo daquela campanha:

```ts
export async function resolveCampaignRecipientVariables(
  recipient: { athleteUserId: string; registrationId: string | null },
): Promise<Record<string, string>>
```

- Sempre resolve as categorias Atleta (nome, primeiro nome, e-mail, telefone, CPF, data de
  nascimento, equipe — de `User`+`AthleteProfile`) e Plataforma (nome da plataforma, e-mail/telefone
  de suporte, link, ano atual — mesmas fontes já usadas em `lib/templates/variables.ts`'s
  `sample`/descrição de cada uma, agora resolvendo o valor de verdade em vez do texto de amostra).
- Quando `registrationId` não é nulo (campanha de evento), busca a `Registration` (com
  `event`/`event.organizer`/`order`/`route`/`category`) e resolve também Evento, Organizador e
  Inscrição (exceto `patrocinio`/`redes_sociais`, ver acima).
- Quando `registrationId` é nulo (campanha de plataforma), resolve só Atleta+Plataforma — mais
  simples, sem precisar de nenhuma junção com evento/inscrição, já que `getAllowedCampaignVariables`
  já garante que o texto da campanha nunca contém uma variável de Evento/Organizador/Inscrição
  nesse modo (nada pra resolver ali).
- Formatação (datas em `dd/mm/aaaa`, valores em R$, etc.) replica exatamente o padrão já usado nos
  outros resolvedores de variável deste projeto (`lib/notifications.ts`, `lib/alerts/*.ts`).

### `POST /api/cron/send-campaign-messages` (novo)

Mesmo padrão de autenticação dos outros crons (`x-cron-secret` contra `CRON_SECRET`,
`app/api/cron/expire-payments/route.ts`). Um único ciclo, chamado a cada execução:

1. **Promover agendadas**: `Campaign.status = SCHEDULED AND scheduledAt <= now()` → `RUNNING`.
2. **Guarda contra tick sobreposto**: se existe algum `CampaignRecipient.status = PROCESSING`, para
   aqui (não processa nada nesse ciclo).
3. **Circuit breaker já disparado?** Se o contador de falhas consecutivas (`PlatformSetting`,
   `campaign_consecutive_failures`) já atingiu 5, não processa (as campanhas já foram postas em
   `PAUSED` quando isso aconteceu — este passo é só a garantia de não reprocessar entre o momento
   da pausa e uma eventual retomada manual).
4. **Escolhe 1 destinatário**: a campanha `RUNNING` mais antiga (por `createdAt`) que ainda tem
   algum `CampaignRecipient.status = PENDING`; dentro dela, o `CampaignRecipient` `PENDING` mais
   antigo (por `createdAt`). Se nenhuma campanha `RUNNING` tem pendente, marca ela como `COMPLETED`
   (nenhum `PENDING` restante) e não faz mais nada neste ciclo.
5. **Marca `PROCESSING`**, re-checa `receivePromotionalMessages` do atleta AGORA (não confia só no
   snapshot da preparação de destinatários — uma campanha grande pode levar dias no ritmo de
   1/minuto, tempo de sobra pra alguém mudar de ideia em `/preferencias`) — se tiver revogado nesse
   meio-tempo, marca `OPTED_OUT` e encerra o ciclo sem enviar nada.
6. **Resolve variáveis reais** (`resolveCampaignRecipientVariables`), renderiza com `renderTemplate`
   + `buildPreferencesFooterText()` (mesma composição exata da Fase C — nunca passar também
   `appendPreferencesFooter: true` pro `sendWhatsAppMessage`, senão duplica o rodapé).
7. **Envia** via `sendWhatsAppMessage(phone, texto, "CAMPAIGN_MESSAGE")`. Sucesso: `status: SENT`,
   `sentAt`, `providerMessageId`; zera o contador de falhas consecutivas. Falha: `attempts += 1`;
   se `< 3`, volta pra `PENDING` (nova tentativa num ciclo futuro); se `>= 3`, vira `FAILED` com
   `failureReason`; em qualquer falha, incrementa o contador global de falhas consecutivas — se
   atingir 5, marca TODAS as campanhas `RUNNING` como `PAUSED` (não só a atual).

### UI

O resumo de destinatários (`recipients/summary`, já existente desde a Fase B, `groupBy(status)`)
passa a mostrar `SENT`/`FAILED` de verdade assim que esta fase escrever esses status — nenhuma
mudança na exibição do resumo é necessária pra isso aparecer.

Único ajuste de UI necessário: hoje não há como o organizador/admin escolher "agora" vs. uma
data/hora, nem transicionar a campanha de `DRAFT` pra `SCHEDULED`/`RUNNING`. Adiciona ao
`CampaignsManager.tsx`: no modal de edição de uma campanha `DRAFT`, um botão "Agendar envio" (abre
um seletor de data/hora, timezone `America/Sao_Paulo`) e um botão "Disparar agora" — os dois chamam
a rota nova `POST .../schedule` (com `{ scheduledAt?: string }` no corpo; omitido = agora).

### Novas rotas: `POST .../campaigns/[campaignId]/schedule` (por árvore)

`campaigns.edit`. Exige a campanha estar `DRAFT` e já ter `CampaignRecipient` preparados (`Preparar
destinatários` já rodado — 400 caso contrário, mensagem clara). Corpo opcional `{ scheduledAt?:
string (ISO) }`: se ausente, `status: RUNNING`, `scheduledAt: null`; se presente, `status:
SCHEDULED`, `scheduledAt` gravado (validação: precisa ser no futuro).

## Fora de escopo desta fase (fica pra depois)

- Botão manual de pausar/retomar (Fase F) — o disjuntor desta fase só pausa automaticamente, nunca
  expõe um controle manual.
- Concorrência real entre múltiplos processos/instâncias do app (Fase F) — a guarda desta fase
  (checar `PROCESSING`) só cobre sobreposição dentro de UM container.
- Status de entrega/leitura via webhook e métricas agregadas de campanha (Fase E) — esta fase só
  escreve `SENT`/`FAILED`; `DELIVERED`/`READ` continuam sem nenhum código que os grave ainda.
- Qualquer alteração no formato dos crons já existentes (`expire-payments` etc.) além de adicionar
  este novo.

## Testes

- `lib/campaigns/variables.ts`: teste novo confirmando que `patrocinio`/`redes_sociais` nunca
  aparecem em `getAllowedCampaignVariables`, em nenhum dos dois modos.
- `resolveCampaignRecipientVariables`: teste cobrindo modo evento (todas as 5 categorias corretas,
  formatação de data/valor) e modo plataforma (só Atleta+Plataforma, sem nenhuma consulta a
  Registration/Event).
- Rota do cron: teste cobrindo, em ciclos separados — promoção de `SCHEDULED`→`RUNNING`; guarda de
  `PROCESSING` ativa impede processamento; escolha do destinatário mais antigo da campanha mais
  antiga; re-checagem de `receivePromotionalMessages` no momento do envio (revogado depois da
  preparação → `OPTED_OUT`, não envia); sucesso grava `SENT`/`sentAt`/`providerMessageId` e zera o
  contador de falhas; falha com `attempts < 3` volta pra `PENDING`; falha na 3ª tentativa vira
  `FAILED`; 5ª falha consecutiva (acumulada entre chamadas) pausa TODAS as campanhas `RUNNING`,
  não só a que falhou; campanha sem mais `PENDING` vira `COMPLETED`.
- Rotas `.../schedule`: 400 sem destinatários preparados; agenda corretamente com data futura; 400
  com data no passado; "disparar agora" (sem `scheduledAt`) vai direto pra `RUNNING`.
- `sendWhatsAppMessage`: teste confirmando o novo retorno `{ providerMessageId? }` em sucesso,
  garantindo que nenhum teste existente que ignora o retorno quebrou.
