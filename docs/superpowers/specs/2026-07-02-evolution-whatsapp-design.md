# Design: infraestrutura Evolution API / WhatsApp

Sub-projeto 6a de um conjunto maior de pedidos (o pedido original "sistema de alertas via e-mail e WhatsApp" foi dividido em dois: esta parte cobre só a infraestrutura de conexão; o catálogo de alertas + tela de configuração por alerta fica para o próximo sub-projeto, que consumirá o `sendWhatsAppMessage()` genérico construído aqui).

## Contexto (o que já existe)

- Padrão de credenciais de serviço externo já estabelecido: `PlatformSetting` (chave-valor) + `getSetting`/`upsertSetting` (`lib/settings.ts`) + um módulo de config dedicado (`lib/smtp-settings.ts`, `lib/payment-settings.ts`, `lib/storage-settings.ts`) + formulário admin dedicado + rota `POST /api/admin/settings` genérica (grava `AuditLog` `SETTING_UPDATED`, `revalidatePath`).
- Padrão de "teste de envio": `SmtpSettingsForm.tsx` tem um campo de destino + botão "Enviar teste" que chama uma rota dedicada (`POST /api/admin/smtp/test`) e mostra sucesso/erro inline — mesmo padrão será replicado aqui.
- Página dedicada para funcionalidade rica (não cabe num card): `/admin/backup` é o precedente — página própria com múltiplos botões de ação, downloads, uploads, barra de progresso.
- `AdminNav.tsx` lista os links do menu admin; cada sub-projeto anterior que criou uma página nova adicionou um link ali (ex.: `/admin/backup`).
- Nenhuma infraestrutura de WhatsApp existe hoje no código (`whatsapp` só aparece como texto livre em `EditEventForm.tsx`/`perfil/page.tsx`, não é uma integração).

## Decisões (confirmadas com o usuário)

1. Dividir em dois sub-projetos: este cobre só a infraestrutura Evolution API/WhatsApp; o catálogo de alertas fica para depois.
2. O servidor Evolution API já existe ou será provisionado separadamente — este sub-projeto só implementa o cliente HTTP que se conecta a uma URL + API key configuráveis. Deploy do servidor Evolution API está fora de escopo.
3. Terá um botão "Enviar WhatsApp de teste" (telefone + botão), mesmo padrão do teste de SMTP.
4. A tela de conexão fica em uma página dedicada `/admin/whatsapp` (não um card em `/admin/configuracoes`), pelo mesmo motivo que `/admin/backup` é dedicada: QR code, polling de status e múltiplas ações não cabem bem num card.

## Arquitetura

### Armazenamento de credenciais

Novas chaves em `PlatformSetting` (mesmo padrão do SMTP): `whatsapp_api_url`, `whatsapp_api_key`, `whatsapp_instance_name`. Nenhuma tem valor obrigatório — sem elas configuradas, a página mostra "Não configurado" e os botões de ação ficam desabilitados (mesmo padrão do SMTP).

Novo módulo `lib/whatsapp-settings.ts`, espelhando `lib/smtp-settings.ts`:

```ts
export interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig>;
export function isWhatsAppConfigured(config: WhatsAppConfig): boolean; // apiUrl && apiKey && instanceName
```

### Cliente HTTP da Evolution API

Novo módulo `lib/whatsapp/evolution-client.ts` — funções puras que recebem a config e fazem as chamadas REST (baseado na documentação oficial da Evolution API v2, `doc.evolution-api.com`; o formato exato de cada endpoint será confirmado durante o planejamento/implementação, já que varia um pouco entre versões da Evolution API):

```ts
export async function createInstance(config: WhatsAppConfig): Promise<{ qrCodeBase64: string | null }>;
export async function getQrCode(config: WhatsAppConfig): Promise<{ qrCodeBase64: string | null }>;
export async function getConnectionState(config: WhatsAppConfig): Promise<"open" | "connecting" | "close" | "not_found">;
export async function logoutInstance(config: WhatsAppConfig): Promise<void>;
export async function deleteInstance(config: WhatsAppConfig): Promise<void>;
export async function sendTextMessage(config: WhatsAppConfig, phone: string, text: string): Promise<void>;
```

Todas autenticam via header `apikey` (padrão Evolution API). `createInstance` cria a instância na Evolution API com o `instanceName` configurado; se a instância já existir, a Evolution API tipicamente retorna erro ou os dados existentes — o cliente trata os dois casos sem quebrar (idempotente do ponto de vista do usuário: "Gerar QR Code" sempre funciona, existindo ou não a instância).

### Função genérica de envio (para o próximo sub-projeto)

`lib/whatsapp.ts` (nome espelhando `lib/email.ts`):

