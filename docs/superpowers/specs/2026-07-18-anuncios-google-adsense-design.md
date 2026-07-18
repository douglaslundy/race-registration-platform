# Anúncios — posições no site + Google AdSense

## Contexto

Terceiro de 4 sub-projetos independentes pedidos pelo usuário nesta sessão (ordem: filtros de
eventos ✅ deployado → caixa de entrada de mensagens ✅ implementado (deploy pendente) →
**anúncios — posições e Google AdSense** → anúncios — marketplace de anunciantes privados
(depende deste)).

Hoje não existe nenhuma infraestrutura de anúncios no sistema — é greenfield. O objetivo deste
sub-projeto é: (1) permitir que o admin do SaaS defina e ative posições de anúncio em pontos
específicos do site público, (2) exibir anúncios reais do Google AdSense nessas posições, e (3)
registrar/exibir métricas (impressões, cliques, receita estimada) puxadas da API de relatórios do
AdSense. Anúncios de empresas privadas nesses mesmos espaços — auto-cadastro, planos, upload de
arte, relatório em PDF, envio por e-mail/WhatsApp — ficam para o sub-projeto 4, que reaproveita a
infraestrutura de posições construída aqui.

## Decisões confirmadas com o usuário

- **Produto Google**: Google AdSense (não Google Ad Manager) — é o padrão de mercado pra sites do
  porte deste, sem exigir aprovação/config avançada de editora grande.
- **Meta/Facebook/Instagram descartado**: o Meta Audience Network (única forma de um site externo
  exibir anúncios do Facebook/Instagram) está sendo descontinuado pra novos editores — não é uma
  opção viável hoje. O sistema de posições é desenhado de forma agnóstica a rede, então outra rede
  poderia entrar no futuro sem redesenho, mas não faz parte deste sub-projeto.
- **Sem conta AdSense aprovada ainda**: a infraestrutura completa é construída agora (posições,
  exibição, fluxo OAuth de conexão, sincronização de métricas), mas os números reais só aparecem
  depois que uma conta AdSense aprovada for conectada — mesmo padrão usado com o WhatsApp nesta
  sessão (infraestrutura pronta, ativação real depende de uma conta externa aprovada que ainda não
  existe).
- **5 posições iniciais**, definidas a partir do layout real das páginas públicas (não supostas):

| `key` | Onde | Dimensão |
|---|---|---|
| `EVENTOS_ABAIXO_BANNER` | `/eventos`, logo abaixo do `EventsBanner`, acima do título | 728×90 |
| `EVENTOS_COLUNA_ESQUERDA` | `/eventos`, dentro do `<aside>` de filtros, abaixo dele | 300×250 |
| `EVENTOS_ENTRE_RESULTADOS` | `/eventos`, entre o grid de eventos e a paginação | 728×90 |
| `EVENTO_DETALHE_ABAIXO_BANNER` | `/eventos/[slug]`, abaixo do banner hero, acima do grid de conteúdo | 728×90 |
| `EVENTO_DETALHE_COLUNA_DIREITA` | `/eventos/[slug]`, `<aside>` direita, abaixo do card de inscrição (que é `sticky`) | 300×250 |

Todas nascem com `enabled: false` — admin ativa uma a uma depois de configurar.

## 1. Modelo de dados

### `AdSlot`

```prisma
model AdSlot {
  id             String   @id @default(cuid())
  key            String   @unique
  label          String
  width          Int
  height         Int
  enabled        Boolean  @default(false)
  source         String?  // "GOOGLE" | "PRIVATE" | null
  googleAdUnitId String?  // "data-ad-slot" copiado do painel do AdSense
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  metrics AdMetricsSnapshot[]
}
```

`source: "PRIVATE"` já entra no enum informal do campo agora (só como valor de string aceito),
mesmo sem nenhum código que o produza ainda — evita uma segunda migração no sub-projeto 4 só pra
adicionar esse valor. As 5 linhas de `AdSlot` (uma por posição da tabela acima) são inseridas via
seed/migração de dados na própria migração desta feature, não cadastradas manualmente pelo admin
(as posições são fixas no código, ligadas aos 5 pontos reais da UI — o admin só liga/desliga e
configura a fonte, não cria posições novas).

