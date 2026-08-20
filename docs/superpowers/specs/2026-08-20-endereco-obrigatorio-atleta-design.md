# Design: Endereço obrigatório do atleta

## Contexto

Sub-projeto 2 de 3 do `taskwhatsapp.md` (o pedido grande original foi decomposto via
`superpowers:brainstorming` em: preferências de comunicação [[concluído]] → endereço obrigatório
[[este documento]] → campanhas de WhatsApp em massa). Todo atleta deve passar a ter endereço
completo (CEP, rua, número, complemento opcional, bairro, cidade, UF), com usuários existentes sem
esse dado bloqueados de navegar até completarem — reaproveitando o gate de cadastro incompleto que
já existe (feature de CPF obrigatório, 2026-07-06), nunca criando um mecanismo paralelo.

## Descobertas da auditoria

- **O gate já existe e já cresceu uma vez.** `lib/auth/profile-completion.ts::
  getMissingAthleteProfileFields` hoje cobre `birthDate`/`cpf`/`phone` (o spec original de CPF só
  previa `birthDate`/`cpf` — `phone` foi adicionado depois, confirmando que este é o padrão real de
  extensão a seguir: adicionar ao mesmo array de campos, não criar um segundo mecanismo). Os 3
  pontos de enforcement (`app/dashboard/layout.tsx`, `app/(public)/inscricao/[slug]/page.tsx`,
  `app/completar-cadastro/page.tsx`) já redirecionam com `callbackUrl` preservado (e desde o
  sub-projeto anterior, `LoginForm` já honra esse parâmetro com proteção contra open redirect).
- **`AthleteProfile.city`/`state` já existem**, mas só como campos "sugeridos"
  (`getSuggestedAthleteProfileFields`), nunca obrigatórios. Serão promovidos a obrigatórios e
  reaproveitados — não duplicados.
- **`PUT /api/athlete/profile`** é a única rota que grava `AthleteProfile`, usada tanto pelo gate
  quanto pela tela "Meus Dados" (`app/dashboard/perfil/page.tsx`). Estender o schema Zod desta rota
  cobre os dois formulários automaticamente.
- **`RegisterForm.tsx` + `POST /api/auth/register`** já exigem `birthDate`/`cpf`/`phone` quando
  `role === "ATHLETE"` (mesmo padrão `superRefine` do form e da rota) — esse é o precedente a
  seguir para tornar o endereço também obrigatório no cadastro inicial.
- **Não existe nenhuma integração de CEP no projeto** (confirmado por busca — nenhuma referência a
  ViaCEP ou serviço equivalente).
- **Não há dado histórico de endereço a migrar** — os 5 campos novos nascem vazios pra toda conta
  existente.
- **Endereço não tem trava de unicidade nem de "bloqueado após salvar"** como o CPF tem — o atleta
  sempre pode editar o próprio endereço em "Meus Dados", então não há cenário de "erro de digitação
  sem saída" que exigiria abrir uma via de correção pelo admin (diferente do CPF).

## Decisões confirmadas com o usuário

1. **Autocomplete via ViaCEP** — ao completar o CEP, busca rua/bairro/cidade/UF automaticamente
   (API pública, sem chave); atleta pode editar depois. Falha da API cai pra preenchimento manual,
   sem travar o formulário.
2. **Endereço obrigatório também no cadastro inicial** (`RegisterForm.tsx`), não só via gate
   retroativo — mesmo padrão já usado para CPF/nascimento/telefone.
3. **Checkbox "Sem número"** — desabilita o campo Número e grava `"S/N"`, sem coluna nova no banco.

## Arquitetura

### 1. Schema (`prisma/schema.prisma`)

```prisma
model AthleteProfile {
  ...
  postalCode   String?
  street       String?
  number       String?
  complement   String?
  neighborhood String?
  city         String?   // já existe
  state        String?   // já existe
  ...
}
```

Migration aditiva, escrita à mão (mesmo padrão de todas as migrations recentes do projeto — sem
acesso a banco de produção neste ambiente). Todos os campos continuam nullable no banco —
obrigatoriedade é imposta na aplicação via o gate, nunca via constraint de banco (não há dado
existente a preservar, mas forçar `NOT NULL` quebraria toda conta que ainda não passou pelo gate).

### 2. `lib/cep.ts` (novo)

```ts
export function normalizeCep(raw: string): string   // só dígitos → "00000-000"
export function isValidCep(cep: string): boolean    // 8 dígitos após normalizar

export interface CepAddress {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

export async function fetchAddressByCep(cep: string): Promise<CepAddress | null>
// chama https://viacep.com.br/ws/{8 dígitos}/json/ direto do cliente (sem proxy no backend,
// API pública sem autenticação). Nunca lança: erro de rede, timeout, CEP mal formado, ou resposta
// { erro: true } do ViaCEP (CEP inexistente) todos retornam null. Chamador trata null como
// "autocomplete indisponível, preencher manualmente".
```

Mesmo padrão de `lib/cpf.ts` (funções puras testáveis + normalização centralizada, usada por toda
rota que grava o campo).

### 3. Gate de cadastro incompleto (estendido, não recriado)

