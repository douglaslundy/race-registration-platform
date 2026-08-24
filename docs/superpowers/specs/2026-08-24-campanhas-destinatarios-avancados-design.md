# Campanhas de WhatsApp — Destinatários avançados + UX (design)

## Contexto

Hoje uma campanha só tem 2 modos implícitos de destinatário, ambos **automáticos**: evento
específico (`eventId` não-nulo, popula com os inscritos do evento) ou plataforma inteira
(`eventId` nulo, popula com todo `User` `role: "ATHLETE"` ativo que consentiu). Não existe seleção
manual de destinatários, nem envio avulso pra um número digitado na hora. Também não existe forma
de excluir uma campanha (só cancelar, que muda o `status`, nunca remove a linha), o preview exige
clicar num botão e abrir um modal (não atualiza enquanto o operador digita), e não há nenhuma tela
pra ver quem optou por não receber mensagens promocionais.

Este design cobre 5 melhorias pedidas pelo usuário, todas na mesma área (gestão de campanhas):

1. Seleção manual de destinatários (plataforma), com paginação/busca real no backend.
2. Envio avulso pra um número de telefone digitado na hora.
3. Excluir uma campanha que nunca teve nenhum envio real.
4. Preview da mensagem atualizando ao vivo enquanto o operador digita.
5. Nova aba, dentro de Campanhas (admin), listando atletas que optaram por não receber.

**Nenhuma mudança de schema é necessária** — tudo aqui é composto em cima de tabelas e campos que
já existem (`User.receivePromotionalMessages`, `AthleteProfile.phone`, `CampaignRecipient.status`).

## Decisões confirmadas com o usuário

- Seleção manual é só de **atletas** (mesmo escopo que o modo automático já usa hoje) — não inclui
  organizadores/admins/assistentes.
- Seleção manual **continua respeitando consentimento** — um atleta com
  `receivePromotionalMessages: false` nem aparece na lista pra selecionar, exatamente como o modo
  automático já filtra. Isso não é negociável: abrir uma brecha pra ignorar opt-out manualmente
  destruiria a garantia que as Fases A-D inteiras foram construídas pra proteger.
- Seleção manual é **só pra campanhas de plataforma** (admin, `eventId` nulo) — campanhas de evento
  continuam só com o modo automático de hoje (os inscritos do evento). Não foi pedido escopo
  manual pra evento, e o "evento" já É a segmentação natural nesse caso.
- A lista de seleção manual precisa de **paginação e busca de verdade no backend** — a base de
  atletas é pequena hoje mas vai crescer, então nada de carregar tudo de uma vez pra renderizar.
  "Marcar todos" busca só os **IDs** que batem com a busca atual (uma chamada leve, sem os outros
  campos) e adiciona todos ao conjunto selecionado no cliente — continua correto e rápido mesmo
  com muitos milhares de atletas, sem precisar carregar a lista inteira de dados pra isso.
- Envio pra número específico é **imediato e direto**, não entra na fila/worker de campanha — é um
  destinatário só, não precisa de rate-limit, retry, nem circuit breaker. Mesmo padrão do "Enviar
  teste" que já existe (`test-send/route.ts`), generalizado pra qualquer número digitado em vez do
  telefone do próprio operador.
- Excluir campanha é permitido quando **zero destinatários têm status `SENT`/`DELIVERED`/`READ`/
  `FAILED`** — ou seja, nada foi de fato tentado enviar ainda, independente do `status` da própria
  campanha (`DRAFT`, `SCHEDULED`, `PAUSED`, `CANCELLED` todos qualificam se a condição de zero
  envios reais for satisfeita).
- A aba de opt-outs fica **dentro de `/admin/campanhas`**, ao lado da lista de campanhas.

## Arquitetura

### 1. Seleção manual de destinatários

**Backend — 2 rotas novas, só admin (platform-wide):**

- `GET /api/admin/campaigns/recipients-directory?q=&page=&pageSize=` — lista paginada de atletas
  elegíveis (mesmo `WHERE` que `fetchCandidateBatch` já usa hoje pro modo automático:
  `role: "ATHLETE", active: true, receivePromotionalMessages: true`), com `q` opcional filtrando
  por `name`/`email`/`athleteProfile.phone` (`contains`, `insensitive`). Resposta:
  `{ rows: { id, name, email, phone }[], total, page, pageSize, totalPages }` — mesmo contrato de
  `listMessageLogs` (`lib/message-logs.ts`), reaproveitado pra consistência.
