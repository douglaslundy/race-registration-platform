# Design: Edição de dados do atleta por admin/organizador

## Contexto

Hoje, corrigir CPF/nascimento de um atleta é possível **só pelo admin**, via `PATCH /api/admin/users/[id]`
e a tela `/admin/usuarios/[id]/editar` (entregue em `2026-07-06-cpf-obrigatorio-atleta`). Nenhum outro
campo do perfil do atleta (telefone, gênero, cidade, estado, equipe, camiseta) é editável por
admin/organizador — só o próprio atleta edita esses campos, em "Meus Dados"
(`app/dashboard/perfil/page.tsx`, via `PUT /api/athlete/profile`).

O usuário quer estender essa capacidade de correção para **todos os campos do perfil** (incluindo
nome e e-mail da conta), e estendê-la também para o **organizador**, restrito aos atletas inscritos
nos eventos dele.

## Descobertas importantes

- **O atleta já não pode alterar o próprio CPF depois de salvo** — trava tanto na UI
  (`app/dashboard/perfil/page.tsx`, input `disabled`) quanto no backend (`PUT /api/athlete/profile`
  ignora silenciosamente tentativa de mudar CPF já preenchido). Nenhuma mudança necessária aqui;
  este design não toca em `PUT /api/athlete/profile`.
- **A página "Meus Dados" existe e já segue as regras corretas de edição do próprio atleta** — foi
  só confirmada, não precisa de mudança de regra. Único ajuste cosmético identificado e aprovado:
  o bloco de conteúdo (`max-w-2xl`) não tem `mx-auto` próprio, então fica encostado à esquerda
  dentro do container centralizado do layout do dashboard (`max-w-5xl mx-auto`) em telas largas.
- **`AthleteDetailsModal` já é usado em 3 lugares** (`app/admin/usuarios/page.tsx`,
  `app/admin/eventos/[id]/inscritos/page.tsx`, `app/organizador/eventos/[id]/inscritos/page.tsx`),
  sempre em modo leitura. É o ponto de reuso natural para adicionar edição, evitando criar uma tela
  nova de "usuários" para o organizador (que hoje só enxerga atletas via a lista de Inscritos do
  próprio evento).
- **O atleta não é selecionado com `id` nas telas de Inscritos hoje** — `athlete: { select: { name,
  email, athleteProfile: {...} } }` não busca `id`. Precisa ser adicionado nas duas telas de
  Inscritos (admin e organizador) para viabilizar a edição.
- **Padrão de autorização por posse já existe** em rotas do organizador como
  `/api/organizer/registrations/[id]/manual-confirm`: `where: { id, event: { organizer: { userId:
  session.user.id } } }`. O novo endpoint do organizador replica esse padrão.

## Decisões confirmadas com o usuário

1. Organizador só edita atletas **inscritos em algum evento dele** — não é uma lista global de
   usuários como a do admin.
2. Campos editáveis por admin/organizador: **nome, e-mail, CPF, nascimento, telefone, gênero,
   cidade, estado, equipe, tamanho de camiseta**. Senha, papel (role) e status ativo/bloqueado
   **não** entram — continuam exclusivos de `/admin/usuarios/[id]/editar`.
3. Edição acontece **dentro do modal "Ver dados do atleta"** já existente (alterna entre
   visualização e formulário), reaproveitado nas 3 telas onde ele já aparece.
4. Ajuste de centralização em "Meus Dados" (`mx-auto` no bloco `max-w-2xl`) incluído neste mesmo
   trabalho.

## Arquitetura

### 1. `PATCH /api/admin/users/[id]` (estender rota existente)

Adicionar ao `patchSchema`: `phone`, `gender`, `city`, `state`, `teamName`,
`preferredShirtSize` (todos opcionais, mesmo padrão de `cpf`/`birthDate` já existentes). Esses
campos entram no mesmo bloco que já faz `athleteProfile.upsert` dentro da transação — sem
validação de unicidade (só CPF precisa disso). `AuditLog` (`USER_UPDATED`) passa a incluir esses
campos no metadata quando alterados, junto com os já existentes.

### 2. `PATCH /api/organizer/registrations/[id]/athlete` (novo)

