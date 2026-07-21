# Ajustes pequenos: modal de completar cadastro, telas do anunciante, CHECK constraint

## Contexto

Quatro itens pequenos e independentes, levantados durante a revisão do backlog registrado em
`PROGRESSO.md` (achados de revisões anteriores, nunca corrigidos por decisão de escopo na época).
Nenhum depende dos outros — agrupados numa spec só por serem pequenos, cada um com sua própria
seção de implementação no plano.

Ordem de prioridade combinada com o usuário: B → C/D → E. O sistema de rating (item maior,
adiado) fica para uma sessão de brainstorm dedicada, fora desta spec.

## B — Modal opcional "complete seu cadastro"

**Objetivo**: sugerir ao atleta preencher campos hoje opcionais do perfil, sem bloquear
navegação (diferente do gate obrigatório de `/completar-cadastro`, que já cobre
birthDate/cpf/phone).

**Campos sugeridos** (todos já existem em `AthleteProfile`, hoje só editáveis em
`/dashboard/perfil`): `gender`, `preferredShirtSize`, `city` + `state`. `teamName` fica de fora
(não pedido pelo usuário).

**Gatilho**: uma vez por sessão de login. Implementado com uma flag em `sessionStorage`
(ex.: `profile-nudge-dismissed`), setada quando o atleta fecha ("Agora não") ou clica em
"Completar agora". A flag é limpa no logout (handler de sign-out), garantindo que uma nova sessão
de login sempre reavalie — mas não fica reaparecendo a cada navegação dentro da mesma sessão.

**Onde mora**: `app/dashboard/layout.tsx` (server component) continua resolvendo a sessão e agora
também chama uma nova função `getSuggestedAthleteProfileFields(userId)` em
`lib/auth/profile-completion.ts` (mesmo arquivo da função irmã `getMissingAthleteProfileFields`,
mas para campos opcionais — não reaproveita a mesma função nem o mesmo tipo, já que uma bloqueia
navegação e a outra não). O resultado (lista de campos sugeridos) é passado como prop pra um novo
client component `components/dashboard/ProfileCompletionNudge.tsx`, renderizado só quando
`session.user.role === "ATHLETE"`. Esse client component é o dono de toda a lógica de
`sessionStorage`/exibição do modal — o layout server-side só decide *se* há algo a sugerir.

**Conteúdo do modal**: lista textual do que falta (ex.: "Gênero, Tamanho de camiseta, Cidade/UF")
+ dois botões — "Completar agora" (`<Link href="/dashboard/perfil">`, fecha o modal e marca a
flag) e "Agora não" (fecha e marca a flag, sem navegar). Não tem formulário inline — reaproveita
a página de perfil já existente, sem duplicar lógica de formulário.

**Fora de escopo**: qualquer alteração na página `/dashboard/perfil` em si; qualquer persistência
no banco de "já viu o modal" (fica só client-side, por sessão de navegador).

## C — `/anunciante/anuncios` (Meus Anúncios) — listagem + cancelamento

**Problema atual**: o link "Meus Anúncios" no `AdvertiserNav` aponta pra uma rota sem
`page.tsx` (só existe `/anunciante/anuncios/novo`, o formulário de criação).

**Listagem**: `app/anunciante/anuncios/page.tsx` busca `db.privateAd.findMany` filtrando por
`adPurchase: { advertiserId: <perfil do anunciante logado> }`, com `include: { adPurchase: true,
adSlot: true }`, ordenado por `createdAt desc`. Cada linha mostra imagem, nome da posição
(`adSlot`), status (badge — mesmas cores/labels de `PENDING_APPROVAL`/`APPROVED`/`REJECTED`/
`EXPIRED`/`CANCELLED`, novo valor deste item) e o motivo quando `REJECTED`. Mesmo padrão visual
da tela de moderação do admin (`app/admin/anuncios/moderacao/page.tsx`).

**Cancelamento**: anúncios com status em `ACTIVE_STATUSES` (`PENDING_APPROVAL`/`APPROVED`) ganham
botão "Cancelar". Fluxo: `ConfirmModal` (tone `danger`, nunca `confirm()` nativo — regra do
`CLAUDE.md`) → `POST /api/anunciante/ads/[id]/cancel`.

Nova rota `app/api/anunciante/ads/[id]/cancel/route.ts`:
1. Auth: `session.user.role === "ADVERTISER"`.
2. Posse: `db.privateAd.findFirst({ where: { id, adPurchase: { advertiserId: <perfil> } } })` —
   404 genérico se não encontrar (mesmo padrão anti-enumeração já usado em `POST /api/anunciante/ads`).
