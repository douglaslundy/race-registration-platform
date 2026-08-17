# Entrega de kits — Design

## Contexto

Etapa 9 de um mega-pedido de 10 etapas feito pelo usuário em 2026-08-02/03 (central de
alertas, home pública, anunciante, redes sociais, entrega de kits, rating de atletas).
Ficou deliberadamente bloqueada até as etapas anteriores estarem concluídas e até pedido
explícito — o usuário autorizou o início nesta sessão (2026-08-16).

Feature nova, do zero: não existe nenhum conceito de "kit"/"check-in" hoje no sistema, só
o campo `Event.kitPickupAt` (data/hora de retirada, exibido nas telas de inscrição — só
informativo, sem controle de entrega nenhum).

## Objetivo

Organizador (e assistentes autorizados) controla, no dia do evento, a entrega física do
kit (camiseta + número de peito + brindes) pra cada atleta inscrito e confirmado, em
múltiplos pontos de retirada simultâneos, com:

- Busca/leitura única — aceita leitor físico USB/Bluetooth, câmera do celular/tablet, ou
  digitação manual (nome/CPF/número de peito) — pra localizar a inscrição.
- Trava contra entrega duplicada entre pontos diferentes (garantida no banco, não só na
  UI).
- Registro de quem retirou o kit, permitindo terceiro retirar no lugar do atleta.
- Relatório de progresso (entregues x pendentes) com exportação CSV.
- QR code de cada inscrição disponível na página "Minha inscrição" e enviado junto com a
  mensagem de confirmação de inscrição (e-mail e WhatsApp).

## Escopo

- Um kit por inscrição `CONFIRMED` — inscrições `PENDING_PAYMENT`/`CANCELLED`/etc. não
  podem ter kit marcado como entregue.
- Retirada por terceiro: campo "retirado por" (nome, pré-preenchido com o nome do
  atleta, editável) + documento opcional — sem exigir verificação de identidade real
  (é um registro informativo, não uma barreira).
- Tela operacional (`/organizador/eventos/[id]/entrega-kits`) acessível por organizador
  titular e assistentes com a permissão nova (`kits.deliver`/`kits.view`), mesmo padrão
  de permissões granulares já usado por cupons/redes sociais.
- Admin (plataforma) só enxerga o relatório/estatísticas de entrega — não opera a tela de
  retirada de um evento de organizador (papel de auditoria, não operacional).
- QR code codifica só `registration.id` — nenhum dado sensível, mesmo padrão de
  segurança que o resto do sistema já usa pra IDs opacos (`cuid`) em links de pedido.
- Leitura por câmera é um botão adicional na mesma tela (biblioteca nova, só client-side)
  — não é o mecanismo principal, que é o campo de busca/leitura único.

## Fora de escopo

- Múltiplos kits por inscrição (ex.: kit + camiseta extra vendida à parte).
- Verificação de identidade real na retirada (conferência de documento, foto).
- Notificação automática pros atletas que ainda não retiraram (a lista/CSV do relatório
  serve pro organizador decidir se e como avisa, fora deste escopo).
- Rating de atletas (Etapa 10 do mega-pedido — continua bloqueada, sem pedido explícito).
- Qualquer coisa em nível de organizador (não por evento) — mesmo recorte já usado em
  redes sociais/cupons.

## Dados

### Schema

Um model novo em `prisma/schema.prisma`:

```prisma
model KitDelivery {
  id                  String   @id @default(cuid())
  registrationId      String   @unique   // 1 kit por inscrição — trava dupla entrega no banco
  deliveredAt         DateTime @default(now())
  deliveredByUserId   String             // organizador/assistente que operou o ponto (auditoria)
  receivedByName      String             // pré-preenchido com o nome do atleta, editável se for terceiro
  receivedByDocument  String?

  registration Registration @relation(fields: [registrationId], references: [id], onDelete: Cascade)
  deliveredBy  User         @relation(fields: [deliveredByUserId], references: [id])

  @@index([deliveredByUserId])
  @@map("kit_deliveries")
}
```

`Registration` ganha a relação `kitDelivery KitDelivery?`. `User` ganha
`kitDeliveriesPerformed KitDelivery[]` (nome que não colide com relações já existentes do
model `User`).

Migration escrita à mão (mesmo padrão das últimas features — banco local aponta pra
produção, nenhum comando de CLI/banco roda durante a implementação; `git add -f` por
causa do `.gitignore` de `prisma/migrations/`).

### Busca/lookup

`lib/kit-delivery.ts` novo, com uma função de busca reaproveitável pela tela e pela API:

```ts
export async function findRegistrationForKitDelivery(eventId: string, query: string)
```

Busca em `Registration` do evento (`status: "CONFIRMED"`) por `id` exato (cobre o valor
vindo do QR/leitor), `bibNumber` exato, ou nome/CPF do atleta (`contains`,
case-insensitive, via `athlete`/`athleteProfile`) — retorna 0, 1 ou múltiplos resultados
(busca por nome pode ter mais de um). Inclui `kitDelivery` na consulta pra já saber se foi
entregue.

## Fluxo da tela de retirada

`app/organizador/eventos/[id]/entrega-kits/page.tsx` — client component:

1. Campo único de busca/leitura no topo, com foco automático (essencial pra leitor
   físico USB/Bluetooth, que "digita" o código captado e aciona Enter sozinho — não
   precisa de nenhuma biblioteca pra esse caso). Aceita nome, CPF, número de peito, ou o
   `registration.id` vindo de um QR lido/colado.