### `AdMetricsSnapshot`

```prisma
model AdMetricsSnapshot {
  id                     String   @id @default(cuid())
  adSlotId               String
  date                   DateTime // granularidade diária, sem componente de hora
  impressions            Int
  clicks                 Int
  estimatedRevenueMicros BigInt   // AdSense retorna em micros: 1_000_000 = 1 unidade monetária
  currency               String
  createdAt              DateTime @default(now())

  adSlot AdSlot @relation(fields: [adSlotId], references: [id])

  @@unique([adSlotId, date])
}
```

### Conexão com a conta Google AdSense

Reaproveita o padrão de `smtp-settings.ts`/`whatsapp-settings.ts` — chaves em `PlatformSetting`,
sem tabela nova:

- `google_adsense_client_id` — o "pub-XXXXXXXXXXXXXXXX", usado só pra exibir os anúncios (não
  exige OAuth, é um dado público do editor).
- `google_adsense_access_token`, `google_adsense_refresh_token`,
  `google_adsense_token_expires_at` — usados só pra puxar métricas via API (exigem OAuth).
- `google_adsense_publisher_id` — devolvido pela API após conectar, exibido no painel de status.

## 2. UI do admin

- **`/admin/anuncios`** — lista as 5 posições fixas (nome, dimensão, liga/desliga, fonte
  selecionada). Editar uma abre um formulário: toggle `enabled`, select de fonte
  ("Google" / "Nenhuma" — "Privada" existe na option list mas desabilitada/cinza até o
  sub-projeto 4 existir), campo `googleAdUnitId` (só aparece quando fonte = Google).
- **`/admin/anuncios/conectar-google`** — card de status ("Conectado"/"Não conectado"), botão
  "Conectar conta Google AdSense" (inicia o OAuth), e, uma vez conectado, mostra o `publisherId` e
  um botão "Desconectar". Mesmo padrão visual de `WhatsAppConnectionPanel.tsx` (status + ação,
  sem nada além disso).
- **`/admin/anuncios/metricas`** (ou uma aba dentro de `/admin/anuncios`) — tabela por posição com
  impressões/cliques/receita estimada somados num intervalo de datas (mesmo padrão de filtro de
  data das outras telas do sistema). Antes de conectar a conta, mostra "Conecte sua conta Google
  AdSense pra ver métricas" em vez de zeros que pareceriam dados reais.

## 3. Exibição no site — `<AdSlotRenderer position="..." />`

Componente inserido nos 5 pontos já mapeados na tabela da seção de decisões. Comportamento:

- Busca a config da posição (via uma função tipo `getAdSlot(key)`, cacheável); se
  `enabled=false` ou `source` não configurado, renderiza `null` — não ocupa espaço, não carrega
  nada de terceiro.
- Se `source="GOOGLE"` e `googleAdUnitId` preenchido: renderiza o container do AdSense (`<ins
  class="adsbygoogle" style="display:inline-block;width:{width}px;height:{height}px"
  data-ad-client="{client_id}" data-ad-slot="{googleAdUnitId}">`) seguido do script de
  inicialização (`(adsbygoogle = window.adsbygoogle || []).push({})`).

**Exceção arquitetural explícita**: ao contrário do resto do sistema (100% server-rendered, sem
JavaScript de terceiro), o AdSense exige um script client-side de verdade — é a Google quem decide
o que aparece, roda no navegador do visitante, e não existe alternativa server-side. O script
principal (`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client={client_id}`) é
carregado uma vez no layout público (`app/(public)/layout.tsx`), só quando existe pelo menos uma
posição ativa com fonte Google — cada `<AdSlotRenderer>` só dispara sua própria inicialização.
Essa é uma exceção justificada pela natureza do próprio AdSense, não uma escolha de arquitetura
livre — mas é a primeira vez que o site carrega JS de terceiro, então fica registrado aqui
explicitamente.