```ts
export async function sendWhatsAppMessage(phone: string, text: string): Promise<void>;
```

Lê a config via `getWhatsAppConfig()`, valida com `isWhatsAppConfigured`, lança erro descritivo se não configurado (mesmo padrão de `sendMail()` lançando se SMTP não configurado). Isso é o ponto de extensão que o catálogo de alertas vai chamar depois — não é consumido por nada neste sub-projeto além do botão de teste.

### Rotas da API

- `POST /api/admin/whatsapp/instance` — cria a instância e retorna o QR code (chama `createInstance`, cria a instância no Evolution API se não existir, sempre retorna o QR atual).
- `GET /api/admin/whatsapp/status` — retorna o estado atual da conexão (chama `getConnectionState`).
- `POST /api/admin/whatsapp/disconnect` — chama `logoutInstance`.
- `POST /api/admin/whatsapp/delete` — chama `deleteInstance`.
- `POST /api/admin/whatsapp/test` — recebe `{ phone: string }`, chama `sendWhatsAppMessage`, mesmo padrão de `/api/admin/smtp/test`.

Todas exigem `session.user.role === "ADMIN"` (mesmo padrão de todas as rotas admin existentes) e não escrevem `AuditLog` para as ações de status/QR (são apenas leitura/conexão), mas a criação e exclusão de instância gravam `AuditLog` (`WHATSAPP_INSTANCE_CREATED`, `WHATSAPP_INSTANCE_DELETED`), seguindo o padrão de auditoria já usado em outras ações administrativas sensíveis.

O salvamento das credenciais (URL/API key/nome da instância) continua usando a rota genérica já existente `POST /api/admin/settings` — nenhuma rota nova é necessária para isso.

### UI

**Nova página `/admin/whatsapp`** (Server Component + componentes client):
- Card de credenciais: URL, API key (campo senha, mesmo padrão do SMTP), nome da instância — formulário salvando via `/api/admin/settings`, mesmo padrão visual de `SmtpSettingsForm`.
- Card de conexão: mostra status atual (badge "Desconectado"/"Conectando"/"Conectado", buscado ao carregar a página), imagem do QR code (quando disponível), botões "Gerar QR Code" / "Atualizar status" / "Desconectar" / "Excluir instância". Sem configuração salva, os botões ficam desabilitados com uma mensagem "Configure e salve as credenciais primeiro".
- Card de teste de envio: campo de telefone + botão "Enviar WhatsApp de teste", mesmo padrão do teste de SMTP.

**`components/admin/AdminNav.tsx`**: adicionar `<Link href="/admin/whatsapp">WhatsApp</Link>` à lista de links (edição aditiva de uma linha, mesmo padrão usado por todo sub-projeto anterior que criou uma página admin nova).

## Tratamento de erro

- Qualquer falha de rede/HTTP ao chamar a Evolution API (servidor fora do ar, URL errada, API key inválida) é capturada e retorna uma mensagem de erro amigável na UI — nunca quebra a página.
- `getConnectionState` retornando "not_found" (instância não existe ainda na Evolution API) é tratado como estado normal "Desconectado", não como erro.
- O botão de teste de envio só fica habilitado quando a conexão está "Conectada" (senão a Evolution API rejeitaria o envio de qualquer forma).

## Fora de escopo

- Deploy do servidor Evolution API em si.
- Disparo real de alertas do catálogo (WhatsApp de "vaga esgotando", "carrinho abandonado", etc.) — próximo sub-projeto.
- Webhooks de status em tempo real da Evolution API (atualização de status é só por polling manual/refresh de página nesta primeira versão).
- Múltiplas instâncias/números de WhatsApp — só uma instância global para a plataforma toda.

## Testes

- Testes unitários para `lib/whatsapp/evolution-client.ts` (mock de `fetch`, cobrindo sucesso e falha de cada função) e para `lib/whatsapp-settings.ts` (`isWhatsAppConfigured` com combinações de campos vazios/preenchidos).
- Testes unitários para `lib/whatsapp.ts` (`sendWhatsAppMessage` lançando quando não configurado, chamando o cliente quando configurado).
- Testes de rota para as 5 rotas novas (auth check ADMIN, delegação correta para o cliente/config, tratamento de erro do cliente).
- Sem testes de UI (convenção já estabelecida no projeto — nenhum componente React tem teste hoje).
- Verificação manual na VPS de teste: com uma instância Evolution API real (ou, se indisponível, confirmando que os erros de conexão são tratados graciosamente), percorrer o fluxo completo — salvar credenciais → gerar QR code → escanear e confirmar "Conectado" → enviar teste → desconectar → excluir instância.
