# Destinatários extras do resumo diário — Design

## Contexto

O resumo diário (admin + organizador) já está em produção, enviando apenas para o próprio
e-mail/telefone do usuário logado. O usuário pediu uma pequena adição: cada admin/organizador
poder cadastrar outras pessoas (por nome) — outros e-mails e/ou outros números de WhatsApp — para
também receberem o resumo, na mesma tela onde já existem os toggles de e-mail/WhatsApp.

## Decisões confirmadas com o usuário

- Cada admin/organizador cadastra sua **própria** lista de destinatários extras (não uma lista
  global compartilhada).
- Cada item tem **nome** (para identificar de quem é aquele e-mail/número), **tipo** (e-mail ou
  WhatsApp) e **valor** (o e-mail ou o número).
- **Cadastrar já é ativar** — não existe checkbox liga/desliga por item; remover da lista é a
  única forma de parar de receber.
- Arquitetura escolhida pelo autor da spec (autorizado pelo usuário): tabela relacional dedicada
  (`DailySummaryRecipient`), não colunas de array no `User` — porque cada item precisa de um nome
  associado, o que exige uma estrutura, não apenas uma lista de strings.

## Arquitetura

### 1. Schema

```prisma
enum DailySummaryRecipientType {
  EMAIL
  WHATSAPP
}

model DailySummaryRecipient {
  id        String                    @id @default(cuid())
  userId    String
  name      String
  type      DailySummaryRecipientType
  value     String
  createdAt DateTime                  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("daily_summary_recipients")
}
```

`User` ganha a relação inversa `dailySummaryRecipients DailySummaryRecipient[]`. Migração
puramente aditiva (nova tabela + novo enum), sem impacto em dado existente.

### 2. API — rota única, compartilhada entre admin e organizador

Não há necessidade de rotas separadas por papel: a lista pertence a `session.user.id`,
independente do papel. Segue o padrão já usado por `/api/organizer/account` (sessão presente,
sem checagem de papel específica) — aqui adicionamos uma checagem de papel simples
(`ADMIN`/`ORGANIZER`), já que só esses dois papéis têm a tela de "resumo diário".

- `GET /api/daily-summary-recipients` — lista os destinatários do usuário logado.
- `POST /api/daily-summary-recipients` — cria um novo (`{name, type, value}`), validado por Zod:
  `name` obrigatório; se `type === "EMAIL"`, `value` validado com `z.string().email()` (mesma
  regra usada em todo outro campo de e-mail do sistema); se `type === "WHATSAPP"`, `value` só
  passa por checagem de tamanho mínimo (`min(8)`, mesma regra já usada em
  `app/api/admin/whatsapp/test/route.ts` — não existe regex de telefone brasileiro em nenhum
  lugar do sistema hoje, então não inventamos uma nova aqui).
- `DELETE /api/daily-summary-recipients/[id]` — remove, só se `recipient.userId ===
  session.user.id` (nunca permite remover destinatário de outro usuário).

### 3. Envio — extensão de `lib/alerts/daily-summary.ts`

Depois do envio ao destinatário principal (o próprio admin/organizador), cada função
(`sendAdminDailySummaries`/`sendOrganizerDailySummaries`) busca
`db.dailySummaryRecipient.findMany({ where: { userId: <id do admin/organizador> } })` e, pra cada
item: se `type === "EMAIL"`, envia o mesmo e-mail detalhado (mesmas `rows`); se `type ===
"WHATSAPP"`, envia o mesmo texto condensado de WhatsApp. Cada envio extra tem seu próprio dedupe
via `AlertLog` (`entityId: "${date}:recipient:${recipient.id}"`, mesmo `alertType` =
`"DAILY_SUMMARY"`), pra um re-run do cron no mesmo dia não duplicar o envio pro mesmo destinatário
extra. Falha em um destinatário extra não impede os demais (mesmo padrão de isolamento por
destinatário já usado pro destinatário principal).

### 4. UI — componente compartilhado

Novo `components/profile/DailySummaryRecipientsManager.tsx` (client component), usado nas duas
páginas ("Meus Dados" do admin e do organizador), logo abaixo dos checkboxes de e-mail/WhatsApp já
existentes. Lista os destinatários atuais (nome, tipo, valor, botão "Remover"), com um formulário
de adicionar (nome, seletor de tipo, campo de valor que muda o placeholder/tipo de input conforme
o tipo escolhido). Remoção usa `components/ui/ConfirmModal.tsx` (nunca `confirm()` nativo, por
`CLAUDE.md`). Erros de validação usam `components/ui/ErrorModal.tsx`.

## Testes

- Testes de rota: `GET`/`POST`/`DELETE` — 401 sem sessão, 403 pra papel que não é admin/organizador,
  validação de e-mail inválido, validação de telefone curto demais, criação e listagem bem-sucedidas,
  exclusão só do próprio destinatário (nunca de outro usuário).
- Testes de `lib/alerts/daily-summary.ts`: destinatários extras do tipo EMAIL recebem o e-mail;
  do tipo WHATSAPP recebem o WhatsApp; dedupe independente por destinatário extra; falha em um
  extra não impede os demais nem o destinatário principal.

## Fora de escopo

- Edição de um destinatário existente (só criar e remover).
- Toggle liga/desliga por destinatário extra (cadastrar já é o opt-in, conforme decisão do
  usuário).
- Limite de quantidade de destinatários extras por usuário.
