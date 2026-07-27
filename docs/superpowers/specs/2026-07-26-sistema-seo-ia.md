# Sistema de SEO + geração de metadados por IA — Design

## Contexto e objetivo

Hoje a plataforma não tem nenhuma estrutura de SEO além de um `generateMetadata` básico (título
estático) em `app/layout.tsx` e um OG/Twitter Card já implementado (por acaso, não por sistema) em
`app/(public)/eventos/[slug]/page.tsx`. Não existe `sitemap.xml`, `robots.txt`, dados estruturados
(JSON-LD), URLs canônicas, nem nenhum campo administrável de SEO.

Usuário pediu, em 2026-07-26: (1) um sistema de SEO completo pras páginas públicas, seguindo boas
práticas pro nicho (plataforma de inscrição em corridas de rua/eventos esportivos), com uma aba
nova em Admin pros campos globais administráveis; (2) em paralelo, um botão "Gerar com IA" em cada
campo de texto de SEO (site inteiro e por evento), que usa os dados já preenchidos do evento + o
objetivo geral do site pra gerar título/descrição otimizados, com suporte a 3 provedores de IA
(Claude, Google, OpenAI) configuráveis via chave de API no Admin.

## Decisões já fechadas com o usuário

- Campos de SEO editáveis: **globais** (Admin) + **por evento** (organizador).
- Campos por evento ficam na tela de editar evento do organizador (`/organizador/eventos/[id]/editar`)
  — mesmo acesso que o admin já tem a essa tela hoje.
- A aba de Admin também inclui verificação do Google Search Console e Google Analytics (1 campo de
  texto cada, mesmo padrão do campo do AdSense).
- Botão "Gerar com IA" liberado pra todo organizador sem limite de uso nesta primeira leva (pode
  ganhar limite depois se houver abuso). Usa a chave de API configurada pela plataforma — custo é
  do site, não do organizador.
- Só 1 provedor de IA ativo por vez, escolhido num seletor (mesmo padrão do gateway de pagamento
  Mercado Pago/Pagar.me) — não é escolhido a cada clique.

## Arquitetura geral

Duas frentes independentes que se conectam só na UI (o botão de IA preenche os mesmos campos que o
SEO técnico consome):

1. **SEO técnico** — convenções nativas do Next.js (`app/sitemap.ts`, `app/robots.ts`,
   `generateMetadata`) + um componente pra injetar JSON-LD. Não precisa de nenhuma biblioteca nova.
2. **Geração por IA** — abstração de provedor de IA (`lib/ai/`), espelhando exatamente o padrão já
   usado em `lib/payment/` (interface comum + 1 implementação por provedor + função que lê a
   configuração ativa e instancia a certa).

## 1. Modelo de dados

### `Event` — 2 campos novos (migração de schema)

```prisma
metaTitle       String? @db.VarChar(70)
metaDescription String? @db.VarChar(160)
```

Opcionais. Quando vazios, o título/descrição da página do evento continuam sendo derivados
automaticamente dos dados do evento (`event.title`, primeiros 160 caracteres de
`event.description`) — comportamento idêntico ao que `generateMetadata` já faz hoje em
`app/(public)/eventos/[slug]/page.tsx:20-45`, só passa a checar o override primeiro.

### `PlatformSetting` — chaves novas (sem migração, mesmo padrão `getSetting`/`upsertSetting`)