```ts
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ORGANIZER") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { id } = await params; // id da Registration, não do User
  // ...valida body com o mesmo shape do admin, exceto role/active/password

  const registration = await db.registration.findFirst({
    where: { id, event: { organizer: { userId: session.user.id } } },
    select: { athleteUserId: true },
  });
  if (!registration) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  // mesma lógica de validação de CPF/e-mail e upsert em AthleteProfile do endpoint do admin,
  // usando registration.athleteUserId como o id do usuário a atualizar
}
```

Autorização por posse da inscrição (não do usuário diretamente), replicando o padrão já usado em
`manual-confirm`/`refund`. Reaproveita `isValidCpf`/`normalizeCpf` de `lib/cpf.ts`. Sem trava de
"CPF já salvo não pode mudar" (essa trava é só para o próprio atleta) — admin e organizador sempre
podem corrigir, como já é hoje para o admin.

### 3. Selects das telas de Inscritos — adicionar `id` do atleta

Em `app/admin/eventos/[id]/inscritos/page.tsx` e `app/organizador/eventos/[id]/inscritos/page.tsx`,
adicionar `id: true` ao `select` de `athlete`. Propagar o campo em `RegistrationRow` (interface em
`components/registrations/RegistrationsTable.tsx`).

### 4. `AthleteDetailsModal` — modo edição

Novos props: `userId: string`, `editEndpoint: string` (URL completa de PATCH), `canEdit: boolean`
(controla se o botão "Editar" aparece — sempre `true` nos 3 pontos de uso, já que o modal só é
renderizado em telas de admin/organizador). Estado local: `mode: "view" | "edit"`. No modo edição,
os campos hoje somente leitura (CPF, nascimento, telefone, gênero, cidade, estado, equipe,
camiseta) e o nome/e-mail (hoje passados como texto simples via `athleteName`/`athleteEmail`) viram
inputs controlados, com o mesmo conjunto de validações client-side já usado em
`CompletarCadastroForm.tsx` para CPF. Gênero e camiseta usam os mesmos widgets/opções já definidos
em `app/dashboard/perfil/page.tsx` (`GENDERS` e `SHIRT_SIZES`), pra manter consistência de valores
gravados. Botões "Salvar"/"Cancelar" substituem "Fechar" nesse modo.
Ao salvar com sucesso, `router.refresh()` e volta pro modo leitura.

Cada tela passa a `editEndpoint` correta:
- `app/admin/usuarios/page.tsx`: `/api/admin/users/${u.id}`
- `app/admin/eventos/[id]/inscritos/page.tsx`: `/api/admin/users/${r.athlete.id}`
- `app/organizador/eventos/[id]/inscritos/page.tsx`: `/api/organizer/registrations/${r.id}/athlete`

### 5. `app/dashboard/perfil/page.tsx` — ajuste de centralização

Trocar `<div className="max-w-2xl space-y-6">` por `<div className="max-w-2xl mx-auto space-y-6">`.

## Fora de escopo

- Qualquer mudança em `PUT /api/athlete/profile` (regra de bloqueio do CPF pelo próprio atleta já
  está correta).
- Editar senha, papel (role) ou status ativo/bloqueado pelo organizador ou pelo modal — continuam
  exclusivos de `/admin/usuarios/[id]/editar`.
- Organizador editar atletas fora de eventos dele.
- Excluir/criar `AthleteProfile` fora do fluxo de upsert já existente.

## Testes

- `PATCH /api/admin/users/[id]`: novos testes para os campos adicionais do perfil (aceita, grava
  via upsert, inclui no audit log).
- `PATCH /api/organizer/registrations/[id]/athlete` (novo arquivo de teste): 401 sem sessão/papel
  errado, 404 quando a inscrição não pertence ao organizador, validação de CPF (inválido/duplicado),
  validação de e-mail duplicado, atualização bem-sucedida de todos os campos, audit log gravado.
- Sem testes de UI para o modo edição do `AthleteDetailsModal`, seguindo a convenção já
  estabelecida no projeto.
- Verificação manual: organizador editando um atleta de evento próprio; tentando (via chamada
  direta à API) editar atleta de evento de outro organizador e recebendo 404; admin editando todos
  os campos pelo modal em Usuários e em Inscritos.
