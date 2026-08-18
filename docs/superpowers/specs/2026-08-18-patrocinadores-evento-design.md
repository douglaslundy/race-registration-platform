# Patrocinadores por evento (múltiplos, nos moldes de redes sociais) — Design

## Contexto

Hoje o evento tem um único campo `Event.sponsorLink` (URL solta) e uma variável de
template `{{link_patrocinio}}`, disponível só nas 3 mensagens de confirmação de
inscrição (`ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`, `ORDER_CONFIRMED_PROXY_ATHLETE`).
O organizador pediu para virar um bloco completo — nome do patrocinador, link e mensagem
— podendo cadastrar mais de um patrocinador por evento, "nos mesmos moldes" da feature de
redes sociais que já existe (`EventSocialLink`, `lib/event-social-links.ts`,
`app/api/events/[id]/social-links/*`, `app/organizador/eventos/[id]/redes-sociais/page.tsx`),
inclusive reproduzindo a formatação com linha em branco entre blocos quando há mais de um
patrocinador ativo.

Decisões já validadas com o usuário nesta sessão (via perguntas diretas, não reabrir):

- **Vários patrocinadores por evento**, não só um.
- Continua disponível **só nas 3 mensagens de confirmação de inscrição** — mesmo escopo
  que `{{link_patrocinio}}` já tem hoje (não expande para carrinho abandonado / erro de
  pagamento, que é onde `{{redes_sociais}}` também aparece).
- `Event.sponsorLink` deixa de existir — não fica mantido em paralelo como shim de
  compatibilidade (convenção do projeto, ver `CLAUDE.md`).
- Eventos que já têm `sponsorLink` preenchido **migram automaticamente**: a migration cria
  1 `EventSponsor` por evento com esse dado, para nada se perder.

## Objetivo

Organizador cadastra, por evento, um ou mais patrocinadores (nome + link + mensagem +
ativo/inativo). O sistema disponibiliza isso como uma variável de template nova,
`{{patrocinio}}`, resolvida dinamicamente a cada envio das 3 mensagens de confirmação de
inscrição — juntando o texto de cada patrocinador ativo, um por bloco, com linha em branco
entre eles (igual `{{redes_sociais}}` já faz hoje).

## Escopo

- Cadastro de patrocinadores por evento (não por organizador — cada evento tem os seus).
- Sem limite de envios por pessoa (diferente de redes sociais) — patrocínio é conteúdo
  pago do organizador, deve aparecer sempre que ativo, não é uma promoção com cota por
  destinatário. Não há equivalente a `SocialLinkSend`/`maxSends`.
- UI de cadastro: tela nova por evento, no estilo já usado por `/redes-sociais` (lista +
  formulário de adicionar/editar, client component + API REST), sem o campo de limite.
- Remoção completa de `Event.sponsorLink`, do campo no formulário de editar evento, do
  parâmetro `sponsorLink` em `lib/email.ts`, e da variável `{{link_patrocinio}}` (schema,
  API, registry, variables) — substituídos pelo novo mecanismo.

## Fora de escopo

- Patrocinadores em nível de organizador (valendo pra todos os eventos dele).
- Qualquer alerta além de `ORDER_CONFIRMED`(+variantes) — não entra em
  `ABANDONED_CART`/`PAYMENT_ERROR`(+variante).
- Limite de envios por pessoa / página pública do evento — nenhum dos dois foi pedido.

## Dados

### Schema

Um model novo em `prisma/schema.prisma`, espelhando `EventSocialLink` sem
`maxSends`/`sends`:

```prisma
model EventSponsor {
  id        String   @id @default(cuid())
  eventId   String
  name      String                          // nome do patrocinador
  url       String
  message   String   @db.Text
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([eventId])
  @@map("event_sponsors")
}
```

`Event` ganha a relação `sponsors EventSponsor[]`, ao lado de `socialLinks`. O campo
`sponsorLink String?` é removido do model `Event`.

Migration escrita à mão (mesmo padrão das últimas features — banco local não tem acesso
de rede pra rodar `prisma migrate dev` nesta sessão), em 3 passos na mesma transação:

