# Página pública de resultados (PDFs) — design

**Data:** 2026-08-31
**Tipo:** arquitetural (model novo + upload + 3 pontos de UI)
**Branch:** `feat/pagina-resultados-pdf`

## Contexto

Já existe um sistema de resultados: import de CSV (`ResultImport` + `RaceResult`) em
`/organizador/eventos/[id]/resultados`, publicado numa tabela pesquisável em
`/eventos/[slug]/resultados`. A página pública do evento (`/eventos/[slug]`) **não** linka
pra essa página hoje.

O organizador quer um caminho mais simples e comum em corridas pequenas: subir **PDFs** de
classificação (o cronometrista entrega PDFs prontos), cada um com um nome de exibição, e a
página pública mostra o **banner do evento + botões**, um por PDF — conforme
`modelo_classificacao/modelo.png`.

**Decisão do usuário:** os dois sistemas CONVIVEM. O import de CSV fica intacto. A página
pública passa a mostrar os botões de PDF **e**, se houver CSV publicado, a tabela abaixo.

## Decisões travadas com o usuário

1. CSV e PDF convivem — nada do fluxo de CSV é removido.
2. O texto "5KM" do modelo = **campo livre por evento** (`Event.resultsSubtitle`), opcional,
   some se em branco.
3. Botão "Resultado" na página pública do evento fica **dentro do card lateral "Inscrições"**,
   abaixo do "Inscrever-se". Só aparece quando o evento tem ≥1 PDF **ou** um `ResultImport`
   publicado.
4. PDF de resultado fica **público assim que salvo** (sem toggle de publicação). Remoção via
   botão Excluir com `ConfirmModal`.

## Global Constraints

- Nunca usar `alert()`/`confirm()`/`window.prompt()` — usar `ConfirmModal`/`ErrorModal`
  (`CLAUDE.md`).
- Migração de schema aditiva; aplicada com `prisma db push` no deploy (NUNCA `prisma migrate
  deploy` — `_prisma_migrations` de produção está congelada). Arquivo SQL em
  `prisma/migrations/` (gitignored — `git add -f`).
- Permissão: reutilizar `results.import` (a mesma do upload de CSV) para o CRUD de PDFs.
- RBAC anti-IDOR: organizador só mexe em resultado de evento do próprio `organizerId`
  (`resolveActingScope(session).organizerId` + `event.organizerId`); admin titular via
  `resolveActingScope(...).actingAsAdmin`.
- Sem teste de UI (convenção do projeto). Gate: `npx vitest run` + `npx tsc --noEmit` +
  `npm run build`.

## 1. Modelo de dados

### 1.1 `EventResultFile` (novo)

```prisma
model EventResultFile {
  id          String   @id @default(cuid())
  eventId     String
  label       String   // nome de exibição no botão
  fileUrl     String   @db.Text
  fileName    String
  createdById String?
  createdAt   DateTime @default(now())

  event     Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  createdBy User? @relation(fields: [createdById], references: [id])

  @@index([eventId])
  @@map("event_result_files")
}
```

- `Event` ganha `resultFiles EventResultFile[]`.
- `User` ganha `createdResultFiles EventResultFile[]` (lado inverso da relação `createdBy`).
- Ordenação dos botões: `orderBy: { createdAt: "asc" }` (ordem de cadastro).

### 1.2 `Event.resultsSubtitle`

```prisma
resultsSubtitle String? @db.VarChar(120)
```

Nullable, sem default. O texto do slot "5KM".

### 1.3 Migração

Arquivo `prisma/migrations/20260831010000_event_result_files/migration.sql` — additivo:
`CREATE TABLE "event_result_files" (...)` + índice + FKs; `ALTER TABLE "events" ADD COLUMN
"resultsSubtitle" VARCHAR(120)`. Sem DROP, sem NOT NULL sem default, sem índice que trave.

## 2. Upload

`app/api/upload/route.ts`:

- `ALLOWED_PURPOSES` ganha `"result_pdf"`.
- `FileUploadInput` (`components/organizer/FileUploadInput.tsx`): o tipo da prop `purpose`
  ganha `"result_pdf"`.
- PDF já é suportado (`application/pdf` em `ALLOWED_MIME`, magic-bytes `%PDF-`, teto 10 MB,
  `compressImageIfPossible` ignora não-imagem). O arquivo vai pro bucket público como
  `result_pdf/<uuid>.pdf`; a rota devolve `{ url }`.