SEO do site:
- `seo_default_title`, `seo_default_description`, `seo_default_og_image`
- `seo_brand_context` — texto livre com o posicionamento/objetivo geral do site (ex.: "plataforma
  de inscrições para corridas de rua, trail run e eventos esportivos"), usado tanto como contexto
  de fallback quanto injetado em todo prompt de IA pra manter o tom consistente entre site e
  eventos.

Indexação/mensuração:
- `seo_google_site_verification` (conteúdo da meta tag de verificação do Search Console)
- `seo_google_analytics_id` (Measurement ID do GA4, formato `G-XXXXXXX`)

IA:
- `ai_provider` — `"CLAUDE" | "OPENAI" | "GOOGLE"`
- `ai_claude_api_key`, `ai_openai_api_key`, `ai_google_api_key`

Todas seguem o mesmo modelo de segurança já usado pras chaves de gateway de pagamento
(`mp_access_token`, `pagarme_api_key`, etc.): armazenadas em texto plano na tabela
`platform_settings`, acesso restrito por RBAC de admin — não introduz um novo padrão de
criptografia, é consistente com o que já existe no projeto.

## 2. SEO técnico

### `app/sitemap.ts` (novo)

Retorna: home (`/`), `/eventos`, cada evento com `status` fora de `DRAFT`/`CANCELLED`
(`/eventos/[slug]`), `/termos`, `/privacidade`. `lastModified` = `event.updatedAt` pros eventos,
`new Date()` fixo pras páginas estáticas. Usa `NEXT_PUBLIC_APP_URL` como base (mesma env var já
usada em `lib/email.ts` e outros pontos do projeto).

### `app/robots.ts` (novo)

Libera geral (`/`), bloqueia `/admin`, `/organizador`, `/anunciante`, `/dashboard`, `/api`,
`/auth`, `/completar-cadastro`. Aponta `sitemap: <base>/sitemap.xml`.

### Metadados por página

- `app/(public)/page.tsx` (home) — ganha `generateMetadata` lendo `seo_default_title`/
  `seo_default_description` (com fallback pro texto atual se as settings estiverem vazias).
- `app/(public)/eventos/page.tsx` — troca `{ title: "Eventos" }` por metadata otimizada
  (título+descrição fixos, ricos em palavras-chave do nicho).
- `app/(public)/eventos/[slug]/page.tsx` — `generateMetadata` (linhas 20-45) passa a checar
  `event.metaTitle`/`event.metaDescription` antes de cair no fallback atual (título puro do
  evento / primeiros 160 caracteres da descrição). OG/Twitter já implementados continuam do jeito
  que estão, só passam a usar o texto resolvido (override ou fallback).
- `alternates.canonical` adicionado nas páginas acima, apontando pra URL sem query params (evita
  conteúdo duplicado nas variações de filtro de `/eventos`).

### JSON-LD (dados estruturados)

Novo componente de servidor `components/seo/JsonLd.tsx` (recebe um objeto e renderiza
`<script type="application/ld+json">` com `JSON.stringify`, escapando `</script>` no meio da
string por segurança).

- **`SportsEvent`** em `app/(public)/eventos/[slug]/page.tsx`: `name`, `startDate`, `location`
  (`address` + `geo` a partir de `event.latitude`/`longitude`, já existentes no schema), `image`,
  `description`, `organizer`, `offers` (menor preço ativo entre os `TicketBatch` do evento, com
  `availability` baseado em `capacity` vs. vendidos). Montado por uma função pura testável
  (`lib/seo/build-event-json-ld.ts`), não direto na página.
- **`Organization`** na home: nome do site, logo (se houver), `url`.
- **`BreadcrumbList`** na página de evento: Home → Eventos → título do evento.

### `verification`/Analytics no layout raiz

`app/layout.tsx` ganha `verification: { google: seoGoogleSiteVerification }` no objeto retornado
por `generateMetadata` (API nativa do Next, não precisa do hack de `<script>` manual usado pro
AdSense — verificação de meta tag simples é respeitada normalmente pelo crawler do Google mesmo
via hidratação). O GA4 usa `next/script` com `strategy="afterInteractive"` (não tem o mesmo
requisito de aparecer no HTML inicial que o AdSense tinha).

## 3. Aba "SEO" no Admin

Rota nova `app/admin/seo/page.tsx` + link "SEO" no `AdminNav.tsx` (depois de "Anúncios", antes de
"Config."). Duas seções, 2 componentes client novos:

- **`SeoSettingsForm.tsx`** — título/descrição/imagem padrão, contexto de marca, verificação
  Search Console, ID do Analytics. Botão "Gerar com IA" ao lado de título e descrição (contexto de
  marca é escrito manualmente, não faz sentido a IA gerar o próprio contexto que ela vai usar).
  Salva via `POST /api/admin/settings` (rota genérica já existente, sem mudança nela).
- **`AiProviderSettingsForm.tsx`** — seletor de provedor ativo + 3 campos de chave de API,
  mascarados (mesmo padrão de `PaymentGatewayForm.tsx`: a página passa só um booleano
  "configurada", nunca o valor real; campo vazio no submit = mantém o valor salvo). Salva também
  via `POST /api/admin/settings`.

## 4. Campos por evento

`app/organizador/eventos/[id]/editar/page.tsx` (e o form client correspondente) ganham 2 campos
novos — `metaTitle`, `metaDescription` — cada um com botão "Gerar com IA" ao lado. A rota
`PATCH /api/events/[id]/route.ts` (schema em `updateEventSchema`, linha 7-9) ganha os 2 campos
como opcionais.

## 5. Geração por IA

### Abstração de provedor (`lib/ai/`)

Espelha `lib/payment/` exatamente:

- `lib/ai/types.ts` — `interface AiTextProvider { generateText(prompt: string): Promise<string> }`.
- `lib/ai/claude.ts`, `lib/ai/openai.ts`, `lib/ai/google.ts` — 1 implementação por provedor,
  chamando a API oficial de cada um (Claude Messages API, OpenAI Chat Completions, Gemini
  generateContent) com a chave lida de `ai_<provider>_api_key`.
- `lib/ai/index.ts` — `getAiProvider()` lê `ai_provider` via `getSetting` e instancia a
  implementação certa (mesmo formato de `lib/payment/index.ts::getPaymentProvider`).
- `lib/ai-settings.ts` — `getAiProviderSetting()`, mesmo formato de `lib/payment-settings.ts`.

### Construção do prompt (`lib/seo/build-seo-prompt.ts`)

Função pura, testável sem mock de rede. Recebe o tipo de campo (`"metaTitle" | "metaDescription"`)
e o contexto:
- **Por evento**: `event.title`, `event.description`, `event.modality`, `event.city`/`state`,
  `event.startAt`, faixa de preço dos lotes ativos + `seo_brand_context` do site.
- **Do site**: nome do app (`getAppName()`) + `seo_brand_context`.

Regras injetadas no prompt: português do Brasil, título ≤60 caracteres, descrição ≤155
caracteres, incluir palavras-chave relevantes do nicho (corrida de rua, trail run, inscrição,
cidade/UF quando aplicável), tom convidativo. A resposta do provedor é truncada no limite do
campo como salvaguarda (`VarChar(70)`/`VarChar(160)`), mesmo que o modelo não obedeça à instrução
à risca.

### Rotas

- `POST /api/organizador/eventos/[id]/seo/generate` — body `{ field: "metaTitle" | "metaDescription" }`,
  exige dono do evento (mesmo guard já usado nas outras rotas de edição de evento do organizador).
  Retorna `{ text: string }` — **não salva**, só devolve o texto gerado pro campo ser preenchido
  no formulário (usuário ainda revisa e clica em Salvar do jeito normal).
- `POST /api/admin/seo/generate` — body `{ field: "siteTitle" | "siteDescription" }`, admin-only.
  Mesmo contrato de retorno.

Ambas retornam erro claro (400/502) se nenhum provedor de IA estiver configurado ou a chamada
externa falhar — sem fallback silencioso, o organizador precisa saber que a geração falhou pra
preencher manualmente.

## 6. Testes

TDD em toda função de `lib/` e rota nova, seguindo a convenção do projeto:
- `lib/seo/build-event-json-ld.ts`, `lib/seo/build-seo-prompt.ts` — funções puras, cobertura
  completa sem mock de rede.
- `lib/ai/claude.ts`/`openai.ts`/`google.ts` — mock da chamada HTTP de cada SDK/fetch (mesmo
  padrão de `tests/payment-mercadopago-refund.test.ts`).
- As 2 rotas novas de geração (`tests/organizer-event-seo-generate-route.test.ts`,
  `tests/admin-seo-generate-route.test.ts`) — mockando `lib/ai`.
- `app/sitemap.ts`/`app/robots.ts` — teste unitário direto (funções puras que retornam array/objeto).
- Componentes React (formulários, botão "Gerar com IA") sem teste automatizado — convenção já
  estabelecida no projeto pra Client Components deste tipo.

## 7. Fora de escopo

- Limite de uso do botão "Gerar com IA" por evento/organizador (decisão do usuário: começar sem
  limite).
- Histórico de gerações além do `AuditLog` padrão já usado em todo o projeto.
- Geração de imagem (OG image continua sendo a imagem do próprio evento).
- Escolher o provedor de IA a cada clique (decisão do usuário: 1 provedor ativo por vez).
- Regeneração automática/agendada de metadados.
- Tradução/hreflang (site é só português).