- `GET /api/admin/campaigns/recipients-directory/ids?q=` — mesmo filtro (incluindo `q`), mas
  devolve só `{ ids: string[] }`, sem paginação — usado pelo botão "Marcar todos" pra pegar todo
  mundo que bate com a busca atual, não só a página visível.

**Backend — reaproveita `prepareCampaignRecipients` (`lib/campaigns/recipients.ts`):**

Novo parâmetro opcional `athleteUserIds?: string[]`. Quando presente, `fetchCandidateBatch`
(branch `eventId === null`) restringe o `WHERE` com `id: { in: athleteUserIds }`, além do
`role`/`active` que já tinha. O resto da função (consentimento, validação/normalização de
telefone, dedup) não muda — mesmo comportamento, só com um universo de candidatos menor e
explícito em vez de "todo mundo".

A rota `POST /api/admin/campaigns/[campaignId]/prepare-recipients/route.ts` passa a ler um corpo
JSON opcional `{ athleteUserIds?: string[] }` e repassar pra `prepareCampaignRecipients`. Sem
corpo (ou corpo vazio), comportamento idêntico ao de hoje (modo automático). A rota event-scoped
(`app/api/events/[id]/campaigns/[campaignId]/prepare-recipients/route.ts`) **não muda** — seleção
manual não se aplica a campanhas de evento.

**UI (`CampaignsManager.tsx`):** um novo prop `allowManualRecipients?: boolean`, passado como
`true` só em `app/admin/campanhas/page.tsx` (a instância de plataforma). Quando `true`, o botão
"Preparar destinatários" ganha um segundo botão ao lado ("Selecionar destinatários"), que abre um
modal com: campo de busca, lista paginada com checkbox por linha, "Marcar todos" (chama
`.../ids?q=`, adiciona ao `Set` local de selecionados), "Desmarcar todos" (limpa o `Set`),
contador de quantos estão selecionados, e um botão final "Preparar com estes destinatários" que
chama `POST .../prepare-recipients` com `{ athleteUserIds: [...Array.from(selectedIds)] }`.

### 2. Envio avulso pra número específico

**Backend — 1 rota nova, só admin:**
`POST /api/admin/campaigns/[campaignId]/send-to-number/route.ts` — permissão `campaigns.edit`
(mesma das outras ações de composição). Corpo `{ phone: string }`. Normaliza com
`normalizePhoneForWhatsApp` (já existe, já assume Brasil quando não vem DDI) e valida com
`isValidWhatsAppPhone` (já existe) — 400 se inválido. Renderiza com `SAMPLE_VALUES` (não há um
atleta real associado a um número digitado na hora — mesma decisão que `test-send` já toma) e
chama `sendWhatsAppMessage(phone, body, "CAMPAIGN_MESSAGE")` diretamente, sem passar por
`CampaignRecipient`/fila. Resposta `{ ok: true }` ou erro. Não precisa existir a versão
event-scoped — "número específico" é uma ação avulsa de operador, mesmo escopo administrativo do
"Enviar teste".

**UI:** um campo de telefone + botão "Enviar para este número" perto do "Enviar teste" já
existente, com `ConfirmModal` (tone `danger`, já que dispara um envio real e imediato) —
exatamente o mesmo padrão de risco do "Disparar agora" já implementado na Fase D.

### 3. Excluir campanha sem envio