- Roles do upload já são `ADMIN|ORGANIZER|ASSISTANT` — cobre o caso.

## 3. Rotas de API

### 3.1 `POST /api/events/[id]/result-files`

- Guard: `checkApiPermission("results.import", { eventId })` → depois `resolveActingScope` +
  checagem `event.organizerId === scope.organizerId` (ou `actingAsAdmin`) → 404 se não bater.
- Body zod: `{ label: z.string().trim().min(1).max(80), fileUrl: z.string().url().max(500),
  fileName: z.string().trim().min(1).max(200) }`.
- Cria `EventResultFile` com `createdById: session.user.id`. Retorna `{ id, label, fileUrl,
  fileName, createdAt }`, 201.

### 3.2 `DELETE /api/events/[id]/result-files/[fileId]`

- Mesmo guard de permissão + escopo do evento.
- `findFirst({ where: { id: fileId, eventId } })` → 404 se não existir/não for do evento.
- `db.eventResultFile.delete`. Retorna `{ ok: true }`.
- **Não** apaga o arquivo do bucket (mesma convenção de banner/regulamento — o storage não é
  limpo hoje; documentado como aceitável).

### 3.3 `PATCH /api/events/[id]/result-files` — `resultsSubtitle`

Rota dedicada pra manter **toda a gestão de resultados sob a permissão `results.import`**
(não `events.edit`) — um assistente com acesso só a resultados precisa conseguir editar o
subtítulo.

- Guard: `checkApiPermission("results.import", { eventId })` + checagem de escopo do evento
  (mesma das outras).
- Body zod: `{ resultsSubtitle: z.string().max(120).nullable() }` (string vazia é normalizada
  pra `null`).
- `db.event.update({ where: { id }, data: { resultsSubtitle: body.resultsSubtitle?.trim() || null } })`.
  Retorna `{ ok: true }`.
- `updateEventSchema` NÃO é tocado.

## 4. Lado organizador — `/organizador/eventos/[id]/resultados`

A página (`page.tsx` server + `ResultadosClient.tsx` client) ganha uma seção **acima** do
bloco de import de CSV atual. O import de CSV fica **inalterado**.

Nova seção **"Página pública de resultados"** (client, novo componente
`components/organizer/EventResultFilesManager.tsx`):

- **Texto de destaque** — input controlado, valor inicial `event.resultsSubtitle ?? ""`,
  botão "Salvar" → `PATCH /api/events/[id]/result-files` com `{ resultsSubtitle }` (§3.3).
  Feedback inline; `ErrorModal` em erro.
- **PDFs cadastrados** — lista de `event.resultFiles` (passados do server): cada linha com
  `label`, link "abrir" (`fileUrl`, target `_blank`), botão **Excluir** → `ConfirmModal`
  ("Excluir o resultado '<label>'?") → `DELETE .../result-files/[id]` → `router.refresh()`.
- **Adicionar resultado** — form: input "Nome de exibição" (`label`) + `<FileUploadInput
  purpose="result_pdf" accept="application/pdf" label="PDF do resultado" .../>`. Ao concluir
  o upload (`onUploaded(url)`), guarda a URL + fileName no estado; ao submeter o form (com
  `label` preenchido e URL presente) → `POST .../result-files` → `router.refresh()`, limpa o
  form. Bloqueia submit sem `label` ou sem PDF.
- Link "Ver página pública de resultados" → `/eventos/[slug]/resultados` (target `_blank`).

`page.tsx` passa a carregar `event.resultFiles` (`orderBy createdAt asc`), `event.resultsSubtitle`
e `event.slug` além do que já carrega.

## 5. Página pública — `/eventos/[slug]/resultados`

`app/(public)/eventos/[slug]/resultados/page.tsx` (Server Component). O `select` do `event`
ganha `bannerUrl`, `listBannerUrl`, `resultsSubtitle`, e
`resultFiles: { orderBy: { createdAt: "asc" }, select: { id, label, fileUrl } }`.

Renderização, de cima pra baixo:

1. **`RESULTADOS`** — `<h1>` centralizado, uppercase, cor de destaque (verde do tema — usar a
   classe/token existente, ex. `text-green-700`), tracking largo (como o modelo).
