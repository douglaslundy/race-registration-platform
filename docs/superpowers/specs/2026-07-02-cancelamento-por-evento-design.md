# Design: configuração de cancelamento por evento

Sub-projeto 5 de um conjunto maior de pedidos. Adiciona uma política de cancelamento configurável por evento (prazo, automático vs. aprovação do organizador, contato para aviso), controlada por um interruptor global do admin. Mexe em uma rota existente (`app/api/registrations/[id]/cancel/route.ts`) — ver seção de risco abaixo.

## ⚠️ Risco e mitigação

- **Interruptor "kill switch" do admin.** Se o admin não ligar a configuração (`PlatformSetting` global, desligado por padrão), a rota de cancelamento roda **exatamente como hoje**, ignorando todos os campos novos do evento — zero mudança de comportamento até o admin decidir ativar.
- **Retrocompatível por padrão mesmo com o interruptor ligado.** Um evento sem prazo configurado continua permitindo cancelamento a qualquer momento antes do evento começar (comportamento atual). Um evento com `cancellationRequiresApproval = false` (padrão) continua cancelando imediatamente, sem aprovação.
- **Não mexe no estorno.** Aprovar ou negar uma solicitação de cancelamento não dispara estorno automático — o organizador continua acionando o botão "Estornar" (sub-projeto 4) manualmente se quiser devolver o dinheiro, exatamente como já decidido lá.
- **`RegistrationStatus` ganha um valor novo** (`CANCELLATION_REQUESTED`). Os ~10 arquivos que hoje leem esse enum já usam `label ?? status` como fallback (nenhum quebra se não reconhecer o valor novo) — vou atualizar os pontos de exibição mais visíveis (dashboard do atleta, tabela de inscritos do organizador) para mostrar um rótulo amigável.

## Contexto (o que já existe)

- Botão de cancelar do atleta: `components/dashboard/CancelRegistrationButton.tsx`, renderizado em `app/dashboard/inscricoes/[id]/page.tsx`. Hoje: confirmação em duas etapas, sem justificativa, sem checar prazo (a única checagem de data é implícita — "antes do evento começar" — e vive só na API).
- `app/api/registrations/[id]/cancel/route.ts`: só cancela `CONFIRMED`, só antes de `event.startAt`, sempre imediato. Atualiza `Registration`+`Order` para `CANCELLED`, decrementa `TicketBatch.soldCount`, grava `AuditLog`.
- Padrão de interruptor do admin já estabelecido: `PlatformSetting` (chave-valor) + `getSetting`/`upsertSetting` (`lib/settings.ts`) + formulário dedicado em `/admin/configuracoes` (ex.: `DefaultPlatformFeeForm`, `BannerIntervalForm`) + `POST /api/admin/settings` grava `AuditLog` com `SETTING_UPDATED`.
- `sendMail({ to, subject, html })` já existe em `lib/email.ts`, genérico — dá pra notificar por e-mail sem infraestrutura nova. WhatsApp real só existirá no sub-projeto 6 (Evolution API) — o campo de telefone é salvo agora, mas o disparo por WhatsApp fica pendente até lá.
- `EditEventForm.tsx` usa `react-hook-form` + `zod`; já tem um campo `organizerContact` (texto livre) que serve de referência de padrão para os campos novos.

## Decisões (confirmadas com o usuário)

1. Sem prazo configurado = comportamento atual (cancelamento livre até o evento começar).
2. Organizador aprova/rejeita solicitações pendentes direto na tabela de inscritos do evento (mesma coluna "Ações" do botão de estorno).

## Arquitetura

### Schema

```prisma
// Event
cancellationDeadline         DateTime?
cancellationRequiresApproval Boolean   @default(false)
cancellationContactPhone     String?
cancellationContactEmail     String?

// Registration
cancellationReason      String?
cancellationRequestedAt DateTime?

// RegistrationStatus (novo valor)
CANCELLATION_REQUESTED
```

Novo `PlatformSetting` (chave `"cancellation_policy_enabled"`, valor `"true"`/`"false"`, **padrão desligado**).

### Rota de cancelamento do atleta (`app/api/registrations/[id]/cancel/route.ts`)

Fluxo revisado, mantendo todas as validações atuais (status `CONFIRMED`, dono da inscrição, evento não iniciado) como primeira camada, inalteradas:

