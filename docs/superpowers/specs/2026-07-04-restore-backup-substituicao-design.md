# Restore de backup por substituição total

## Contexto

O import de backup atual (`app/api/admin/backup/import/route.ts`) funciona em modo *merge*: cada
linha do arquivo é processada com `upsert` (cria se não existe, atualiza se o `id` já existir). Isso
causa falhas em cascata quando o backup contém um usuário cujo `email` já existe no banco com outro
`id` — o `upsert` falha por conflito de unique constraint, e todos os registros que dependem daquele
usuário (perfil de organizador, eventos, lotes, categorias, rotas, cupons, pedidos, inscrições,
pagamentos) falham em seguida por violação de foreign key.

O objetivo deste trabalho é que o upload de um backup **restaure o banco exatamente como o arquivo**,
sem manter usuários/dados antigos e sem risco de conflito de unique constraint.

## Escopo

### Tabelas incluídas no backup (export e import)

Hoje o export (`app/api/admin/backup/route.ts`) cobre 11 tabelas: `users`, `organizerProfiles`,
`events`, `ticketBatches`, `eventCategories`, `eventRoutes`, `coupons`, `orders`, `registrations`,
`payments`, `refunds`.

Isso será ampliado para incluir também: `athleteProfiles`, `transferPayouts`, `resultImports`,
`raceResults`, `fileAssets`, `auditLogs`, `platformSettings`, `alertLogs`.

Motivo: essas tabelas têm `onDelete: Cascade` a partir de `User`/`Event`/`ResultImport` (ex.:
`AthleteProfile`, `RaceResult`) ou seriam apagadas no wipe sem ter como ser restauradas depois, se
não estivessem no arquivo de backup.

### Tabelas fora do escopo

`Session`, `Account`, `VerificationToken` — a autenticação usa `strategy: "jwt"` com apenas
`CredentialsProvider` (sem OAuth), então essas tabelas do NextAuth não guardam nada relevante para
restaurar. Elas não entram no backup nem são apagadas/recriadas pelo restore.

## Comportamento do import: substituição total (replace)

O modo *merge/upsert* é removido. O único modo de import passa a ser: apagar todos os dados das
tabelas do escopo e inserir exatamente o conteúdo do arquivo.

### Ordem de exclusão (filhos → pais, respeitando FKs)

1. `raceResults`
2. `resultImports`
3. `refunds`
4. `payments`
5. `registrations`
6. `orders`
7. `fileAssets`
8. `auditLogs`
9. `transferPayouts`
10. `coupons`
11. `ticketBatches`, `eventCategories`, `eventRoutes`
12. `events`
13. `athleteProfiles`, `organizerProfiles`
14. `users`
15. `platformSettings`, `alertLogs` (sem FK, podem ser apagadas em qualquer ponto)

### Ordem de inserção (pais → filhos)

Exatamente o inverso da exclusão. Cada tabela é inserida com `createMany` (não `upsert`) — como a
tabela está vazia, não há conflito a resolver, e `createMany` é mais rápido que um loop de upserts.

`PlatformSetting` usa `key` como chave primária (não `id`); os demais usam `id`.

### Atomicidade

Todo o processo (todas as exclusões + todas as inserções) roda dentro de uma única
`db.$transaction(async (tx) => { ... }, { timeout, maxWait })`, com timeout ajustado para caber no
`maxDuration = 120` já configurado na rota. Se qualquer linha falhar (dado malformado, FK
inconsistente), a transação inteira sofre rollback: o banco atual permanece intacto, nada fica pela
metade.

Isso substitui o comportamento atual de "processar linha a linha, contar erros e seguir em frente",
que podia deixar o banco num estado inconsistente entre tabelas (parte restaurada, parte não).

## Rede de segurança: snapshot automático antes de apagar

Antes de enviar o arquivo para import, o client (`BackupImportButton.tsx`) primeiro dispara o
download do backup atual, reaproveitando o endpoint de export já existente
(`GET /api/admin/backup`, que já faz streaming e cobre todas as tabelas após esta mudança). O
arquivo `backup-<timestamp-atual>.json` cai no computador do admin antes de qualquer dado ser
apagado. Só após esse download concluir com sucesso é que o POST de import é enviado. Se o download
falhar, o import é abortado e nada é apagado.

Não é necessário armazenamento novo no servidor — evita depender de disco local no container (que
pode não persistir entre deploys) ou do Supabase Storage (DNS ainda pendente, ver
`supabase_selfhosted` na memória).

## Confirmação explícita na UI

Ao selecionar o arquivo, o `BackupImportButton` mostra um modal com:

- Contagem de registros do arquivo por tabela (calculado no client, contando os arrays do JSON já
  parseado)
- Aviso: "Isso vai apagar todos os dados atuais e substituir pelo conteúdo deste arquivo. Um backup
  do estado atual será baixado automaticamente antes."
- Campo de texto exigindo digitar **CONFIRMAR** para habilitar o botão de prosseguir

Fluxo do botão após confirmação:

1. Dispara download do snapshot atual (`GET /api/admin/backup`)
2. Aguarda o download concluir
3. Envia o arquivo de backup para `POST /api/admin/backup/import`
4. Exibe o resultado

## Tela de resultado

Troca de "X upserted / Y erros por tabela" para "X registros restaurados por tabela" (sem coluna de
erros por linha — agora é tudo ou nada). Em caso de falha, exibe o erro único que causou o rollback e
deixa claro que **nenhum dado foi alterado**.

## Textos da página

`app/admin/backup/page.tsx` é atualizado para refletir o novo comportamento (hoje o texto já cita
"repasses e estornos" que não estavam no export — inconsistência corrigida junto). O aviso passa a
deixar claro que o import é uma substituição total, não uma mescla.

## Fora de escopo

- Não há opção de manter o modo merge/upsert antigo.
- Não há armazenamento server-side dos snapshots de segurança (o download fica só no client).
- Não há criptografia adicional do arquivo de backup (já existia o aviso de dado sensível na página).