1. `CREATE TABLE "event_sponsors" (...)` + índice em `eventId`.
2. Backfill: `INSERT INTO event_sponsors (id, "eventId", name, url, message, active, "createdAt", "updatedAt") SELECT gen_random_uuid()::text, id, 'Patrocinador', "sponsorLink", 'Confira nosso patrocinador:', true, now(), now() FROM events WHERE "sponsorLink" IS NOT NULL AND "sponsorLink" != ''` (nome genérico "Patrocinador" e mensagem genérica — organizador ajusta depois se quiser; texto exato a confirmar na task de implementação).
3. `ALTER TABLE "events" DROP COLUMN "sponsorLink"`.

Rodada só no deploy (via `docker compose run --rm app sh -c "npx prisma db push ..."`, mesmo
processo já usado nas features anteriores) — nunca nesta sessão.

### Helper

Novo arquivo `lib/event-sponsors.ts`:

```ts
export async function getSponsorPromoText(eventId: string): Promise<string>
```

- Busca `EventSponsor` ativos do evento (`where: { eventId, active: true }`).
- Sem efeito colateral (ao contrário de `getSocialPromoText`) — não há contador por
  destinatário, então não precisa de transação nem de `userId`.
- Monta `"{{message}} {{url}}"` por patrocinador, junta com `\n\n` (mesmo separador de
  `getSocialPromoText`, garante a linha em branco entre blocos pedida). Retorna `""` se
  não há patrocinador ativo.
- Try/catch cobrindo erro de banco, retorna `""` em qualquer falha (mesmo padrão de
  `getSocialPromoText`, corrigido na revisão final da feature de redes sociais — replicar
  aqui desde o início, não esperar uma segunda rodada de revisão pra achar o mesmo bug).

### Variável de template

Renomeia `link_patrocinio` → `patrocinio` (nome novo porque o conteúdo muda de natureza:
antes era só uma URL, agora é o mesmo tipo de bloco de texto formatado que
`redes_sociais` já é).

Em `lib/templates/registry.ts`: trocar `"link_patrocinio"` por `"patrocinio"` no array
`variables` de `ORDER_CONFIRMED`, `ORDER_CONFIRMED_PROXY_BUYER`,
`ORDER_CONFIRMED_PROXY_ATHLETE` (os únicos 3 que tinham `link_patrocinio`).

Em `lib/templates/variables.ts` (`ALL_VARIABLES`): trocar a entrada de `link_patrocinio`
por `patrocinio`, descrição no molde da de `redes_sociais` ("Patrocinadores cadastrados no
evento. Pode ser vazio. Só disponível nos alertas de confirmação de inscrição.").

### Pontos de chamada do helper

- `lib/notifications.ts`, dentro de `notifyOrderConfirmed`: chamar
  `getSponsorPromoText(eventId)` uma vez (memoizado, mesmo padrão de
  `resolveSocialPromo` — mas aqui pode ser resolvido antes das guardas de canal, já que
  não há efeito colateral a proteger), e passar `patrocinio: <resultado>` nos `values` do
  WhatsApp e no parâmetro de e-mail (troca `sponsorLink` por `sponsorPromo: string` na
  assinatura de `sendRegistrationConfirmationEmail`).
- `lib/email.ts`, `sendRegistrationConfirmationEmail`: troca `sponsorLink?: string | null`
  por `sponsorPromo?: string | null` nos params, e `link_patrocinio: params.sponsorLink ??
  ""` por `patrocinio: params.sponsorPromo ?? ""` nos `values`.

## API

`app/api/events/[id]/sponsors/route.ts` (GET lista, POST cria) e
`app/api/events/[id]/sponsors/[sponsorId]/route.ts` (PATCH edita, DELETE remove) —
espelhando exatamente `app/api/events/[id]/social-links/*` (mesma checagem de permissão
via `checkApiPermission`, chaves novas `sponsors.view`/`sponsors.create`/`sponsors.edit`/
`sponsors.delete`, mesmo padrão de escopo por `organizerId`/admin, mesmo formato de erro).

Zod schema do POST: `{ name: string().trim().min(1), url: string().trim().min(1), message:
string().trim().min(1), active: boolean().optional() }` (sem `maxSends`).

## UI

### Cadastro (organizador)

Nova página `app/organizador/eventos/[id]/patrocinio/page.tsx` — mesmo client component
de `app/organizador/eventos/[id]/redes-sociais/page.tsx`, sem o campo "Quantas vezes
incluir por pessoa": lista dos patrocinadores cadastrados (nome, link, mensagem resumida,
ativo/inativo), formulário de adicionar, edição inline, exclusão com `ConfirmModal` (nunca
`confirm()` nativo).

