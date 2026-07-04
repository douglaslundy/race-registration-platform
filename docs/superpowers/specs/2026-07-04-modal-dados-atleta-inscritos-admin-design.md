# Modal de dados do atleta, CSV enriquecido e tela de inscritos no admin

## Contexto

Segundo de três sub-projetos de uma leva de pedidos do usuário. Hoje:

- A tela de inscritos do organizador (`app/organizador/eventos/[id]/inscritos/page.tsx`) não tem
  nenhuma forma de ver os dados de cadastro do atleta (CPF, nascimento, contato de emergência
  etc.) — só nome e e-mail aparecem na tabela.
- O CSV de inscritos (`app/api/events/[id]/registrations/route.ts`) não inclui contato de
  emergência.
- Não existe equivalente da tela de inscritos no ambiente admin — só `app/admin/eventos/[id]/page.tsx`
  (visão geral do evento), sem lista de inscritos.
- `/admin/usuarios` já tem um link "Detalhes" por usuário (navega pra uma página separada com
  histórico de inscrições, estatísticas de organizador etc.), mas nenhum lugar mostra os campos de
  `AthleteProfile`.

## Escopo

Um modal reutilizável de "dados do atleta", usado em 3 lugares: tela de inscritos do organizador,
nova tela de inscritos do admin, e lista `/admin/usuarios`. A tela de inscritos do admin é
**somente leitura** — sem os botões de ação (estornar, aprovar/rejeitar cancelamento, confirmar
manualmente) que a tela do organizador tem, já que hoje só existe rota de admin para estorno, não
para os outros dois; criar essas rotas fica fora de escopo aqui.

## 1. `AthleteDetailsModal` (componente compartilhado)

Novo `components/registrations/AthleteDetailsModal.tsx`, componente cliente. Recebe:

```ts
interface AthleteDetailsModalProps {
  athleteName: string;
  athleteEmail: string;
  profile: {
    cpf: string | null;
    birthDate: Date | null;
    phone: string | null;
    gender: string | null;
    city: string | null;
    state: string | null;
    teamName: string | null;
    preferredShirtSize: string | null;
  } | null;
  registrationContext?: {
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    medicalNotes: string | null;
  };
}
```

Renderiza um botão "Ver dados do atleta"; ao clicar, abre um modal (mesmo padrão visual de
overlay/dialog já usado no admin nesta sessão) mostrando:

- Nome e e-mail do atleta (sempre).
- Seção "Perfil do atleta": CPF, data de nascimento, telefone, gênero, cidade, estado, equipe,
  camiseta preferida — **se `profile` for `null`, mostra "Este atleta ainda não preencheu o perfil"
  em vez da seção**.
- Seção "Dados desta inscrição" (só aparece se `registrationContext` for passado): contato de
  emergência (nome + telefone) e observações médicas preenchidos naquele checkout específico —
  **campos separados do perfil**, podem divergir dele.

Nenhuma chamada de API própria — os dados chegam via props, já buscados pela página que renderiza o
botão (server component), seguindo o padrão do resto do projeto.

## 2. Tela de inscritos do organizador

`app/organizador/eventos/[id]/inscritos/page.tsx`: a query de `registrations` ganha
`athleteProfile: { select: { cpf, birthDate, phone, gender, city, state, teamName,
preferredShirtSize } }` na relação `athlete`, e `emergencyContactName`, `emergencyContactPhone`,
`medicalNotes` no `select`/`include` do próprio `Registration` (campos que já existem no model, só
não eram buscados). Cada linha ganha um `AthleteDetailsModal` com `registrationContext` preenchido.

`app/api/events/[id]/registrations/route.ts`: o CSV ganha duas colunas novas, vindas do
`Registration` (não do perfil) — "Contato de Emergência" e "Telefone de Emergência" — inseridas
depois de "Equipe" e antes de "Status": `Nome,Email,Percurso,Categoria,Lote,Camisa,Equipe,Contato de
Emergência,Telefone de Emergência,Status,Data`.

## 3. Tabela compartilhada e tela de inscritos do admin (nova)

Extrai a renderização da tabela (cabeçalho + linhas, já com a ordem de colunas do sub-projeto 1)
para `components/registrations/RegistrationsTable.tsx`, usado pelas páginas de organizador e admin.
Recebe as `registrations` já buscadas e um `renderActions?: (registration) => ReactNode` opcional —
quando ausente, a coluna "Ações" não é renderizada (caso do admin).

Nova rota `app/admin/eventos/[id]/inscritos/page.tsx`:
- `requireAdmin()`; busca o evento **sem** filtro de `organizerId` (admin vê qualquer evento).
- Reaproveita `buildRegistrationWhere`/`buildRegistrationOrderBy` de `lib/organizer/registrations.ts`
  (já genéricos, sem lógica específica de organizador — nome enganoso, mas o conteúdo não depende de
  papel).
- Reaproveita `ExportCsvButton` (já aceita ADMIN em `app/api/events/[id]/registrations/route.ts`,
  sem mudança) e `RegistrationsTable` sem `renderActions` (somente leitura).
- Mesmo filtro de status e ordenação (alfabética/cronológica) da tela do organizador.

## 4. Reuso do modal em `/admin/usuarios`

Na **lista** `app/admin/usuarios/page.tsx` (não na página de detalhe `[id]`), ao lado do link
"Detalhes" já existente: novo `AthleteDetailsModal` **sem** `registrationContext` (não há uma
inscrição específica em contexto nessa tela — só a seção de perfil aparece). A query da lista ganha
`athleteProfile: { select: { ...mesmos campos } }` no `select` de cada usuário. O link "Detalhes"
permanece exatamente como está, sem nenhuma mudança de comportamento.

## Fora de escopo

- Botões de ação (estornar/aprovar-rejeitar cancelamento/confirmar manualmente) na tela de inscritos
  do admin — ficaria pra um projeto futuro se necessário.
- Botão de reenvio manual de notificação de pagamento não identificado — sub-projeto 3 separado.
- Qualquer mudança na página de detalhe `/admin/usuarios/[id]` — só a lista ganha o botão novo.
