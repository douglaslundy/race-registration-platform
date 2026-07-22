# Inscrição por procuração (inscrever outro atleta)

## Contexto

Pedido do usuário: permitir que um atleta logado inscreva **outro** atleta num evento, quando o
organizador (ou admin) habilitar isso pro evento. As mensagens do sistema (confirmação de
inscrição) devem ir tanto pra quem criou a inscrição quanto pro atleta inscrito. A listagem/
exportação de inscritos deve mostrar os dados do atleta, não de quem comprou.

Dividido em 3 fases (decisão do usuário) — esta spec cobre só as fases A e B:

- **Fase A** (esta spec): fluxo completo de inscrição por procuração — toggle, modal, checkout,
  notificações duplas, listagens/exportação, "minhas inscrições".
- **Fase B** (esta spec, empacotada junto): se o CPF informado já pertence a uma conta existente,
  a inscrição é vinculada a essa conta em vez de criar uma nova.
- **Fase C** (fora desta spec, fica pra uma spec dedicada futura): quando o CPF **não** bate com
  nenhuma conta existente, vincular automaticamente as inscrições antigas quando essa pessoa se
  cadastrar depois com o mesmo CPF. Avaliada tecnicamente como implementável, mas envolve um
  conceito novo de "conta pendente/placeholder" + mudança no fluxo de cadastro pra "reivindicar"
  uma conta em vez de rejeitar CPF duplicado — peça isolada e sensível o bastante (mexe em quem
  pode assumir uma conta) pra merecer brainstorm e revisão próprios.

## Achado-chave que reduz o escopo

`Order.buyerUserId` (quem paga) e `Registration.athleteUserId` (pra quem é a inscrição) **já são
campos separados** no schema — só que `lib/checkout.ts::createCheckout` já aceita os dois
parâmetros de forma independente, e é só `app/api/checkout/route.ts` que hoje força
`athleteUserId: session.user.id` (sempre igual ao comprador). Como toda a leitura de "quem é o
atleta" no resto do sistema (listagem de inscritos, busca/filtro, exportação — ver
`lib/organizer/registrations.ts`) já usa a relação `registration.athlete` (não
`order.buyer`), **nada no restante do sistema precisa mudar** pra já mostrar os dados certos assim
que `athleteUserId` apontar pra pessoa certa. "É uma inscrição por procuração" nunca precisa ser
armazenado — é sempre computado como `order.buyerUserId !== registration.athleteUserId`.

## 1. Schema — 1 campo novo

```prisma
model Event {
  // ...campos existentes...
  allowProxyRegistration Boolean @default(false)
}
```

Editável pelo organizador dono do evento ou por qualquer admin — mesmo padrão de outras
configurações de evento já existentes (ex.: `cancellationRequiresApproval`), sem chave mestra
separada de plataforma.

Nenhum outro campo novo em `Registration`, `Order` ou `User`.

## 2. UI — toggle do organizador/admin

Novo checkbox "Permitir inscrição por procuração (atleta inscrever outra pessoa)" no formulário de
edição de evento em `app/organizador/eventos/[id]/editar` — página única (não existe uma página de
edição de evento separada pro admin), junto aos outros toggles booleanos do evento. Rota
`PATCH /api/events/[id]` ganha o campo `allowProxyRegistration` no schema Zod, mesmo padrão dos
outros campos booleanos já aceitos ali.

**Fix incluído (achado durante o brainstorm, aprovado pelo usuário)**: a página
`app/organizador/eventos/[id]/editar/page.tsx` hoje busca o evento com
`db.event.findFirst({ where: { id, organizer: { userId: session.user.id } } })` — isso encontra o
evento pro organizador dono, mas nunca encontra nada pra um admin (ele não tem
`OrganizerProfile` próprio), mesmo `requireOrganizer()` deixando o admin passar pelo gate de
papel. Isso afeta **todos os campos do formulário hoje**, não é específico deste recurso — mas
como o pedido explícito é "organizador ou admin", a página passa a resolver o escopo com
`resolveActingScope` (mesmo padrão já usado pela própria rota `PATCH`): se `actingAsAdmin`, busca
só por `id`; senão, mantém a busca por `organizer.userId` como hoje.

## 3. UI — opção na página de inscrição + modal

Em `components/checkout/CheckoutForm.tsx`, quando `event.allowProxyRegistration` for `true` (prop
nova vinda do server component `app/(public)/inscricao/[slug]/page.tsx`), aparece um seletor logo
no topo do formulário:

```
Para quem é esta inscrição?
( ) Para mim
( ) Para outro atleta
```

