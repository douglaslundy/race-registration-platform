# Design: CPF obrigatório para atletas + gate de cadastro incompleto

## Contexto

Hoje, para se cadastrar como atleta, o sistema já exige nome (`User.name`, sempre obrigatório) e
data de nascimento (`AthleteProfile.birthDate`, exigido via `superRefine` no cadastro só para
`role === "ATHLETE"`). CPF (`AthleteProfile.cpf`) existe no schema mas é **opcional** e só é pedido
hoje dentro do checkout (`CheckoutForm.tsx`), na seção "Dados do cartão", para pagamento com cartão
— e nem sempre é preenchido ali, pois o pagamento PIX/boleto não passa por esse campo.

O usuário quer que CPF passe a ser obrigatório para todo atleta, com dois mecanismos:
1. Uma tela que bloqueia o atleta logado até completar CPF/nascimento, caso estejam faltando.
2. Asteriscos nos campos obrigatórios da tela de cadastro.

Só existe autenticação por credenciais (e-mail/senha) neste projeto — não há login social/OAuth —
então o único caminho de criação de conta de atleta é o formulário de cadastro
(`components/auth/RegisterForm.tsx` → `POST /api/auth/register`).

## Descobertas importantes (que mudam o escopo)

- **CPF nunca foi obrigatório até hoje** — provavelmente existem atletas cadastrados sem CPF no
  banco. O gate de tela precisa cobrir contas **existentes**, não só cadastros novos.
- **A tela de checkout (`/inscricao/[slug]`) é uma rota própria, fora do layout do dashboard**
  (`app/(public)/inscricao/[slug]/page.tsx`, que só chama `auth()` diretamente). Um atleta logado
  pode ir direto pra lá sem nunca passar pelo `/dashboard` — o que bypassaria o gate se ele só
  existisse no layout do dashboard. Confirmado com o usuário: o gate deve valer também aqui.
- **O campo de CPF do checkout não é redundante com o do perfil** — fica dentro de "Dados do
  cartão" e é o CPF do *titular do cartão*, que pode ser diferente do CPF do próprio atleta (ex.:
  pai pagando com cartão próprio pela inscrição do filho). Confirmado com o usuário: esse campo
  **não muda** nesta entrega.
- **A tela de editar usuário do admin (`UserForm.tsx` / `PATCH /api/admin/users/[id]`) não toca em
  nenhum campo de `AthleteProfile`** — só `name/email/role/active/password`. Como a decisão foi
  bloquear a edição do próprio CPF pelo atleta depois de salvo, é preciso abrir uma via de correção
  para o admin, senão um erro de digitação vira um beco sem saída.

## Decisões confirmadas com o usuário

1. Bloqueio via **página dedicada de redirecionamento** (`/completar-cadastro`), não modal.
2. CPF validado pelo **algoritmo oficial** (dígitos verificadores), não só presença.
3. CPF **único** por conta (`AthleteProfile.cpf` ganha `@unique`).
4. Depois de salvo, CPF fica **bloqueado** para o próprio atleta editar — só admin corrige.
5. Checkout (`CheckoutForm.tsx`) **não muda** — continua com o campo de CPF do titular do cartão.
6. O gate também bloqueia o checkout (`/inscricao/[slug]`), não só o `/dashboard`.
7. Admin ganha campos de CPF/nascimento na tela de editar usuário, para corrigir erros.

## Arquitetura

### 1. `lib/cpf.ts` (novo)

```ts
export function normalizeCpf(raw: string): string // remove tudo que não é dígito
export function isValidCpf(cpf: string): boolean  // 11 dígitos + 2 dígitos verificadores válidos,
                                                    // rejeita sequências repetidas (111.111.111-11 etc.)
```

Usado por toda rota que grava CPF de atleta: `/api/auth/register`, `/api/athlete/profile`,
`/api/admin/users/[id]`. CPF é armazenado normalizado (só dígitos, 11 caracteres) no banco.

### 2. Schema (`prisma/schema.prisma`)

```prisma
model AthleteProfile {
  ...
  cpf String? @unique
  ...
}
```

Continua nullable — contas com cadastro incompleto ficam com `cpf: null` até passarem pelo gate.
Postgres permite múltiplos `NULL` num índice único, então isso não trava contas ainda incompletas.

**Risco de migração:** como não há acesso ao banco de produção neste ambiente para checar
duplicatas existentes, o plano de implementação deve incluir, como passo manual antes do
`db push` em produção, rodar:

```sql
SELECT cpf, COUNT(*) FROM athlete_profiles WHERE cpf IS NOT NULL GROUP BY cpf HAVING COUNT(*) > 1;
```

Se retornar alguma linha, essas duplicatas precisam ser resolvidas manualmente antes de aplicar o
`db push` (que falharia ao criar o índice único).

### 3. Cadastro (`components/auth/RegisterForm.tsx` + `app/api/auth/register/route.ts`)

- Novo campo CPF no formulário, obrigatório apenas quando `role === "ATHLETE"` (mesmo padrão do
  `birthDate` hoje: `superRefine` no schema Zod do form e da rota).
- Validação com `isValidCpf` (mensagem de erro clara se o dígito verificador não bater).
- Asteriscos (`*`) adicionados aos labels dos campos obrigatórios: Nome, E-mail, Senha e, quando
  `role === "ATHLETE"`, Data de nascimento e CPF — seguindo a convenção textual que já existe no
  checkout (`CPF do titular *`).
- `db.athleteProfile.create` na rota de registro passa a incluir `cpf` (normalizado) junto com
  `birthDate` quando `role === "ATHLETE"`.