`lib/auth/profile-completion.ts`:

```ts
export type MissingAthleteField =
  | "birthDate" | "cpf" | "phone"                              // já existentes
  | "postalCode" | "street" | "number" | "neighborhood"          // novos
  | "city" | "state";                                            // promovidos de "sugerido"
```

`getMissingAthleteProfileFields` passa a checar também esses 6 campos novos (`complement` nunca
entra — é opcional). `getSuggestedAthleteProfileFields` perde `city`/`state` do array (deixam de
ser sugestão, agora fazem parte da obrigatoriedade).

Os 3 pontos de enforcement (`dashboard/layout.tsx`, `inscricao/[slug]/page.tsx`,
`completar-cadastro/page.tsx`) não precisam de nenhuma mudança de lógica — já redirecionam sempre
que a lista de campos faltantes não é vazia; só passam a redirecionar mais gente (quem tem
CPF/nascimento/telefone ok mas nunca preencheu endereço).

### 4. Três pontos de UI, cada um com sua própria integração ao `lib/cep.ts`

Sem componente de JSX compartilhado — `RegisterForm.tsx` usa `react-hook-form` +
`zodResolver`, enquanto `CompletarCadastroForm.tsx`/`app/dashboard/perfil/page.tsx` usam
`useState` manual. Forçar um único componente controlado bateria de frente com esses dois
paradigmas de estado; a lógica que realmente vale centralizar (parsing da resposta do ViaCEP,
tratamento de erro) já está isolada em `lib/cep.ts`, chamada igualmente pelos 3.

**Ordem visual em todo lugar, sempre**: CEP → Rua/Logradouro → Número → Complemento → Bairro →
Cidade → Estado/UF. Checkbox "Sem número" ao lado do campo Número em todo lugar que ele aparece.

- **`components/auth/RegisterForm.tsx` + `app/api/auth/register/route.ts`**: os 6 campos
  obrigatórios (`complement` opcional) adicionados ao `superRefine` do schema Zod (client e
  servidor, mesmo padrão de `birthDate`/`cpf`/`phone`), só quando `role === "ATHLETE"`.
  `db.athleteProfile.create` passa a incluir os campos de endereço.
- **`app/completar-cadastro/CompletarCadastroForm.tsx`**: renderiza só os campos de endereço que
  estiverem na lista de `missingFields` (mesmo padrão condicional já usado pra
  `birthDate`/`cpf`/`phone`).
- **`app/dashboard/perfil/page.tsx`**: novo card "Endereço", inserido depois de "Dados pessoais".
  `city`/`state` migram do card "Dados pessoais" pra este novo card (mesmos campos do
  `AthleteProfile`, só mudam de lugar na tela). Asterisco em tudo menos Complemento.
- **`app/api/athlete/profile/route.ts` (`PUT`)**: schema Zod ganha os 5 campos novos como
  opcionais (a obrigatoriedade real é imposta pelo gate, não por esta rota — ela é a mesma rota
  usada tanto pelo gate quanto pela edição livre em "Meus Dados", que precisa aceitar atualização
  parcial).

### 5. Normalização

- CEP: salvo como `"00000-000"` (`normalizeCep`).
- UF: 2 letras maiúsculas (já é o comportamento atual de `state`, reaproveitado).
- Número: `"S/N"` quando o checkbox "Sem número" está marcado.

## Fora de escopo

- Correção de endereço pelo admin (via `UserForm.tsx`/`PATCH /api/admin/users/[id]`, como existe
  pra CPF) — não é necessário, endereço nunca fica bloqueado pro próprio atleta editar.
- Backfill de dado existente — não existe dado de endereço estruturado a migrar.
- Validação de CEP contra uma base além do ViaCEP (ex.: Correios oficial) — só o que o ViaCEP
  retorna.
- Suporte a endereço internacional — fora do escopo pedido, mesma limitação assumida no documento
  original (`taskwhatsapp.md`).

## Testes

- `lib/cep.ts`: unitários para `normalizeCep`/`isValidCep` (formatos com/sem máscara, tamanho
  errado) e `fetchAddressByCep` (sucesso, `{ erro: true }` do ViaCEP, erro de rede/timeout — todos
  devem resolver pra `null` sem lançar).
- `lib/auth/profile-completion.ts`: testes existentes atualizados pros novos campos; casos novos
  cobrindo perfil parcialmente completo (ex.: só falta `number`).
- `PUT /api/athlete/profile`: aceita os 5 campos novos, aceita atualização parcial, normaliza CEP.
- `POST /api/auth/register`: endereço obrigatório e validado pra `ATHLETE`, não exigido pra
  `ORGANIZER`, rejeita CEP com formato inválido.
- Sem testes de UI (convenção já estabelecida no projeto).
- Verificação manual: fluxo completo de um atleta com perfil incompleto sendo redirecionado tanto a
  partir do `/dashboard` quanto de `/inscricao/[slug]`, preenchendo o endereço (com e sem
  autocomplete de CEP funcionando) e sendo liberado; cadastro novo pedindo endereço; edição de
  endereço já completo em "Meus Dados".
