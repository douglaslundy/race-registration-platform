# Campanhas de WhatsApp — Fase F: Pausar/retomar manual + concorrência real (design)

## Contexto

A Fase D entregou o worker de envio (`app/api/cron/send-campaign-messages/route.ts`) com uma
guarda de concorrência explicitamente provisória: antes de processar qualquer destinatário, o
worker checa se **algum** `CampaignRecipient` de **qualquer** campanha está com `status:
"PROCESSING"` e, se sim, não faz nada naquele tick. Essa guarda só resolve sobreposição dentro de
UM container (dois ticks do mesmo processo rodando ao mesmo tempo) — não impede duas execuções
concorrentes de reivindicarem o mesmo destinatário se um dia houver mais de um container/processo
rodando o cron. A Fase D também deixou um circuit breaker global (`lib/campaigns/circuit-breaker.ts`)
cuja recuperação, hoje, exige edição manual direta no banco em 2 lugares (status da campanha +
contador de falhas) — não existe nenhuma rota nem botão de pausar/retomar.

Esta fase fecha as duas lacunas: (1) torna a reivindicação de destinatário atômica por linha, sem
depender de nenhuma trava global nem de infraestrutura nova (Redis, lock distribuído); (2) dá ao
operador um jeito de pausar uma campanha em andamento e retomá-la depois, com um clique — inclusive
quando a pausa veio do circuit breaker.

## Decisões confirmadas com o usuário

1. **Reivindicação atômica por destinatário, não lock global.** Cada tentativa de processar um
   destinatário faz um `UPDATE ... WHERE id = ? AND status = 'PENDING'` condicional — só um
   processo consegue "ganhar" aquela linha; o outro simplesmente não processa nada naquele tick e
   segue pro próximo. Resolve o caso real de hoje (1 container) e continua correto se um dia
   houver mais de um, sem precisar de nenhuma peça de infraestrutura nova.
2. **Varredura de recuperação automática, 5 minutos.** No início de cada tick, qualquer
   `CampaignRecipient` com `status: "PROCESSING"` cujo `updatedAt` seja mais antigo que 5 minutos
   volta sozinho pra `PENDING`. Um tick normal dura segundos — 5 minutos preso só acontece se o
   processo morreu no meio do envio (OOM kill, restart do container, etc.). Substitui a guarda
   global antiga: em vez de bloquear tudo por causa de UM destinatário travado, o sistema se
   autocorrige sem intervenção manual.
3. **Pausar/retomar manual, mesma permissão de agendar (`campaigns.edit`), sem chave de permissão
   nova.** Retomar reseta o contador do circuit breaker **somente se ele estiver de fato disparado**
   (≥ 5) — nunca zera um contador parcial (ex: 3 falhas seguidas, ainda não disparado) só porque
   uma campanha não relacionada foi pausada/retomada manualmente.

## Arquitetura

### 1. Reivindicação atômica (`app/api/cron/send-campaign-messages/route.ts`)

Substitui os passos 2 (guarda `PROCESSING` global) e a atualização simples pra `PROCESSING` do
passo 4 por:

```ts
// 1. Promove campanhas agendadas (sem mudança).

// 2. Varredura de recuperação: destinatário preso em PROCESSING há mais de 5 minutos volta
// sozinho pra PENDING — normalmente só acontece se um processo anterior morreu no meio do envio.
const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
await db.campaignRecipient.updateMany({
  where: { status: "PROCESSING", updatedAt: { lt: staleThreshold } },
  data: { status: "PENDING" },
});

// 3. Circuit breaker já disparado — não processa nada (sem mudança de posição, sem mudança de lógica).
if (await isCircuitBreakerTripped()) {
  return NextResponse.json({ processed: false, reason: "circuit_breaker_tripped" });
}

// 4. Escolhe o próximo candidato (mesma query de sempre).
const candidate = await db.campaignRecipient.findFirst({
  where: { status: "PENDING", campaign: { status: "RUNNING" } },
  orderBy: [{ campaign: { createdAt: "asc" } }, { createdAt: "asc" }],
});

if (!candidate) {
  // sweep de conclusão de campanhas sem nada pendente (sem mudança).
}

// 5. Reivindicação atômica: só avança se ESTE processo conseguiu marcar a linha como PROCESSING
// (WHERE ainda inclui status: "PENDING" — se outro processo já reivindicou entre o findFirst e
// aqui, count vem 0 e a gente simplesmente não processa nada neste tick, sem erro).
const claim = await db.campaignRecipient.updateMany({
  where: { id: candidate.id, status: "PENDING" },
  data: { status: "PROCESSING" },
});
if (claim.count === 0) {
  return NextResponse.json({ processed: false, reason: "lost_claim_race" });
}
const recipient = candidate;
// ...resto do try/catch de envio permanece EXATAMENTE como está hoje (consentimento fresco,
// telefone fresco, resolução de variáveis, envio, bookkeeping de attempts/PENDING/FAILED, circuit
// breaker só em falha de envio real — nada disso muda nesta fase).
```