3. Guarda de status: só cancela se `status` estiver em `ACTIVE_STATUSES`; senão, 409.
4. `db.privateAd.update({ data: { status: "CANCELLED" } })`.

`CANCELLED` é um novo valor de string (campo `status` no schema não é enum) — não precisa
migração de schema. Por ficar fora de `ACTIVE_STATUSES`, a vaga da compra (`AdPurchase`) é
liberada automaticamente pra um novo anúncio, mesma lógica que já libera vaga em `EXPIRED`/
`REJECTED` (contagem em `app/anunciante/page.tsx` via `_count: { ads: { where: { status: { in:
ACTIVE_STATUSES } } } } }`).

**Fora de escopo**: editar um anúncio já existente (troca de imagem/URL) — só cancelar e criar
outro, já é o fluxo de facto hoje.

## D — `/anunciante/perfil` (Meus Dados)

**Problema atual**: o link "Meus Dados" no `AdvertiserNav` aponta pra uma rota que não existe.

**Solução**: clona o padrão exato de `/organizador/perfil` + `app/api/organizer/profile/route.ts`
para o anunciante — `app/anunciante/perfil/page.tsx` (formulário client) +
`app/api/anunciante/profile/route.ts` (GET/PUT), operando sobre `AdvertiserProfile` em vez de
`OrganizerProfile`. Três campos, os mesmos coletados no cadastro do anunciante:
`companyName`, `contactEmail`, `contactPhone`. Diferença em relação ao organizador: os três
campos são obrigatórios em `AdvertiserProfile` (não nullable no schema, já preenchidos desde o
cadastro) — o PUT valida os três como `z.string().min(1)`, não `.optional().nullable()` como no
organizador.

## E — `CHECK` constraint em `Payment` (orderId XOR adPurchaseId)

**Problema atual**: `Payment.orderId` e `Payment.adPurchaseId` são mutuamente exclusivos só "por
construção" no código (nunca os dois setados, nunca os dois `null`) — sem garantia no banco.

**Verificado em produção antes de propor isto**: `SELECT count(*) FILTER (...)` nas 147 linhas
atuais de `payments` — **0 linhas** com os dois setados, **0 linhas** com os dois nulos. Seguro
de aplicar sem quebrar dados existentes.

**Implementação**: novo arquivo
`prisma/migrations/20260721000000_payment_order_xor_adpurchase_check/migration.sql`:
```sql
ALTER TABLE payments
  ADD CONSTRAINT payment_order_xor_adpurchase_check
  CHECK (
    (("orderId" IS NOT NULL)::int + ("adPurchaseId" IS NOT NULL)::int) = 1
  );
```
Como o deploy deste projeto usa `prisma db push --skip-generate` (não roda arquivos
`migration.sql` — ver memória `deploy_vps_process`), este `ALTER TABLE` **precisa ser rodado
manualmente via `psql`** durante o próximo deploy, mesmo padrão já usado pros seeds de `AdPlan`/
`AdSlot` do sub-projeto de marketplace. O arquivo fica versionado só como documentação/histórico
do que foi aplicado, não como algo que roda sozinho.

**Fora de escopo**: mudar `Payment.orderId`/`adPurchaseId` para um discriminated union real
(exigiria refatorar todos os call sites que criam `Payment`) — o `CHECK` é só uma rede de
segurança no banco, não uma reestruturação.

## Testes (TDD, todos os itens)

- B: teste de `getSuggestedAthleteProfileFields` (unit, mesmo padrão de
  `getMissingAthleteProfileFields`). Sem teste de componente client (projeto não tem testes de
  componente React hoje).
- C: teste de rota para `POST /api/anunciante/ads/[id]/cancel` — 401 sem sessão, 403 role errada,
  404 anúncio de outro anunciante, 409 status não-ativo, 200 + `status: "CANCELLED"` no caminho
  feliz.
- D: teste de rota para `GET`/`PUT /api/anunciante/profile` — espelha
  `tests/organizer-account-route.test.ts` (ou equivalente), trocando o model.
- E: sem teste automatizado (é uma constraint de banco, verificada manualmente contra produção
  antes de escrever esta spec — não há suíte de integração com Postgres real neste projeto).

## Casos de borda

- Anunciante sem `AdvertiserProfile` ainda (não deveria acontecer pós-cadastro, mas mesma defesa
  já usada em `POST /api/anunciante/ads`): 404 "Perfil de anunciante não encontrado".
- Anúncio já `CANCELLED`/`EXPIRED`/`REJECTED` tentando cancelar de novo: 409, sem alterar nada.
- Atleta que já preencheu todos os 3 campos sugeridos: modal do item B nunca aparece (lista de
  sugestões vazia).