### 4. "Meus Dados" (`app/dashboard/perfil/page.tsx` + `app/api/athlete/profile/route.ts`)

- Novo campo CPF no formulário. Enquanto `cpf` for `null` no perfil carregado, o campo é editável
  (obrigatório para salvar). Uma vez que o perfil carregado já tiver `cpf` preenchido, o campo vira
  somente-leitura na UI (mesmo padrão visual de campo desabilitado já usado em inputs `disabled`
  no projeto).
- `PUT /api/athlete/profile`: valida `cpf` com `isValidCpf` quando enviado. Se o perfil atual já
  tiver `cpf` não-nulo e o body tentar enviar um valor diferente, a rota ignora a alteração nesse
  campo (não é erro — mantém o valor já salvo), consistente com "bloqueado depois de salvo" sendo
  reforçado no back-end e não só na UI.
- Erro de unicidade (`P2002` do Prisma) tratado com mensagem amigável ("Este CPF já está
  cadastrado em outra conta").

### 5. Gate de cadastro incompleto

Novo helper `lib/auth/profile-completion.ts`:

```ts
export async function getMissingAthleteProfileFields(userId: string): Promise<Array<"birthDate" | "cpf">>
```

Consulta `athleteProfile` do usuário e retorna quais dos dois campos estão nulos/ausentes (lista
vazia = perfil completo).

Usado em dois pontos, ambos só quando `session.user.role === "ATHLETE"`:

- **`app/dashboard/layout.tsx`**: se a lista não for vazia, `redirect("/completar-cadastro")` antes
  de renderizar qualquer página do dashboard.
- **`app/(public)/inscricao/[slug]/page.tsx`**: mesma checagem, logo após `auth()`, antes de
  carregar dados do evento — `redirect(\`/completar-cadastro?callbackUrl=/inscricao/${slug}\`)`.

**Nova página `app/completar-cadastro/page.tsx`** — rota própria de nível superior (fora do layout
do dashboard, para não entrar em loop de redirecionamento quando o próprio helper for chamado
dentro do layout). Estrutura:
- Layout mínimo próprio (`requireAuth()`, sem nav completa — só um cabeçalho simples), na mesma
  linha de `/auth/login`.
- Mensagem explicando que é necessário completar o cadastro para continuar usando a plataforma.
- Formulário mostrando **apenas os campos que faltam** (`birthDate` e/ou `cpf`), reaproveitando a
  mesma validação de `isValidCpf` e a mesma rota `PUT /api/athlete/profile`.
- Ao salvar com sucesso, redireciona para `callbackUrl` (se veio de um redirect com esse parâmetro)
  ou para `/dashboard`.
- Se o usuário não for atleta, ou já tiver o perfil completo, a página redireciona direto para a
  home do papel dele (`/dashboard` para atleta, `/organizador` para organizador, `/admin` para
  admin) — evita acesso "manual" à URL por quem não precisa completar nada.

### 6. Correção pelo admin (`UserForm.tsx` + `app/admin/usuarios/[id]/editar` + `PATCH /api/admin/users/[id]`)

- A página de edição (`app/admin/usuarios/[id]/editar/page.tsx`) passa a buscar também
  `athleteProfile: { select: { cpf, birthDate } }` e passar isso para `UserForm`.
- `UserForm.tsx`: quando `role === "ATHLETE"` (considerando o valor atual do select, que pode ser
  trocado no próprio formulário), mostra campos de CPF e data de nascimento preenchidos com o valor
  atual — sem a trava de "bloqueado depois de salvo" que existe para o próprio atleta (o admin pode
  sempre corrigir).
- `PATCH /api/admin/users/[id]`: schema Zod ganha `cpf`/`birthDate` opcionais; quando presentes,
  faz upsert em `athleteProfile` dentro da mesma leitura/atualização, validando `isValidCpf` e
  tratando erro de unicidade. `AuditLog` (`USER_UPDATED`) passa a incluir esses campos no metadata
  quando alterados.

## Fora de escopo

- Qualquer mudança no campo de CPF do checkout (`CheckoutForm.tsx`) — confirmado com o usuário.
- Qualquer alteração para papéis que não sejam `ATHLETE` (organizador/admin já têm seu próprio CPF
  em `User.cpf`, tratado em outro sub-projeto anterior — não mexido aqui).
- Backfill automático de CPF para contas existentes — a única forma de completar é o próprio atleta
  passar pelo gate (ou o admin preencher manualmente via correção).
- Verificação de CPF contra uma base externa (Receita Federal) — só validação do algoritmo local.

## Testes

- `lib/cpf.ts`: unitários para `normalizeCpf` e `isValidCpf` (CPFs válidos conhecidos, inválidos,
  sequências repetidas, tamanho errado, com/sem máscara).
- `lib/auth/profile-completion.ts`: unitário, cobrindo perfil completo/incompleto/inexistente.
- `POST /api/auth/register`: CPF obrigatório e validado para `ATHLETE`, não exigido para
  `ORGANIZER`, rejeita duplicata.
- `PUT /api/athlete/profile`: aceita CPF válido, rejeita inválido, rejeita duplicata, ignora
  tentativa de alterar CPF já salvo (mantém o valor anterior sem erro).
- `PATCH /api/admin/users/[id]`: aceita correção de CPF/nascimento de um atleta, valida formato,
  trata duplicata, grava auditoria.
- Sem testes de UI (convenção já estabelecida no projeto).
- Verificação manual: fluxo completo de um atleta com perfil incompleto sendo redirecionado tanto
  a partir do `/dashboard` quanto a partir de `/inscricao/[slug]`, preenchendo os dados e sendo
  liberado; admin corrigindo um CPF errado.