## 4. OAuth com o Google + sincronização de métricas

### Pré-requisito externo (ação manual do usuário, fora deste código)

Criar um projeto no Google Cloud Console, ativar a "AdSense Management API", configurar a tela de
consentimento OAuth, e gerar um Client ID/Secret. Documentado passo a passo separadamente (não faz
parte da implementação — é configuração no painel da Google, mesmo status de pré-requisito que o
Mercado Pago/SMTP já têm). Duas env vars novas: `GOOGLE_ADS_OAUTH_CLIENT_ID`,
`GOOGLE_ADS_OAUTH_CLIENT_SECRET`.

### Fluxo de conexão

1. Admin clica "Conectar" em `/admin/anuncios/conectar-google` → redireciona pro Google pedindo o
   escopo `https://www.googleapis.com/auth/adsense.readonly`.
2. Google redireciona de volta pra `GET /api/admin/ads/google/callback` com um código de
   autorização.
3. Trocamos o código pelos tokens (access + refresh) via `POST
   https://oauth2.googleapis.com/token` e salvamos nas chaves do `PlatformSetting` da seção 1.
4. Buscamos o `publisherId` (conta AdSense) via `GET
   https://adsense.googleapis.com/v2/accounts` e salvamos junto.

### Sincronização — `POST /api/cron/ad-metrics-sync`

Mesmo padrão dos crons existentes (`x-cron-secret` header comparado a `CRON_SECRET`):

- Pra cada `AdSlot` com `source="GOOGLE"` e `googleAdUnitId` preenchido, chama o endpoint de
  relatórios da AdSense API (`accounts.reports.generate`) pedindo impressões/cliques/receita
  estimada do dia anterior, filtrado por aquele ad unit.
- Faz upsert em `AdMetricsSnapshot` (`@@unique([adSlotId, date])` evita duplicar em reruns).
- Se o `access_token` expirou, renova via `refresh_token` antes de tentar. Se o refresh também
  falhar (ex.: acesso revogado no painel da Google), marca a conexão como desconectada
  (`google_adsense_access_token` limpo) e loga o erro, sem quebrar o cron inteiro pras outras
  posições — mesmo espírito best-effort do webhook do WhatsApp.

## Casos de borda

- Posição ativada com fonte Google mas sem `googleAdUnitId` preenchido: `<AdSlotRenderer>` não
  renderiza nada (trata como não configurado, não tenta um `data-ad-slot` vazio).
- Conexão OAuth nunca feita: painel de métricas mostra estado vazio explícito, nunca zeros.
- Token expira sem refresh disponível (usuário revogou acesso): cron marca desconectado
  automaticamente; anúncios continuam sendo exibidos normalmente (a exibição não depende de OAuth,
  só as métricas dependem).
- Ad blocker no navegador do visitante: fora de escopo detectar ou mostrar mensagem alternativa —
  o `<ins>` simplesmente não carrega, sem erro visível pro usuário.

## Fora de escopo (explicitamente)

- Anúncios de empresas privadas nesses mesmos slots — sub-projeto 4.
- Meta/Facebook/Instagram Audience Network.
- Rotação/A-B entre múltiplos anúncios na mesma posição.
- Detecção de ad-blocker / mensagem alternativa quando bloqueado.
- Criação automática de ad units no painel da Google — o admin cria lá manualmente e cola o ID
  aqui; a API é usada só pra leitura de relatórios (`adsense.readonly`), nunca pra escrita.
- Adicionar/remover posições pela UI — as 5 posições são fixas no código nesta primeira versão
  (ligadas aos 5 pontos reais já existentes na UI); uma 6ª posição exigiria inserir o
  `<AdSlotRenderer>` em algum ponto novo do código de qualquer forma, então cadastro dinâmico de
  posição não traria ganho real agora.