2. **Banner** — `bannerUrl ?? listBannerUrl`. `next/image`, centralizado, `max-w` moderado,
   `object-contain`. Se nenhum banner: `<h2>` com `event.title` no lugar.
3. **Subtítulo** — se `resultsSubtitle`, `<p>` grande, negrito, centralizado (o slot "5KM").
4. **Grid de botões** — se `resultFiles.length > 0`: `grid grid-cols-1 sm:grid-cols-2 gap-4
   max-w-2xl mx-auto`. Cada botão é um `<a href={fileUrl} target="_blank" rel="noopener">`
   estilizado como o modelo: fundo navy escuro (`bg-[#1e293b]` / `dark:bg-slate-800` ou token
   equivalente), `rounded-2xl`, `shadow-lg`, `py-5 px-4`, texto branco `font-bold uppercase
   text-center underline`, `hover` leve.
5. **Tabela CSV** — se existe `ResultImport` publicado (query atual `resultImport.findFirst({
   where: { eventId, published: true } })`): renderiza a tabela pesquisável **exatamente como
   hoje** (form de busca + `<table>`), abaixo dos botões, com um `<h2>` "Classificação
   detalhada" separando.
6. **Vazio** — se `resultFiles.length === 0` **e** nenhum `ResultImport` publicado:
   "Resultados ainda não publicados." (texto atual).

`generateMetadata` inalterado.

## 6. Botão "Resultado" na página do evento

`app/(public)/eventos/[slug]/page.tsx` (Server Component):

- O `select`/`include` do `event` ganha:
  `resultFiles: { take: 1, select: { id: true } }` e
  `resultImports: { where: { published: true }, take: 1, select: { id: true } }`.
- `const hasResults = event.resultFiles.length > 0 || event.resultImports.length > 0;`
- No card lateral "Inscrições" (`<aside>`), **abaixo** do bloco do botão "Inscrever-se"
  (após o fechamento daquele `if/else` de estados de inscrição, ainda dentro do `.card`):
  ```tsx
  {hasResults && (
    <Link
      href={`/eventos/${event.slug}/resultados`}
      className="btn-secondary w-full text-center block mt-3"
    >
      🏆 Resultado
    </Link>
  )}
  ```

## 7. Testes

- **`lib/events/has-results.ts`** — helper puro `eventHasResults({ resultFilesCount,
  publishedImportCount })` (ou assinatura equivalente com os dois flags). Usado pela página do
  evento (§6) e testado em **`tests/lib-event-has-results.test.ts`**: 0/0 → false; ≥1 PDF →
  true; ≥1 import publicado → true.
- **`tests/event-result-files-route.test.ts`** (novo):
  - `POST` sem permissão → resposta do `checkApiPermission`.
  - `POST` de evento de outro organizador → 404, nada criado.
  - `POST` com `label` vazio / `fileUrl` não-URL → 400.
  - `POST` ok → 201, `eventResultFile.create` chamado com `createdById` da sessão.
  - `DELETE` de `fileId` que não é do evento → 404.
  - `DELETE` ok → `eventResultFile.delete` chamado, `{ ok: true }`.
  - `PATCH` (resultsSubtitle) sem permissão → resposta do `checkApiPermission`; `{ resultsSubtitle: "5KM" }`
    → `event.update` com `resultsSubtitle: "5KM"`; `{ resultsSubtitle: "" }` / `"  "` → `null`.
- **`tests/upload-route.test.ts`** (existente): caso — `purpose: "result_pdf"` com bytes
  `%PDF-` → aceito; com bytes de imagem declarando pdf → 400 (magic bytes).
  (o teste de subtítulo vive no mesmo arquivo do `result-files-route`, já que a rota é
  `PATCH /api/events/[id]/result-files`.)

## 8. Rollout

- Deploy: `git pull` no VPS → `docker build` → `prisma db push` (aditivo: tabela
  `event_result_files` + coluna `events.resultsSubtitle`) → restart. **Sem backfill.**
- Sem impacto em dados existentes. O CSV/tabela continua funcionando pra quem já publicou.

## 9. Fora de escopo

- Reordenar os botões (fica ordem de cadastro).
- Editar um `EventResultFile` já criado (só criar/excluir; pra trocar, exclui e cria de novo).
- Limpar o arquivo órfão no bucket ao excluir o registro (mesma convenção de banner/regulamento).
- Página pública de resultados do lado admin (o admin usa a mesma pública via `/eventos/[slug]/resultados`).