Troca o botão "Redes sociais" existente na fileira de Ações de
`app/organizador/eventos/[id]/page.tsx` por dois botões — "Redes sociais" continua, e
"Patrocínio" novo ao lado, mesmo estilo (`btn-secondary`).

### Formulário de editar evento

Remove o campo "Link de patrocínio" de `components/organizer/EditEventForm.tsx` (schema
zod, `EventData`, `defaultValues`, o `<input>` em si) — cadastro de patrocinador passa a
ser só pela tela nova, mesmo padrão de redes sociais (que também não tem campo no form de
editar evento).

## Permissões de assistente

Mesmas 4 entradas que redes sociais têm, em `app/organizador/assistentes/page.tsx` e
`app/admin/assistentes/page.tsx`: `sponsors.view` ("Ver patrocinadores de um evento"),
`sponsors.create` ("Criar patrocinador"), `sponsors.edit` ("Editar patrocinador"),
`sponsors.delete` ("Excluir patrocinador").

## Remoção do `sponsorLink` antigo

Checklist do que sai (grep já confirmou que é a lista completa de arquivos afetados):

- `prisma/schema.prisma`: campo `sponsorLink` do model `Event`.
- `app/api/events/[id]/route.ts`: campo `sponsorLink` do `updateEventSchema`.
- `app/organizador/eventos/[id]/editar/page.tsx`: `sponsorLink: true` do `select`.
- `components/organizer/EditEventForm.tsx`: campo do schema/tipo/defaultValues/UI.
- `lib/email.ts`: parâmetro `sponsorLink` (vira `sponsorPromo`).
- `lib/notifications.ts`: `order.event.sponsorLink` no `select` e nos `values` do
  WhatsApp (vira `patrocinio`/`sponsorPromo` como descrito acima).
- `lib/templates/registry.ts` / `lib/templates/variables.ts`: `link_patrocinio` vira
  `patrocinio`.
- `tests/lib-email.test.ts`: assinatura/asserções que referenciam `sponsorLink`.

## Deploy: templates de produção (passo manual, fora do código)

As mensagens reais ficam em `message_templates` no banco de produção (escopo GLOBAL),
editadas diretamente via `psql` nas duas features anteriores (`redes_sociais` e
`link_patrocinio`). O texto de `{{link_patrocinio}}` precisa ser trocado por
`{{patrocinio}}` nas mesmas linhas já editadas antes (`ORDER_CONFIRMED` EMAIL+WHATSAPP,
`ORDER_CONFIRMED_PROXY_BUYER` WHATSAPP, `ORDER_CONFIRMED_PROXY_ATHLETE` EMAIL+WHATSAPP),
na mesma posição/formatação (linha em branco antes, já confirmada em produção). Este é um
passo de deploy, não de implementação — entra como última task do plano, executado só
quando o usuário autorizar o deploy desta feature (mesmo processo já seguido nas features
anteriores).

## Testes

- `lib/event-sponsors.ts`: testes unitários do helper — nenhum patrocinador ativo (retorna
  vazio), um patrocinador ativo (inclui), patrocinador inativo (não inclui), múltiplos
  patrocinadores ativos (junta com `\n\n`), erro de banco (retorna `""`, não lança).
- `notifyOrderConfirmed` (`tests/notifications.test.ts`): `patrocinio` chega nos `values`
  do WhatsApp e no parâmetro `sponsorPromo` do e-mail.
- `tests/lib-email.test.ts`: `sponsorPromo` vira `patrocinio` no corpo renderizado.
- API de patrocinadores: mesmo padrão de teste de `tests/` pros endpoints de
  `social-links` (a localizar/espelhar no plano) — CRUD feliz + IDOR (evento de outro
  organizador não pode ser afetado).
- Migration/backfill: não temos suíte automatizada de migration neste projeto (mesmo
  padrão das anteriores) — verificação é manual, direto no banco de produção depois do
  deploy, conferindo que todo evento que tinha `sponsorLink` ganhou exatamente 1
  `EventSponsor`.