2. Botão "📷 Usar câmera" ao lado, abre um modal client-side com leitura por câmera
   (biblioteca `qr-scanner`, ~40KB, sem dependências, usa `getUserMedia`) — resultado cai
   automaticamente no mesmo campo de busca, como se tivesse sido digitado.
3. Resultado da busca mostra um card por inscrição encontrada: nome, categoria, tamanho
   de camiseta, número de peito, status.
   - Se `status !== "CONFIRMED"`: bloqueia com aviso ("Inscrição não confirmada — não é
     possível entregar o kit").
   - Se já tem `kitDelivery`: mostra "Já entregue em DD/MM HH:MM por
     {{deliveredBy.name}}" — sem ação disponível.
   - Se ainda não entregue: formulário com "Retirado por" (pré-preenchido com o nome do
     atleta, editável) + documento opcional + botão "Confirmar entrega".
4. Confirmar entrega chama `POST /api/events/[id]/kit-deliveries`, que faz
   `create` (não `upsert`) — a constraint `@@unique(registrationId)` do banco garante
   que uma segunda tentativa simultânea (outro ponto) falha com erro de unicidade em vez
   de sobrescrever, e a API traduz isso pra uma mensagem clara de "alguém já confirmou a
   entrega agora há pouco" em vez de um erro genérico.

## QR code — geração e envio

- Codifica só `registration.id` (texto puro, sem URL) — o único consumidor pretendido é
  o próprio campo de busca da tela de retirada, então não precisa ser um link clicável.
- **Página "Minha inscrição"** (`/dashboard/inscricoes/[id]`): renderizado no navegador
  com `react-qr-code` (já instalada, mesma biblioteca do QR do Pix), só quando
  `status === "CONFIRMED"`.
- **E-mail e WhatsApp de confirmação de inscrição**: em vez de tentar embutir a imagem
  dentro do texto do template (o motor de templates hoje só resolve variáveis de texto,
  não imagens) — a imagem do QR (gerada como PNG no servidor, biblioteca `qrcode` nova)
  vai **anexada**, exatamente como já acontece hoje com o PDF de relatório de anúncio
  (`app/api/admin/ads/private/[id]/send-report/route.ts`): `sendMail({ attachments: [...] })`
  pro e-mail, `sendWhatsAppDocument(...)` pro WhatsApp (função que já existe, generaliza
  qualquer arquivo, não só PDF). Isso evita mexer no motor de renderização de templates —
  é uma mudança de escopo menor e reaproveita um padrão já testado em produção.
- O anexo entra em `lib/notifications.ts::notifyOrderConfirmed`, no mesmo ponto onde hoje
  se resolve `redes_sociais`/`link_patrocinio` — só pro alerta `ORDER_CONFIRMED` (+
  variantes de procuração), não nos outros alertas.

## Relatório de entrega

Uma aba/seção dentro da própria tela de retirada (`?tab=relatorio` ou seção fixa abaixo
da busca — decidir no plano, sem necessidade de rota própria):

- Card de progresso: "X de Y kits entregues".
- Lista dos que faltam (nome, contato, categoria, tamanho de camiseta).
- Botão de exportar CSV (mesmo padrão de `escapeCsvValue`/`lib/admin/events.ts` já usado
  no CSV de cupons/inscritos).

## Permissões

Duas chaves novas, mesmo padrão de `coupons.*`/`social-links.*`:

- `kits.view` — ver a tela de retirada e o relatório.
- `kits.deliver` — confirmar entrega (ação que muta dado).

Adicionadas nos dois catálogos de assistente (`app/organizador/assistentes/page.tsx`,
`app/admin/assistentes/page.tsx`), checadas via `checkApiPermission` nas rotas novas,
mesmo padrão de `app/api/events/[id]/social-links/*`.

Admin ganha uma página própria, só leitura, `app/admin/eventos/[id]/entrega-kits/page.tsx`
— mesmo relatório (progresso + lista de pendentes + CSV), sem o campo de busca/leitura
nem o botão de confirmar entrega. `checkApiPermission`/`resolveActingScope` com
`scope.actingAsAdmin` libera a leitura de qualquer evento; a rota de confirmar entrega
(`POST /api/events/[id]/kit-deliveries`) só aceita `organizerId` do evento (mesmo padrão
de `coupons`/`social-links` — admin não confirma entrega em nome de outro organizador).

## Dependências novas

- `qrcode` (+ `@types/qrcode`) — geração de PNG no servidor, pro anexo de e-mail/WhatsApp.
- `qr-scanner` — leitura por câmera no navegador, só no botão opcional da tela de
  retirada.

Ambas pequenas, sem dependências transitivas pesadas, escopo de uso bem definido (uma só
não entra no bundle do cliente — `qrcode` roda só em rota de API/servidor).

## Testes

- `lib/kit-delivery.ts`: busca por id exato, bib exato, nome parcial (case-insensitive),
  0/1/múltiplos resultados, exclui inscrições não-`CONFIRMED`.
- `POST /api/events/[id]/kit-deliveries`: cria com sucesso, 409 (ou mensagem equivalente)
  em tentativa duplicada (constraint de unicidade), 400 se inscrição não confirmada, 404
  se inscrição não pertence ao evento/organizador.
- Relatório/CSV: contagem entregues/pendentes bate com os dados, CSV com as colunas
  certas.
- QR no anexo de `notifyOrderConfirmed`: teste garante que `attachments`/documento é
  passado pra `sendMail`/`sendWhatsAppDocument` só no alerta certo, sem quebrar os
  testes existentes desses 3 fluxos (mock de `qrcode` pra não gerar imagem de verdade
  nos testes).
