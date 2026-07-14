# Usuários Assistentes — Fase 1 (infraestrutura + domínio Eventos) — Design

## Contexto

O usuário pediu que admin e organizador possam criar "usuários assistentes": contas com acesso
restrito, configuráveis em duas modalidades — (a) somente visualizar dados e baixar CSV, ou (b)
executar ações específicas escolhidas dentre as ações disponíveis no sistema. Se o e-mail
informado já pertence a um usuário existente, esse usuário deve ser reaproveitado/promovido em
vez de duplicado. Pediu explicitamente uma análise de todas as ações do sistema antes de
desenhar isso — feita e documentada em
`docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`.

Essa análise encontrou ~16 áreas de ação e várias rotas "multi-responsabilidade" (uma única rota
atende múltiplas intenções distintas — ex.: `admin/settings` atende 11+ tipos de credencial;
`admin/users/[id]` PATCH tanto edita perfil quanto promove a admin quanto reseta senha). Cobrir
todas as ~90 ações de uma vez seria um projeto enorme e arriscado. Por isso o trabalho foi
dividido em duas fases:

- **Fase 1 (este documento):** infraestrutura completa (modelo de dados, fluxo de criar/promover
  assistente, telas de gestão, mecanismo de checagem de permissão) aplicada a **um domínio só —
  Eventos** — como prova de conceito completa, testada e revisável de ponta a ponta.
- **Fase 2 (spec separada, depois):** aplica o mesmo padrão já validado aos domínios restantes do
  escopo v1 (lotes/categorias/percursos, inscrições/pedidos, cupons, pagamentos/estornos,
  resultados, carrinhos abandonados, relatórios/exportações CSV).

## Decisões confirmadas com o usuário

- **Papel novo dedicado:** `UserRole` ganha `ASSISTANT`. `ADMIN`/`ORGANIZER` titulares mantêm o
  significado exato de hoje (sem restrição) — nada muda pra contas existentes.
- **Escopo do organizador:** o assistente não tem `OrganizerProfile` próprio; ele aponta para
  quem o criou (`createdByUserId`), e toda rota organizadora resolve o "organizerId efetivo" por
  esse vínculo quando o usuário logado é um `ASSISTANT`.
