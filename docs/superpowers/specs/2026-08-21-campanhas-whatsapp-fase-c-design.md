# Campanhas de WhatsApp — Fase C: Composição de mensagem (design)

## Contexto

Fase A construiu o CRUD de `Campaign` (por evento, `DRAFT ⇄ CANCELLED`). Fase B construiu a
população de destinatários (`CampaignRecipient`), incluindo o modo plataforma inteira
(`eventId: null`, admin-only). Esta fase (C) constrói a **composição da mensagem**: catálogo de
variáveis, motor de renderização, preview, envio de teste, e um atalho pra começar a partir de um
alerta já existente — tudo isso sem tocar em envio real (isso é Fase D).

O `taskwhatsapp.md` original exige, para esta parte: uma única fonte de verdade pro catálogo de
variáveis (não duas listas divergentes entre front e back); um motor de renderização único,
compartilhado entre preview e envio real, sem `eval`; um botão "Visualizar" que nunca envia
WhatsApp de verdade; um "Enviar teste" pra um telefone autorizado, marcado como teste, fora das
métricas reais da campanha; e a opção de partir de um alerta/template já cadastrado como ponto de
partida (cópia única, sem vínculo).

## Descoberta: a infraestrutura já existe

O sistema de alertas (`lib/templates/`) já implementa exatamente o que esta fase precisa, com um
histórico de produção comprovado:

- `lib/templates/variables.ts` — `ALL_VARIABLES: VariableDefinition[]` (nome, label, categoria,
  descrição, valor de exemplo), única fonte de verdade, ~90 variáveis reais hoje.
- `lib/templates/render.ts` — `renderTemplate(body, values, channel)` (substitui `{{var}}`, sem
  `eval`, escapa HTML no canal EMAIL, remove caracteres de controle no WHATSAPP) e
  `validateTemplateVariables(body, allowedVariables)` (retorna `{ valid, unknown[] }`).
- `lib/templates/resolve.ts` — `getEffectiveTemplate(alertKey, channel, recipientRole, eventId?)`,
  que resolve o texto que o alerta **realmente envia hoje** (override de evento → override global →
  padrão de fábrica).
- `app/api/admin/message-templates/[id]/preview/route.ts` e `.../test-send/route.ts` — já
  implementam preview com `SAMPLE_VALUES` (amostra de cada variável) e "enviar teste pro meu
  próprio telefone/e-mail", nunca lendo destinatário do corpo da requisição.
- `components/admin/MessageTemplateEditor.tsx` — editor com catálogo de variáveis pesquisável,
  contador implícito (textarea), preview inline, teste, histórico de versões.

Esta fase **reutiliza** `variables.ts`/`render.ts`/`resolve.ts` sem modificação de comportamento, e
segue o mesmo padrão de preview/test-send dos dois arquivos acima — não inventa um segundo motor de
templates. `MessageTemplateEditor.tsx` não é reutilizado diretamente (está fortemente acoplado ao
formato de `MessageTemplate`, com campos irrelevantes pra campanha — `subject`/`channel` toggle
EMAIL/WHATSAPP, `rowTemplate`, histórico de versões com `revert`); em vez disso, o
`CampaignsManager.tsx` existente ganha uma versão compacta do mesmo conceito.

## Decisões de escopo (confirmadas com o usuário)

1. **Catálogo de variáveis depende do modo da campanha.** Categorias `Atleta` e `Plataforma` estão
   sempre disponíveis. Categorias `Evento`, `Organizador` e `Inscrição` só ficam disponíveis quando
   a campanha tem `eventId` (não-nulo) — nunca em campanhas de plataforma inteira, onde essas
   variáveis não têm como resolver pra um valor real. Isso vale tanto pro catálogo mostrado na UI
   quanto pra validação no backend — são a mesma função, nunca duas listas.
2. **Atalho "partir de um alerta existente" está incluído nesta fase.** Só na tela de **criar**
   campanha (não na edição de uma campanha já existente). Lista alertas de canal WHATSAPP cujo
   `recipientRoles` inclui `BUYER` ou `ATHLETE` (os únicos papéis compatíveis com "quem recebe uma
   campanha"), resolve o texto **efetivo** de cada um via `getEffectiveTemplate` (respeitando
   customização por evento, se a campanha for de um evento específico) e copia o texto pro campo da
   campanha com um clique — cópia única, sem vínculo com o alerta original a partir daí.
3. **"Enviar teste" vai sempre pro telefone da própria conta de quem clicou** (organizador ou
   admin), nunca um número informado na requisição — mesmo padrão de segurança já usado em
   `message-templates/[id]/test-send`.
4. **Preview e teste operam sobre o `messageBody` já salvo da campanha**, não sobre um rascunho não
   salvo no textarea — mesmo comportamento de `MessageTemplateEditor`. Por isso os dois botões só
   aparecem depois que a campanha já existe (modal de edição), não no formulário de criação.