1. Se `cancellation_policy_enabled` estiver desligado no admin → segue exatamente como hoje (cancelamento imediato). **Fim.**
2. Se ligado e o evento tem `cancellationDeadline` definido e já passou → erro "Prazo de cancelamento encerrado", nenhuma mudança no banco.
3. Se ligado e `cancellationRequiresApproval = false` (padrão) → cancelamento imediato, igual hoje.
4. Se ligado e `cancellationRequiresApproval = true` → em vez de cancelar, grava `status = CANCELLATION_REQUESTED`, `cancellationReason` (novo campo obrigatório no corpo da requisição neste caso), `cancellationRequestedAt = now()`. **Não** toca em `Order` nem em `TicketBatch.soldCount` (a vaga continua ocupada até a decisão do organizador). Dispara e-mail (fire-and-forget, mesmo padrão de `notifyOrderConfirmed`) para `event.cancellationContactEmail`, se configurado. Grava `AuditLog` (`REGISTRATION_CANCELLATION_REQUESTED`).

### Nova rota: decisão do organizador

`POST /api/organizer/registrations/[id]/cancellation-decision` — corpo `{ decision: "APPROVE" | "REJECT" }`, autenticado via `auth()` + checagem de papel, escopado ao evento do organizador (mesmo padrão de segurança do sub-projeto 4).

- `APPROVE`: `Registration` e `Order` → `CANCELLED`, decrementa `TicketBatch.soldCount`, `AuditLog` (`REGISTRATION_CANCELLATION_APPROVED`).
- `REJECT`: `Registration` volta para `CONFIRMED` (nada mais muda — a vaga nunca tinha sido liberada), `AuditLog` (`REGISTRATION_CANCELLATION_REJECTED`).

### UI

- **Admin** (`/admin/configuracoes`): novo formulário `CancellationPolicyToggleForm` (mesmo padrão dos outros toggles), liga/desliga `cancellation_policy_enabled`.
- **Organizador** (`EditEventForm.tsx`): nova seção "Política de cancelamento" — só aparece se o admin tiver ligado o interruptor (checado no server component da página de edição). Campos: prazo (datetime), checkbox "Cancelamento requer aprovação", telefone (WhatsApp) e e-mail de contato.
- **Atleta** (`CancelRegistrationButton.tsx`): se o prazo já passou, o botão não aparece. Se `cancellationRequiresApproval`, o fluxo de confirmação ganha um campo de justificativa obrigatório antes de enviar, e a mensagem de sucesso muda para "Solicitação enviada — aguardando aprovação do organizador".
- **Organizador** (tabela de inscritos, sub-projeto 1): novo rótulo "Cancelamento solicitado" no mapa de status; botões "Aprovar"/"Rejeitar" na coluna Ações quando o status for `CANCELLATION_REQUESTED` (ao lado da lógica já existente do botão "Estornar").

## Fora de escopo

- Disparo real de WhatsApp (aguarda sub-projeto 6 — Evolution API). O campo de telefone só fica salvo, pronto para ser usado quando aquele sub-projeto existir.
- Estorno automático ao aprovar cancelamento (o organizador aciona manualmente, sub-projeto 4).
- Configuração de política de cancelamento na tela de criação de evento (`EventForm.tsx`) — só na edição, seguindo o padrão de outros campos de refinamento (banners, regulamento).
- Histórico de múltiplas solicitações por inscrição (uma inscrição só tem uma solicitação ativa por vez, guardada nela mesma).

## Testes

- Testes unitários para a lógica de decisão da rota de cancelamento (helper puro que decide entre "segue igual hoje" / "bloqueia por prazo" / "cancela direto" / "vira solicitação"), cobrindo interruptor desligado, sem prazo, prazo expirado, com/sem aprovação.
- Testes unitários para a rota de decisão do organizador (aprovar/rejeitar), cobrindo a fronteira de segurança (não pode decidir sobre inscrição de outro organizador) e o não-decremento duplo de `soldCount`.
- Verificação manual no navegador cobrindo: interruptor desligado (nada muda), prazo configurado e expirado (botão some), aprovação automática (padrão), fluxo de aprovação manual completo (solicitar → aparecer para o organizador → aprovar/rejeitar).