Note que a checagem de `isCircuitBreakerTripped()` muda de posição relativa (antes vinha depois da
guarda global; agora vem depois da varredura, antes da busca do candidato) — comportamento
equivalente, só reordenado porque a guarda que existia entre os dois passos foi removida.

### 2. Pausar/retomar (rotas novas, par evento + admin, mesmo padrão de `cancel`/`schedule`)

- `app/api/events/[id]/campaigns/[campaignId]/pause/route.ts` +
  `app/api/admin/campaigns/[campaignId]/pause/route.ts`: `POST`, permissão `campaigns.edit`. Só
  aceita campanha com `status: "RUNNING"` (400 com mensagem clara caso contrário). Seta
  `status: "PAUSED"`.
- `app/api/events/[id]/campaigns/[campaignId]/resume/route.ts` +
  `app/api/admin/campaigns/[campaignId]/resume/route.ts`: `POST`, permissão `campaigns.edit`. Só
  aceita campanha com `status: "PAUSED"` (400 caso contrário). Seta `status: "RUNNING"` e chama a
  função nova `resetCircuitBreakerIfTripped()` (ver abaixo). Resposta inclui
  `{ campaign, breakerWasReset: boolean }`.

### 3. Circuit breaker (`lib/campaigns/circuit-breaker.ts`)

Nova função, ao lado das 3 já existentes:

```ts
/** Chamado só pela rota de retomar campanha. Só reseta o contador se ele estiver REALMENTE
 * disparado (>= 5) — nunca zera uma contagem parcial de falhas (ex: 3 seguidas, ainda não
 * disparado) só porque uma campanha não relacionada foi retomada manualmente. */
export async function resetCircuitBreakerIfTripped(): Promise<boolean> {
  const tripped = await isCircuitBreakerTripped();
  if (tripped) await writeCount(0);
  return tripped;
}
```

### 4. UI (`components/campaigns/CampaignsManager.tsx`)

No card de cada campanha, ao lado dos botões já existentes:

- `status === "RUNNING"`: botão "Pausar" (mesmo padrão dos botões existentes: state
  `pausingConfirmId` + `ConfirmModal` tone `"danger"`, mensagem explicando que a campanha vai
  parar de enviar imediatamente) → `POST .../pause` → `reload()`.
- `status === "PAUSED"`: botão "Retomar" (state `resumingConfirmId` + `ConfirmModal` tone
  `"danger"`, mensagem explicando que o envio real volta a acontecer e que, se a pausa foi causada
  por falhas consecutivas, o contador de falhas também será reiniciado) → `POST .../resume` →
  `reload()`.

Mesmo wiring de erro já usado em `doCancel`/`doSchedule` (`actionError` + `ErrorModal` já existente
no topo do componente — nenhum componente novo).

## Testes

- `app/api/cron/send-campaign-messages/route.ts`: teste novo pra varredura de recuperação (um
  `PROCESSING` velho volta pra `PENDING` antes de qualquer outra coisa); teste novo pra corrida
  perdida (`updateMany` da reivindicação retorna `count: 0` → resposta
  `{ processed: false, reason: "lost_claim_race" }`, nenhum efeito colateral, `sendWhatsAppMessage`
  nunca chamado). O teste antigo que validava a guarda global (`processing_in_progress`) é
  **substituído** por esses dois — a guarda que ele testava não existe mais.
- Rotas de pausar/resumir (evento + admin): transição válida (RUNNING→PAUSED,
  PAUSED→RUNNING), status inválido (400), e — só pro resume — 2 casos do reset do breaker
  (contador ≥ 5 é zerado e a resposta traz `breakerWasReset: true`; contador < 5 não é tocado e a
  resposta traz `breakerWasReset: false`).
- `resetCircuitBreakerIfTripped`: reseta quando disparado, não mexe quando não disparado, retorna
  o booleano correto nos dois casos.
- UI: sem suíte de componente pra `CampaignsManager.tsx` (mesma situação já registrada nas Fases D
  e E) — mudança verificada por leitura direta do código, não por teste automatizado.

## Fora de escopo (YAGNI, não faz parte desta fase)

- Lock distribuído de verdade (Redis, advisory lock do Postgres) — a reivindicação atômica por
  linha já resolve o problema real sem precisar de infraestrutura nova; só valeria a pena se
  múltiplos containers virarem um plano concreto de curto prazo.
- Qualquer mudança de schema — nenhum campo novo é necessário (`updatedAt` já existe em
  `CampaignRecipient` via `@updatedAt`; `PAUSED` já existe no enum `CampaignStatus`).
- Notificar o operador (e-mail/alerta) quando o circuit breaker dispara — fica pra uma fase futura,
  se vier a ser pedido.