5. **Layout compacto, sem redesenho.** Um seletor categorizado de variáveis (não um painel lateral)
   insere `{{variavel}}` no cursor do textarea; contador de caracteres abaixo; "Visualizar" e
   "Enviar teste" abrem o resultado numa janela/modal pequena. O formulário de criação e o modal de
   edição continuam do jeito que são hoje, apenas ganhando esses elementos.

## Arquitetura

### `lib/campaigns/variables.ts` (novo)

Única função de decisão de "quais variáveis uma campanha pode usar", consumida tanto pela validação
quanto pelo endpoint que alimenta o dropdown da UI — não pode haver dois lugares decidindo isso
separadamente.

```ts
import { ALL_VARIABLES, type VariableDefinition } from "@/lib/templates/variables";

const ALWAYS_CATEGORIES = ["Atleta", "Plataforma"];
const EVENT_ONLY_CATEGORIES = ["Evento", "Organizador", "Inscrição"];

export function getAllowedCampaignVariables(eventId: string | null): VariableDefinition[] {
  const categories = new Set(
    eventId !== null ? [...ALWAYS_CATEGORIES, ...EVENT_ONLY_CATEGORIES] : ALWAYS_CATEGORIES,
  );
  return ALL_VARIABLES.filter((v) => categories.has(v.category));
}

export function getAllowedCampaignVariableNames(eventId: string | null): string[] {
  return getAllowedCampaignVariables(eventId).map((v) => v.name);
}
```

### Validação nas 4 rotas de criar/editar campanha

`app/api/events/[id]/campaigns/route.ts` (POST), `app/api/admin/campaigns/route.ts` (POST),
`app/api/events/[id]/campaigns/[campaignId]/route.ts` (PATCH),
`app/api/admin/campaigns/[campaignId]/route.ts` (PATCH) — cada uma, depois do `parsed.success` do
Zod (que continua validando só estrutura/obrigatoriedade), roda:

```ts
if (parsed.data.messageBody !== undefined) {
  const { valid, unknown } = validateTemplateVariables(
    parsed.data.messageBody,
    getAllowedCampaignVariableNames(eventId), // eventId = id (rotas de evento) ou null (admin)
  );
  if (!valid) {
    return NextResponse.json(
      { error: "Variável desconhecida na mensagem", unknownVariables: unknown },
      { status: 400 },
    );
  }
}
```

No POST (create), `messageBody` é sempre obrigatório no schema, então essa checagem sempre roda.
Mesmo formato de erro (`unknownVariables`) já usado por `message-templates`, pra reaproveitar o
parsing de erro que a UI já sabe fazer.

### Endpoint de catálogo (novo, 1 por árvore de rota)

`GET app/api/events/[id]/campaigns/variables/route.ts` e
`GET app/api/admin/campaigns/variables/route.ts` — `campaigns.view`, sem lookup de campanha
específica (só precisa saber se está na árvore de evento ou de plataforma, o que a própria árvore
já determina). Retorna `{ variables: VariableDefinition[] }` via
`getAllowedCampaignVariables(eventId)` (evento: `id` do path; admin: `null`).

### Endpoint "opções de alerta pra começar" (novo, 1 por árvore de rota)

`GET app/api/events/[id]/campaigns/alert-options/route.ts` e
`GET app/api/admin/campaigns/alert-options/route.ts` — `campaigns.view`. Filtra
`ALERT_REGISTRY` por `channels.includes("WHATSAPP")` e `recipientRoles` contendo `BUYER` ou
`ATHLETE` (preferindo `ATHLETE` quando o alerta tiver os dois papéis, por ser o mais específico pra
"quem recebe uma campanha"), resolve cada um via `getEffectiveTemplate(alertKey, "WHATSAPP", role,
eventId ?? undefined)`, e retorna `{ options: { alertKey: string; description: string; body: string
}[] }`. Rota estática (`alert-options`, `variables`) convivendo com a rota dinâmica `[campaignId]`
no mesmo nível — mesmo padrão que já existe hoje entre `campaigns/route.ts` e
`campaigns/[campaignId]/route.ts`, sem conflito.

### Preview e teste (novos, 1 par por árvore de rota)

`POST app/api/events/[id]/campaigns/[campaignId]/preview/route.ts` e equivalente admin —
`campaigns.view`. Busca a campanha via `resolveCampaignDetailContext` (mesmo gate das rotas já
existentes), renderiza `campaign.messageBody` com `renderTemplate(body, SAMPLE_VALUES,
"WHATSAPP")`, devolve `{ body: string }`. Não muda nenhum estado.

`POST app/api/events/[id]/campaigns/[campaignId]/test-send/route.ts` e equivalente admin —
`campaigns.edit`. Mesmo lookup, mesma renderização, mas envia via `sendWhatsAppMessage` pro
`User.phone` da própria sessão (`session.user.id`, nunca um valor da requisição — 400 se a conta não
tiver telefone cadastrado, mesma mensagem de erro já usada em `message-templates`), prefixado
`[TESTE]`, com `messageType: "CAMPAIGN_TEST"` (nunca cria `CampaignRecipient`, então nunca entra nas
métricas reais da campanha nem depende de nada da Fase B/D pra "não contar").