Selecionar "Para outro atleta" abre um novo componente `components/checkout/ProxyAthleteModal.tsx`
(reaproveitando o padrão visual de modal já usado no projeto — nunca dialog nativo). Ao salvar, o
modal preenche um estado `proxyAthlete` no `CheckoutForm` (não navega nem envia nada ainda — só
guarda os dados até o "Confirmar Inscrição" real) e mostra um resumo compacto ("Inscrevendo:
[nome] — CPF ...") com opção de editar/trocar pra "Para mim".

**Campos do modal** (mescla os campos hoje coletados em duas telas diferentes — cadastro de conta
e checkout — com a mesma obrigatoriedade de hoje em cada uma, `isValidCpf`/`normalizeCpf` de
`lib/cpf.ts` reaproveitados para o CPF):

| Campo | Obrigatório | Origem (campo equivalente hoje) |
|---|---|---|
| Nome completo | sim | `RegisterForm` → `User.name` |
| Data de nascimento | sim | `RegisterForm` → `AthleteProfile.birthDate` |
| CPF | sim | `RegisterForm` → `AthleteProfile.cpf` |
| Telefone | sim | `RegisterForm` → `AthleteProfile.phone` |
| E-mail | **não** (única exceção) | `RegisterForm` → `User.email` |
| Percurso | sim, se o evento tiver | `CheckoutForm` → `Registration.routeId` |
| Categoria | sim, se o evento tiver | `CheckoutForm` → `Registration.categoryId` |
| Contato de emergência (nome+telefone) | sim | `CheckoutForm` → `Registration.emergencyContact*` |
| Camiseta | não | `CheckoutForm` → `Registration.shirtSize` |
| Equipe/assessoria | não | `CheckoutForm` → `Registration.teamName` |
| Informações médicas | não | `CheckoutForm` → `Registration.medicalNotes` |
| Observação | não | `CheckoutForm` → `Registration.notes` |

O checkbox de aceite de termos continua único (o comprador aceita em nome dos dois — sem campo
extra de autorização).

## 4. Backend — `lib/checkout.ts::createCheckout`

Novo parâmetro opcional em `CheckoutInput`:

```ts
proxyAthlete?: {
  name: string;
  birthDate: string;
  cpf: string;
  phone: string;
  email?: string;
};
```

Dentro da mesma `db.$transaction` já existente (antes de criar `Order`/`Registration`), se
`input.proxyAthlete` estiver presente:

1. Normaliza o CPF (`normalizeCpf`).
2. `tx.athleteProfile.findFirst({ where: { cpf: normalizedCpf } })`.
3. **Achou** (Fase B): usa `profile.userId` como `athleteUserId`. Se esse `userId` for igual ao
   `input.buyerUserId` (o comprador digitou o próprio CPF), trata como inscrição normal — ignora
   o resto dos dados do modal, sem necessidade de tratamento especial adicional (o resultado já é
   idêntico a uma inscrição normal, já que `athleteUserId === buyerUserId`).
4. **Não achou**: cria um novo `User` (role `ATHLETE`) + `AthleteProfile` com os dados do modal,
   dentro da mesma transação:
   - `email`: se informado, usado direto (ainda respeitando `@unique` — se colidir com um e-mail
     já cadastrado por outra conta, lança erro `"Este e-mail já está em uso por outra conta"`,
     mesmo texto/comportamento de uma colisão de e-mail no cadastro normal). Se **não** informado,
     gera um e-mail sintético via duas novas funções em `lib/proxy-athlete.ts` (novo arquivo,
     dedicado a este recurso — mesmo padrão de módulo próprio por feature já usado em
     `lib/ads/private-ads.ts`/`lib/checkout-ads.ts`): `generatePlaceholderEmail(): string` (usa
     `randomUUID()` + domínio fixo `@sememail.internal`, nunca roteável) e
     `isPlaceholderEmail(email: string): boolean` (checa o sufixo do domínio) — usada na seção 6
     pra nunca tentar mandar e-mail real pro endereço sintético.
   - `passwordHash: null` (mesmo padrão já usado pra contas convidadas sem senha — bloqueia login
     até a senha ser definida; `authorize()` do NextAuth já trata `!user.passwordHash` como login
     inválido, sem mudança necessária ali).
   - `phone`: no próprio `User.phone` (campo já existente).
   - Usa esse novo `userId` como `athleteUserId`.
5. `athleteUserId` resolvido (existente ou recém-criado) segue pro resto da função exatamente como
   hoje (criação de `Registration`, checagem de percurso/categoria etc. — nenhuma mudança ali).

## 5. Convite de acesso (quando cria conta nova com e-mail informado)

Depois que a transação de checkout commitar com sucesso (fora da transação, fire-and-forget, igual
ao padrão de `notifyOrderConfirmed`): se um novo `User` foi criado com e-mail real (não sintético),
gera um `VerificationToken` (`identifier: email, token: randomBytes(32).toString("hex"), expires:
+1h`) e envia e-mail via nova função `sendProxyRegistrationInviteEmail` em `lib/email.ts` (mesmo
padrão de `sendAssistantInviteEmail`/`createOrPromoteAssistant`, ver
`lib/assistants/create-or-promote.ts`), com link pra `/auth/nova-senha?token=...&email=...` —
reaproveita a página de definir senha já existente, sem mudança nela. Texto do e-mail explica que
`[nome do comprador]` inscreveu você em `[evento]` e que esse link permite acessar a própria conta.

## 6. Notificações de confirmação de pagamento — `lib/notifications.ts::notifyOrderConfirmed`

Query ganha os campos do atleta (hoje só busca `athleteProfile.phone`; passa a buscar também
`athlete.id`/`athlete.name`/`athlete.email`):

- Se `order.buyer.id === registration.athlete.id` (não é procuração): comportamento **idêntico**
  ao de hoje, sem nenhuma mudança de texto/canal.
- Se forem pessoas diferentes (é procuração):
  - **Comprador**: e-mail (como hoje) + WhatsApp se tiver telefone cadastrado no próprio `User`
    — texto explícito: "Você inscreveu **[nome do atleta]** em **[evento]**...".
  - **Atleta**: e-mail (só se o e-mail não for o sintético — checar via
    `isPlaceholderEmail`) + WhatsApp (usa `athleteProfile.phone`, sempre presente já que é campo
    obrigatório do modal) — texto explícito: "**[nome do comprador]** criou uma inscrição pra você
    em **[evento]**...".

Refatorar a função internamente pra ter um helper reutilizável (envia e-mail+WhatsApp pra uma
pessoa com um texto dado) chamado 1x (fluxo normal) ou 2x (fluxo por procuração), em vez de
duplicar a lógica de envio inline.

## 7. "Minhas inscrições" (`app/dashboard/inscricoes/page.tsx`)

Query passa de `where: { athleteUserId: session.user.id }` para
`where: { OR: [{ athleteUserId: session.user.id }, { order: { buyerUserId: session.user.id } }] }`.
Lista única (sem aba separada) — cada linha onde `athleteUserId !== buyerUserId` **e**
`order.buyerUserId === session.user.id` (ou seja, "eu criei pra outra pessoa") ganha uma etiqueta
"Inscrito por você — [nome do atleta]"; linhas onde o usuário logado É o atleta continuam exibidas
normalmente, sem etiqueta nova.

## Casos de borda

- Comprador digita o próprio CPF no modal: reduz automaticamente a uma inscrição normal (ver
  passo 3 da seção 4) — nenhum tratamento especial necessário além do já descrito.
- E-mail informado no modal já pertence a outra conta: erro claro, checkout não prossegue (mesma
  mensagem/comportamento de colisão de e-mail já usado no cadastro normal).
- CPF inválido (dígito verificador): validado no cliente (`isValidCpf`) antes de fechar o modal,
  e novamente no servidor antes de criar a conta (mesmo padrão de dupla validação já usado no
  cadastro normal).
- Evento com `allowProxyRegistration = false`: opção "Para outro atleta" nem aparece — sem mudança
  de comportamento pra eventos que não habilitarem.
- Cancelamento de inscrição por procuração: nenhuma mudança nas rotas de cancelamento existentes —
  elas já operam sobre `Registration`/`Order` sem assumir que atleta e comprador são a mesma
  pessoa (não há nenhuma checagem hoje que dependa disso).

## Fora de escopo (explicitamente)

- Fase C (vínculo retroativo por CPF no cadastro futuro) — spec própria, futura.
- Preview ao vivo do CPF no modal (ex.: "já encontramos uma conta com esse CPF") — o lookup
  acontece só no momento de confirmar a inscrição, não enquanto o comprador digita. Pode ser
  adicionado depois sem mudança estrutural, seguindo o mesmo padrão já usado no preview de cupom.
  YAGNI pra esta primeira versão.
- Qualquer alteração nas rotas de resultado, ranking ou certificado — continuam operando sobre
  `Registration.athleteUserId` exatamente como hoje, já compatível sem mudança.
- Permitir mais de uma inscrição por procuração no mesmo checkout (o checkout já só cria uma
  `Registration` por submissão, igual hoje — sem mudança nesse limite).

## Testes

TDD em toda função de `lib/` e rota de API tocada:

- `lib/checkout.ts`: casos de `proxyAthlete` — cria conta nova (sem e-mail → sintético, com e-mail
  → usado direto), reaproveita conta existente por CPF (Fase B), CPF igual ao do comprador reduz a
  inscrição normal, e-mail duplicado rejeita.
- `lib/notifications.ts`: caso comprador≠atleta manda as 2 mensagens com os textos certos nos
  canais certos; caso comprador=atleta continua idêntico ao comportamento já testado hoje.
- Nova função de convite (`sendProxyRegistrationInviteEmail` + geração do token) — mesmo padrão de
  teste já usado pra `createOrPromoteAssistant`.
- `app/dashboard/inscricoes/page.tsx`: query com `OR` retorna as duas categorias, etiqueta some
  quando o usuário é o próprio atleta.
- Rota de edição de evento: `allowProxyRegistration` aceito e persistido.
- Componentes client (`ProxyAthleteModal`, seletor no `CheckoutForm`) sem teste automatizado —
  mesma convenção já estabelecida no projeto (sem infra de teste de componente React).