**Backend — 2 rotas novas (evento + admin, mesmo padrão de `cancel`/`pause`/`resume`):**
`DELETE /api/events/[id]/campaigns/[campaignId]/route.ts` e
`DELETE /api/admin/campaigns/[campaignId]/route.ts` (mesmo arquivo de rota que já tem
`GET`/`PATCH`, só adiciona o `export async function DELETE`). Permissão `campaigns.edit`. Conta
`db.campaignRecipient.count({ where: { campaignId, status: { in: ["SENT", "DELIVERED", "READ",
"FAILED"] } } })` — se maior que 0, 400 ("Não é possível excluir uma campanha que já teve envios
reais"). Caso contrário, `db.campaignRecipient.deleteMany({ where: { campaignId } })` seguido de
`db.campaign.delete({ where: { id: campaignId } })`, dentro de uma `db.$transaction` (evita
destinatários órfãos se o segundo delete falhar). Audit log `CAMPAIGN_DELETED`.

**UI:** o card de campanha já tem `recipientSummaries[campaign.id]` (Fase E), que já traz
`sent`/`delivered`/`read`/`failed` — a condição `canDelete` é computada **no cliente**, sem
endpoint novo: `(summary?.sent ?? 0) + (summary?.delivered ?? 0) + (summary?.read ?? 0) +
(summary?.failed ?? 0) === 0` (uma campanha nunca preparada, sem `recipientSummaries[id]` ainda,
também qualifica — soma de `undefined` vira 0). Botão "Excluir" aparece quando essa condição é
verdadeira, com `ConfirmModal` (tone `danger`, mensagem deixando claro que é permanente,
diferente de "Cancelar" que só muda o status).

### 4. Preview ao vivo

`renderTemplate` (`lib/templates/render.ts`) e `SAMPLE_VALUES` (`lib/templates/variables.ts`) são
funções/constantes puras, sem nenhum import de servidor (confirmado lendo os dois arquivos) —
seguro importar direto num componente `"use client"`. `CampaignsManager.tsx` passa a computar,
durante o render (sem `useEffect`, sem debounce, sem chamada de rede):

```ts
const livePreview = renderTemplate(editForm.messageBody, SAMPLE_VALUES, "WHATSAPP");
```

E mostra isso num painel ao lado do `<textarea>` do corpo da mensagem (rodapé de preferências não
entra aqui — é estático e já é visível no botão "Visualizar" existente, que continua exatamente
como está hoje pra conferência final antes de agendar/disparar). Grid de 2 colunas quando há
espaço (`md:grid-cols-2`), empilhado em telas estreitas.

### 5. Aba de atletas que optaram por não receber

**Backend:** nova função em `lib/campaigns/recipients.ts` (ou um arquivo novo
`lib/campaigns/opted-out.ts`, decisão do implementador): `listOptedOutAthletes({ q?, page,
pageSize })` — mesmo contrato de paginação de `listMessageLogs`, `WHERE: { role: "ATHLETE",
receivePromotionalMessages: false }` (mais o filtro de busca `q` se vier), `ORDER BY name asc`.

**UI:** `app/admin/campanhas/page.tsx` ganha 2 abas simples (só troca o que renderiza, sem mudar de
rota — `useState` local, `"campanhas" | "optouts"`): "Campanhas" (o `CampaignsManager` que já
existe, sem mudança) e "Opt-outs" (página nova, servidor, mesmo padrão de busca+paginação de
`app/admin/mensagens/page.tsx` — formulário GET, `getPaginationRange`, tabela simples com
nome/e-mail/telefone).

## Testes

- `prepareCampaignRecipients` com `athleteUserIds`: restringe candidatos corretamente, mantém
  consentimento/telefone/dedup funcionando igual; sem o parâmetro, comportamento idêntico ao atual
  (regressão coberta pelos testes já existentes).
- `recipients-directory` (rows + ids): filtro de busca, paginação, respeita consentimento/role/
  active.
- `send-to-number`: normaliza corretamente com/sem `+55`, rejeita telefone inválido, chama
  `sendWhatsAppMessage` com `SAMPLE_VALUES` renderizado.
- `DELETE` (evento + admin): permite quando zero enviados, rejeita quando há `SENT` etc.,
  transação não deixa `CampaignRecipient` órfão se o segundo delete falhar.
- `listOptedOutAthletes`: filtro correto, paginação, busca.
- UI: sem suíte de componente pra `CampaignsManager.tsx` (mesma situação já registrada nas Fases
  D/E/F) — mudanças de UI verificadas por leitura direta do código.

## Fora de escopo (YAGNI)

- Seleção manual pra campanhas de evento (não foi pedido — o evento já é a segmentação natural).
- Envio avulso entrando na fila/worker (decisão explícita: imediato e direto, sem fila).
- Qualquer mudança de schema — tudo é composto em cima do que já existe.
- Undo/lixeira pra campanha excluída — a condição de "zero envios reais" já torna a exclusão
  segura (nada foi de fato mandado), então um `delete` de verdade é aceitável sem soft-delete.