`SAMPLE_VALUES` (hoje duplicado entre `message-templates/[id]/preview` e `.../test-send`) é extraído
pra `lib/templates/variables.ts` como constante exportada e reusado nos 4 lugares (2 já existentes +
2 novos) — remove a única duplicação real que esta fase criaria uma terceira cópia de.

### UI (`components/campaigns/CampaignsManager.tsx`)

- Formulário de criação e modal de edição: abaixo do textarea de `messageBody`, um `<select>`
  categorizado (grupos por categoria, como `<optgroup>`) que insere `{{nome_da_variavel}}` na
  posição do cursor ao escolher uma opção, e um contador de caracteres (`{body.length} caracteres`)
  abaixo dele. A lista de variáveis vem do endpoint de catálogo, buscada uma vez ao montar o
  componente (já sabe se é `apiBase` de evento ou de admin pelas props existentes).
- Formulário de criação, adicionalmente: um bloco "Começar a partir de um alerta existente"
  (`<select>` com as opções do endpoint de alert-options + botão "Usar este texto") que substitui o
  conteúdo do textarea — sem enviar nada ao servidor, é só preenchimento local, o organizador ainda
  edita livremente antes de criar a campanha.
- Modal de edição, adicionalmente (só quando a campanha já existe, ou seja, sempre que o modal está
  aberto — `editId` não é nulo): botões "Visualizar" e "Enviar teste", que chamam os novos
  endpoints e mostram o resultado numa janela/modal pequena (texto renderizado com quebras de linha
  preservadas — `whitespace-pre-wrap`, mesmo tratamento que `MessageTemplateEditor` já usa pro canal
  WhatsApp). Erros de `unknownVariables` no salvar (tanto criar quanto editar) já reaproveitam o
  parsing de erro que `handleCreate`/`saveEdit` já fazem hoje (`data.error` como string cai no
  fallback genérico atual — pequeno ajuste pra também checar `data.unknownVariables` e montar uma
  mensagem tipo `Variáveis desconhecidas: {{x}}, {{y}}`, no mesmo padrão de
  `MessageTemplateEditor.handleSave`).

### `lib/message-logs.ts`

Adiciona `CAMPAIGN_TEST: "Teste de campanha de WhatsApp"` a `MESSAGE_TYPE_LABEL`, pra que o log do
envio de teste apareça com um rótulo legível no filtro de `/admin/mensagens` (mesmo padrão de todo
`messageType` já cadastrado ali).

## Fora de escopo desta fase (fica pra depois)

- Resolução de variáveis com dados **reais** de um destinatário específico (preview/teste usam só
  valor de amostra, igual ao sistema de alertas) — isso só importa de verdade quando o envio real
  existir (Fase D), que já vai precisar de uma função de resolução por `CampaignRecipient`.
- Agendamento (`scheduledAt` já existe no schema desde a Fase A, mas nada usa ainda) — Fase D.
- Qualquer contagem de teste nas métricas de campanha (`CampaignRecipient`/status de entrega) — não
  se aplica, teste nunca cria `CampaignRecipient`.
- Editar o atalho "partir de alerta" pra também aparecer na edição de uma campanha já existente —
  decisão explícita de manter só na criação nesta fase.

## Testes

- `lib/campaigns/variables.ts`: unit tests puros — `getAllowedCampaignVariables(null)` só devolve
  categorias Atleta/Plataforma; `getAllowedCampaignVariables("evento-1")` inclui as 5 categorias;
  nenhuma variável de categoria fora dessas 5 nunca aparece em nenhum dos dois casos.
- As 4 rotas de criar/editar: teste de rejeição com variável desconhecida (`{{variavel_invalida}}`)
  e com variável de categoria fora de escopo (ex.: `{{nome_evento}}` numa campanha de plataforma via
  `/api/admin/campaigns` deve ser rejeitado; a mesma variável numa campanha de evento deve passar).
- Rotas de `variables`/`alert-options`: teste de que a árvore de evento devolve o catálogo completo
  e a árvore admin devolve só o subconjunto sempre-disponível; teste de que `alert-options` só lista
  alertas com papel `BUYER`/`ATHLETE` (uma alerta admin-only como `RECONCILIATION_MISMATCH` nunca
  aparece).
- Rotas de `preview`: renderiza com `SAMPLE_VALUES`, nunca muda `campaign.status` nem cria
  `CampaignRecipient`.
- Rotas de `test-send`: 400 quando a conta de quem chama não tem telefone; sucesso chama
  `sendWhatsAppMessage` com o telefone da própria sessão (nunca um valor do corpo da requisição);
  `messageType` gravado é `"CAMPAIGN_TEST"`.
- Sem testes de componente de UI (convenção já estabelecida no projeto) — `tsc --noEmit` e a suíte
  completa cobrem regressão.
