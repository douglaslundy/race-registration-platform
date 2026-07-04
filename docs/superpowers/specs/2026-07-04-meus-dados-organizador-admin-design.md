# Página "Meus Dados" completa para organizador e admin

## Contexto

O usuário pediu uma página de perfil mais completa para `ORGANIZER` e `ADMIN`, renomeada para
"Meus Dados" (mesmo rótulo já usado na área do atleta), permitindo editar nome, telefone e senha,
além de cadastrar CPF. Decisão explícita do usuário: e-mail continua **sem edição** (só exibição).

## Levantamento

- **Organizador** (`app/organizador/perfil/page.tsx:1-86`) já edita dados da organização
  (`companyName`, `cnpj`, `phone` comercial, `website`, `bio`) via `/api/organizer/profile`
  (`app/api/organizer/profile/route.ts`), que lê/grava em `OrganizerProfile` (upsert por
  `userId`). Nome e e-mail aparecem só como texto (`session.user.name`/`email`, linha 52),
  não editáveis.
- **Admin** (`app/admin/perfil/page.tsx:1-77`) já edita só `phone` (`User.phone`) via
  `/api/admin/profile` (`app/api/admin/profile/route.ts`). Mesma coisa: nome/e-mail só leitura.
- **Nenhum dos dois** tem troca de senha hoje.
- **Atleta** (`app/dashboard/perfil/page.tsx`) já tem exatamente esse padrão de "Meus Dados":
  dados pessoais editáveis (linhas 100-163) + card de troca de senha (linhas 196-241), chamando
  `/api/auth/change-password` (`app/api/auth/change-password/route.ts`) — essa rota **já é
  genérica** (só depende de `session.user`, não de `role` — linha 13-14), reusável sem qualquer
  mudança no backend.
- **`User`** (`prisma/schema.prisma:95-119`) não tem campo `cpf` hoje — só existe em
  `AthleteProfile.cpf` (`prisma/schema.prisma:162`, opcional, sem `@unique`). `User.phone` já
  existe (linha 101, opcional) e é **diferente** de `OrganizerProfile.phone` (telefone comercial
  da organização) — são dois campos distintos hoje.

## Design

### 1. Schema: `cpf` no `User`

Adicionar `cpf String?` ao model `User` em `prisma/schema.prisma`, sem `@unique` — mesmo padrão já
usado em `AthleteProfile.cpf`. Requer migração (`prisma migrate dev` local; depois `db push`/
deploy na VPS, seguindo o processo já estabelecido do projeto).

### 2. Componente compartilhado: `ChangePasswordForm`

Extrair `components/profile/ChangePasswordForm.tsx`, replicando o formulário/comportamento já
existente em `app/dashboard/perfil/page.tsx` (senha atual + nova + confirmação, valida
confirmação e tamanho mínimo no client, chama `POST /api/auth/change-password`). Usado pelas
páginas do organizador e do admin. A página do atleta não é tocada (mantém sua versão inline;
fora de escopo desta tarefa refatorá-la).

### 3. Admin (`app/admin/perfil/page.tsx` + `/api/admin/profile`)

- Adiciona campos **Nome** e **CPF** editáveis, mantendo o campo Telefone já existente. E-mail
  continua só leitura.
- `/api/admin/profile`: o schema Zod passa a aceitar `name` (string, obrigatório) e `cpf` (string
  opcional, `max(14)` — mesmo padrão de validação de tamanho já usado no schema de checkout para
  CPF), além do `phone` já existente. GET retorna os três campos; PUT atualiza os três em
  `db.user.update`.
- Adiciona o `ChangePasswordForm` na página.
- `<h1>` da página passa de "Meu perfil" para "Meus Dados".

### 4. Organizador (`app/organizador/perfil/page.tsx`)

- Novo card **"Dados pessoais"** (antes do card já existente "Dados da organização", que não é
  alterado): Nome, Telefone pessoal, CPF editáveis; e-mail só leitura.
- Como esses campos vivem em `User` (não em `OrganizerProfile`), cria-se uma rota nova
  `app/api/organizer/account/route.ts` (GET/PUT) só para isso — `/api/organizer/profile`
  continua exatamente como está, só para os dados da empresa (`OrganizerProfile`). Mesmo padrão
  de validação Zod do item 3 (name obrigatório, cpf opcional max 14, phone opcional).
- Adiciona o `ChangePasswordForm` na página.
- `<h1>` da página passa de "Perfil do Organizador" para "Meus Dados".

### 5. Renomear "Perfil" → "Meus Dados" nos menus

- `components/admin/AdminNav.tsx`: rótulo do link (href `/admin/perfil` inalterado) muda de
  "Perfil" para "Meus Dados".
- `components/organizer/OrganizerNav.tsx`: mesmo rótulo, nas duas versões (desktop e mobile) —
  href `/organizador/perfil` inalterado.

## Fora de escopo

- Edição de e-mail (decisão explícita do usuário: não muda).
- Qualquer refatoração da página `/dashboard/perfil` do atleta (mantém seu formulário de senha
  inline, sem usar o novo componente compartilhado).
- Validação de dígito verificador de CPF (mesma convenção já usada no checkout: só limite de
  tamanho, sem checksum).
- Unicidade de CPF entre usuários (segue o padrão já usado em `AthleteProfile.cpf`, sem
  `@unique`).