- **Escopo da v1** (ações candidatas a ganhar permissão granular, ao longo das duas fases): 
  Eventos, Lotes/Categorias/Percursos, Inscrições/Pedidos, Cupons, Pagamentos/Estornos,
  Resultados, Carrinhos Abandonados, Relatórios/Exportações CSV. **Nunca entram** (nem na fase 2):
  Backup/Restauração (risco extremo, wipe de banco inteiro), Configurações da Plataforma (rota
  multi-responsabilidade mais arriscada do app), Gestão de Usuários/trocar papel/redefinir senha
  (rota multi-responsabilidade que inclui escalação de privilégio), WhatsApp/SMTP de plataforma,
  Auditoria, Repasses (controle financeiro sensível), Perfil/conta pessoal (é sempre "só eu
  mesmo", não faz sentido delegar).
- **Promoção de usuário existente:** se o e-mail já pertence a um `ATHLETE`, promove em pé
  (mesma linha `User`, mesmo histórico/inscrições preservado) — mesmo trade-off que já existe
  hoje quando qualquer usuário troca de papel (perde acesso à área de atleta, ganha acesso à área
  de assistente, redirecionamento por papel já funciona assim). Se o e-mail já pertence a um
  `ADMIN`/`ORGANIZER` **titular**, a criação é **bloqueada** com mensagem clara — não promove
  conta titular a assistente.
- **Revogação:** reaproveita o campo `active` já existente em `User` (mesmo mecanismo de
  bloqueio já usado em `ToggleUserActiveButton`) — sem mecanismo novo.
- **Onboarding de conta nova:** e-mail de convite com link de definir senha, reaproveitando o
  padrão já existente de `sendPasswordResetEmail`/fluxo de "esqueci minha senha".
- **Tela de gestão:** páginas dedicadas novas — `/admin/assistentes` e
  `/organizador/assistentes` — não reaproveita `/admin/usuarios` (escopo de dados é diferente:
  admin é plataforma inteira, organizador é só os próprios eventos).
- **Leitura é granular por domínio**, não automática — cada domínio tem sua própria permissão de
  "visualizar" (`<domínio>.view`), que cobre ver as páginas daquele domínio E exportar CSV. Ações
  de escrita são permissões adicionais, uma por ação. Marcar qualquer ação de escrita de um
  domínio implica automaticamente a permissão de visualização daquele domínio (não dá pra
  conceder "aprovar evento" sem "ver eventos").
- **Dois modos na UI de criação:** "Somente visualização e exportação" (marca só as permissões
  `.view` dos domínios disponíveis, nenhuma ação de escrita) e "Ações específicas" (checklist
  completo, granular, por domínio e ação).

## Arquitetura

### 1. Schema

```prisma
enum UserRole {
  ATHLETE
  ORGANIZER
  ADMIN
  SUPPORT
  PARTNER
  ASSISTANT
}
```

`User` ganha:

```prisma
  createdByUserId String?
  createdBy       User?   @relation("AssistantCreator", fields: [createdByUserId], references: [id])
  createdAssistants User[] @relation("AssistantCreator")
```

Nova tabela:

```prisma
model AssistantPermission {
  id        String   @id @default(cuid())
  userId    String
  actionKey String
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, actionKey])
  @@map("assistant_permissions")
}
```

`actionKey` é uma string estável (ex.: `"events.view"`, `"events.approve"`) — desacoplada da URL
da rota, pra um refactor de rota futuro não invalidar silenciosamente permissões já concedidas.

### 2. Chaves de permissão da Fase 1 (domínio Eventos)

| Chave | Ação | Quem concede (criador do assistente) |
|---|---|---|
| `events.view` | Ver eventos e exportar CSV | admin ou organizador |
| `events.approve` | Aprovar evento | admin |
| `events.reject` | Rejeitar evento | admin |
| `events.set-fee` | Definir taxa de plataforma do evento | admin |
| `events.edit` | Editar evento (inclui submeter para análise — mesma rota hoje, sem separação de intenção possível) | admin ou organizador |
| `events.delete` | Excluir evento | admin ou organizador |
| `events.archive` | Arquivar/cancelar evento | admin ou organizador |
| `events.create` | Criar evento | organizador |
| `events.duplicate` | Duplicar evento | organizador |

Um assistente criado por um admin só vê no checklist as chaves marcadas "admin" acima (mais
`events.view`); um assistente criado por um organizador só vê as marcadas "organizador" (mais
`events.view`). `events.edit`/`events.delete`/`events.archive` existem para os dois lados porque
a ação existe nos dois contextos (admin edita/exclui/arquiva qualquer evento; organizador só os
próprios) — são a mesma `actionKey`, escopada de forma diferente conforme quem está executando
(igual já acontece hoje com as rotas titulares).

### 3. Checagem de permissão — `lib/auth/rbac.ts`

```ts
export async function requirePermission(actionKey: string): Promise<Session> {
  const session = await requireAuth();
  if (session.user.role === "ADMIN" || session.user.role === "ORGANIZER") return session;
  if (session.user.role === "ASSISTANT") {
    const granted = await db.assistantPermission.findUnique({
      where: { userId_actionKey: { userId: session.user.id, actionKey } },
    });
    if (granted) return session;
  }
  // redireciona/retorna 403, mesmo padrão de erro já usado por requireAdmin/requireOrganizer
}

export async function getEffectiveOrganizerId(session: Session): Promise<string | null> {
  if (session.user.role === "ORGANIZER") {
    const profile = await db.organizerProfile.findUnique({ where: { userId: session.user.id } });
    return profile?.id ?? null;
  }
  if (session.user.role === "ASSISTANT") {
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { createdByUserId: true },
    });
    if (!user?.createdByUserId) return null;
    const profile = await db.organizerProfile.findUnique({ where: { userId: user.createdByUserId } });
    return profile?.id ?? null;
  }
  return null;
}
```

`ADMIN`/`ORGANIZER` titulares nunca tocam a tabela `AssistantPermission` — a checagem pra eles é
idêntica à de hoje (só o papel), sem custo extra de query. Só uma sessão `ASSISTANT` dispara a
consulta indexada extra (`@@unique([userId, actionKey])`, leitura de uma linha só).

### 4. Rotas afetadas na Fase 1

Cada rota do domínio Eventos troca sua checagem de papel (`requireAdmin()`/`requireOrganizer()`)
por `requirePermission("events.<ação>")`, e cada rota organizadora troca a resolução direta de
`OrganizerProfile` por `getEffectiveOrganizerId(session)`. A lista exata de arquivos e o código
exato de cada troca ficam para o plano de implementação (não repetidos aqui — a análise de ações
já mapeou os arquivos em
`docs/superpowers/specs/2026-07-14-analise-acoes-sistema.md`, seção "1. Eventos").

### 5. Fluxo de criação/promoção de assistente

`POST /api/admin/assistants` e `POST /api/organizer/assistants` (rotas separadas, já que o
escopo de "quem pode ser criador" e o filtro de chaves disponíveis no formulário diferem):

1. Recebe `{ email, name, actionKeys: string[] }`.
2. Busca `User` por e-mail.
   - Não existe → cria novo `User` com `role: "ASSISTANT"`, `createdByUserId` = quem está
     criando, sem `passwordHash` (fica `null` até o convite ser aceito), dispara e-mail de
     convite (reaproveita o template/fluxo de reset de senha).
   - Existe e `role === "ATHLETE"` → atualiza esse `User` para `role: "ASSISTANT"`,
     `createdByUserId` = quem está criando. **Mantém** `passwordHash`/histórico/inscrições
     intactos — não dispara convite (a pessoa já tem senha).
   - Existe e `role` é `ADMIN`/`ORGANIZER` → **400**, mensagem "Este e-mail já pertence a uma
     conta titular e não pode virar assistente."
   - Existe e `role` já é `ASSISTANT` de outro criador, ou `SUPPORT`/`PARTNER` → tratado como
     "conta titular" pra efeitos desse bloqueio (não promove; evita reatribuir silenciosamente um
     assistente de outra pessoa).
3. Grava as linhas de `AssistantPermission` (substitui o conjunto anterior por completo, se for
   uma edição).

### 6. Telas

- `app/admin/assistentes/page.tsx` — lista os assistentes criados pelo admin logado (ou por
  qualquer admin? — **decisão: qualquer admin vê todos os assistentes criados por qualquer
  admin**, já que a conta admin é plataforma inteira, não faz sentido segmentar por "quem
  criou" na visão de admin) + botão "Criar assistente" (nome, e-mail, modo
  visualização/específico, checklist de `events.*`) + editar permissões de um assistente
  existente + botão revogar (reaproveita `ToggleUserActiveButton`, adaptado).
- `app/organizador/assistentes/page.tsx` — mesma estrutura, mas lista só os assistentes cujo
  `createdByUserId` é o organizador logado (aqui sim segmentado, já que cada organizador só deve
  ver os próprios assistentes).

## Testes

- Testes de `requirePermission`/`getEffectiveOrganizerId` (unitários): admin/organizador sempre
  passam sem query extra; assistente com permissão concedida passa; assistente sem a permissão é
  barrado; assistente resolve `organizerId` efetivo pelo criador corretamente.
- Testes de rota para `POST /api/admin/assistants` / `POST /api/organizer/assistants`: criação de
  usuário novo (dispara convite), promoção de `ATHLETE` existente (preserva dados, não dispara
  convite), bloqueio de e-mail já titular (400), gravação correta do conjunto de
  `AssistantPermission`.
- Testes de cada rota de Eventos tocada: assistente com a permissão específica consegue; sem a
  permissão, 403; admin/organizador titular continuam funcionando exatamente como hoje (nenhuma
  regressão).

## Fora de escopo (Fase 1)

- Qualquer domínio além de Eventos (fica pra Fase 2).
- Edição de e-mail/nome de um assistente já criado (só permissões e revogar/reativar).
- Qualquer ação das áreas permanentemente excluídas (Backup, Configurações, Gestão de Usuários,
  WhatsApp/SMTP de plataforma, Auditoria, Repasses, Perfil pessoal).
- Log de auditoria específico de "assistente fez X" (ações de assistente já passam pelo mesmo
  `AuditLog` que qualquer outra ação hoje, sem campo extra distinguindo "foi um assistente" —
  pode ser considerado numa fase futura se necessário).
