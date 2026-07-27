# Refatoração do link de destino dos anúncios — Design

## Contexto e achado principal

Usuário pediu uma refatoração completa da funcionalidade de "link de destino" nos anúncios
(casa e privados): campo configurável, validação, segurança, moderação, comportamento público e
acessibilidade.

**Investigação prévia mudou a premissa**: o campo de link de destino **já existe e já funciona
ponta a ponta** em produção — `AdSlot.houseAdTargetUrl` (anúncio da casa) e `PrivateAd.targetUrl`
(anúncio privado), com formulário, persistência, moderação, renderização com link clicável e
rota de redirect com rastreamento de clique (`/api/ads/click/[privateAdId]`,
`/api/ads/click/house/[slotId]`). Não existe migração de schema nem campo novo a criar — o
trabalho real é **corrigir e endurecer** o que já existe. Achados concretos:

1. **Validação de URL inconsistente em 3 lugares**: `app/api/admin/ads/slots/[id]/house-ad/route.ts`
   e `app/api/admin/ads/slots/[id]/route.ts` checam protocolo http/https manualmente via `new URL()`;
   `app/api/anunciante/ads/route.ts` (criação pelo anunciante) só faz `new URL()` **sem checar
   protocolo** — aceitaria valores com esquemas não intencionais.
2. **Bug real**: `AdSlotRenderer.tsx` (branch `HOUSE`) exige `houseAdImageUrl` **e**
   `houseAdTargetUrl` pra renderizar qualquer coisa — um anúncio da casa sem link simplesmente não
   aparece no site, em vez de aparecer sem ação de clique.
3. **Sem acessibilidade**: o anúncio hoje é só `<a><Image/></a>`, sem texto acessível, sem
   indicação visual de que é publicidade/clicável.
4. **Não existe edição de anúncio privado já criado** — só criar novo (`POST /api/anunciante/ads`)
   ou cancelar (`POST /api/anunciante/ads/[id]/cancel`). A pergunta do briefing sobre remoderar ao
   editar o link só faz sentido se essa capacidade for criada.

## Decisões fechadas com o usuário (depois da investigação)

1. **Criar edição de link** pra anúncio privado próprio (`PENDING_APPROVAL` ou `APPROVED`); se
   estava `APPROVED` e o link mudar, volta pra `PENDING_APPROVAL` automaticamente. Admin também
   pode editar o link durante a revisão (sem re-moderação, já que admin é o moderador).
2. **Corrigir o bug do anúncio da casa sem link** — passa a renderizar a imagem sem ação de
   navegação quando `houseAdTargetUrl` for nulo, em vez de não renderizar nada.
3. **Cliques abrem em nova aba** (`target="_blank" rel="noopener noreferrer"`) — hoje navega na
   mesma aba via redirect 307; muda pro padrão usual de anúncio (visitante não sai do site).

## 1. `lib/validate-url.ts` (novo helper centralizado)

```ts
export interface ValidateAdUrlOptions { allowRelative?: boolean }
export type ValidateAdUrlResult = { ok: true; url: string } | { ok: false; error: string };
export function validateAdDestinationUrl(input: string, options?: ValidateAdUrlOptions): ValidateAdUrlResult
```

Regras (função pura, sem I/O — cobertura total via TDD):
- Trim; rejeita vazio (o campo em si é opcional — quem decide se aceita vazio é o call site, não
  este helper).
- Máximo 500 caracteres (mesmo limite já usado hoje no schema Zod do slot).
- **Absoluta e `https://` obrigatório** pra URLs externas (endurece o que hoje aceita http/https)
  — rejeita qualquer outro protocolo (`http:`, `javascript:`, `data:`, `file:`, `ftp:`, etc.) e
  URLs malformadas (`new URL()` dentro de `try/catch`).
- Rejeita hostname `localhost`, `127.0.0.1`, `::1` e faixas de IP privado literal (`10.x`,
  `172.16-31.x`, `192.168.x`) — checagem de string no host, não resolve DNS (a URL nunca é
  buscada pelo servidor, só usada como destino de redirect — não há necessidade de proteção
  anti-SSRF de resolução de DNS, só higiene contra valor óbvio abusivo).
- `options.allowRelative` (default `false`): quando `true`, também aceita caminho relativo
  começando com `/` (sem protocolo) — usado **só** no fluxo de anúncio da casa (controlado pelo
  admin, ex.: linkar pra `/auth/cadastro-anunciante`), nunca no fluxo de anunciante privado (que
  deve sempre apontar pra fora, pro negócio dele).
- Não normaliza/reescreve a URL além do trim — não monta string por concatenação.

Substitui as 3 implementações manuais hoje espalhadas, aplicado em todos os pontos de escrita
(criação e as 2 rotas de edição novas, ver seção 3).

## 2. Anúncios da casa (`AdSlot`)

- `houseAdTargetUrl` continua opcional no schema (já é). Formulário
  (`components/admin/HouseAdUploadForm.tsx`) deixa de marcar o campo como obrigatório no HTML.
- `app/api/admin/ads/slots/[id]/house-ad/route.ts` e `app/api/admin/ads/slots/[id]/route.ts`
  passam a usar `validateAdDestinationUrl(url, { allowRelative: true })` em vez da checagem manual
  duplicada — só valida quando o campo vem preenchido; vazio/nulo é aceito (link opcional).
- **`AdSlotRenderer.tsx` (branch HOUSE) corrigido**: renderiza a imagem sempre que
  `houseAdImageUrl` existir. Se `houseAdTargetUrl` também existir, envolve num `<a>` (ver seção 4
  pra acessibilidade); se não existir, renderiza a `<Image>` sem `<a>` nenhum ao redor — sem
  âncora vazia, sem `href="#"`.

## 3. Anúncios privados (`PrivateAd`)

### Criação (existente, só corrigida)

`app/api/anunciante/ads/route.ts` passa a usar `validateAdDestinationUrl(url)` (sem
`allowRelative` — sempre absoluta https, é o negócio do anunciante). `targetUrl` continua
obrigatório no schema (`String`, não nullable) — anúncio pago sempre tem destino, isso já é
intencional e correto.

### Edição (nova) — `PATCH /api/anunciante/ads/[id]/route.ts`

- Auth: mesmo padrão de `app/api/anunciante/ads/[id]/cancel/route.ts` — `checkAdvertiserApiPermission()`
  + filtro `where: { id, adPurchase: { advertiserId } }` (nunca busca só por `id`, evita oráculo
  de anúncio de terceiro).
- Só permite editar quando `status` é `PENDING_APPROVAL` ou `APPROVED` — `REJECTED`/`EXPIRED`/
  `CANCELLED` retornam 400 (o fluxo pra esses é criar um anúncio novo).
- Body: `{ targetUrl: string }`, validado com `validateAdDestinationUrl`.
- Transação: atualiza `targetUrl`; se `status` atual é `APPROVED`, muda pra `PENDING_APPROVAL` e
  limpa `rejectionReason` (novo ciclo de revisão do zero); se já é `PENDING_APPROVAL`, só troca a
  URL, sem mexer no status. Grava `AuditLog` (`action: "PRIVATE_AD_LINK_UPDATED"`, metadata com
  URL antiga/nova e se disparou remoderação).
- UI: `app/anunciante/anuncios/page.tsx` ganha botão "Editar link" (novo componente
  `EditPrivateAdLinkButton.tsx`, modal dedicado com campo de URL — não reaproveita `ConfirmModal`
  porque o campo de nota dele não é o formato certo pra uma URL com validação própria; mesmo
  espírito do `PromoteToAdvertiserButton.tsx` já implementado nesta sessão) ao lado de "Cancelar",
  disponível só nos status `PENDING_APPROVAL`/`APPROVED`. Mensagem de confirmação avisa quando a
  edição vai reenviar o anúncio pra moderação.

### Edição pelo admin (nova) — `PATCH /api/admin/ads/private/[id]/route.ts`

- `requireAdmin()` (mesmo guard das páginas de moderação — as rotas de approve/reject hoje fazem
  checagem manual inline; esta rota nova já nasce usando o helper padrão).
- Atualiza só `targetUrl` (mesma validação), **não muda o `status`** — admin é quem modera, não
  precisa remoderar a própria edição.
- UI: `app/admin/anuncios/privados/[id]/page.tsx` ganha um campo editável de URL (mostra o domínio
  extraído em destaque, além do link completo, pra revisão visual rápida — hoje só mostra o link
  cru).

## 4. Renderização pública e acessibilidade (`AdSlotRenderer.tsx`)

Pra PRIVATE (sempre tem link) e HOUSE (link opcional, só quando presente):

```tsx
<a
  href={`/api/ads/click/${ad.id}`}
  target="_blank"
  rel="noopener noreferrer"
  aria-label="Anúncio publicitário — abre em nova aba"
  className="..."
>
  <Image ... />
  <span className="sr-only sm:not-sr-only ...">Publicidade · Saiba mais</span>
</a>
```

- `target="_blank" rel="noopener noreferrer"` nos dois tipos (decisão do usuário).
- `aria-label` no `<a>` — não depende só da imagem pra comunicar a ação (pedido explícito do
  usuário).
- Legenda "Publicidade · Saiba mais" pequena, discreta, abaixo/sobre a imagem — sinaliza
  visualmente que é conteúdo patrocinado e clicável sem depender só da imagem. `sr-only` no mobile
  bem pequeno se não couber, sempre presente pra leitor de tela.
- Foco de teclado: `<a>` nativo já recebe foco/Enter por padrão — só garantir que nenhuma classe
  Tailwind remova o outline (`focus:outline-none` sem substituto não deve ser usado aqui).
- Quando não há link (HOUSE sem `houseAdTargetUrl`): só a `<Image>`, sem `<a>`, sem legenda de
  "Publicidade · Saiba mais" (não é clicável, não faz sentido convidar ação) — pode manter uma
  legenda menor "Publicidade" sozinha se quiser sinalizar que é conteúdo patrocinado mesmo sem
  link (decisão de implementação, não bloqueante).
- Não vira "área inteira clicável" em nenhum outro lugar que tenha controles concorrentes — a
  listagem `app/anunciante/anuncios/page.tsx` (que tem botões Cancelar/Editar link ao lado da
  miniatura) **não** usa `AdSlotRenderer` nem vira link — é só uma prévia de imagem, sem mudança
  necessária ali.

## 5. Validação e segurança — resumo

- Fonte da verdade é sempre o backend (frontend só dá feedback rápido com `type="url"` +
  mensagem de erro vinda da API, mesmo padrão já usado em todo o projeto).
- Nenhum HTML fornecido pelo anunciante é usado em lugar nenhum (já era assim — só `href`/redirect
  `Location`, nunca `dangerouslySetInnerHTML`).
- Rate/tamanho: 500 caracteres (já existia no schema Zod do slot, agora replicado no helper e
  aplicado também na rota de anunciante que não tinha limite nenhum hoje).
- Sem lista de domínios bloqueados hoje no sistema — fora de escopo criar uma do zero (o briefing
  pede integrar "se o sistema possuir"; não possui). Revisão manual pelo admin continua sendo a
  camada de defesa contra links legítimos-mas-indesejados (aprovar/rejeitar já existe).
- Métricas de clique (`recordClick`, já existentes) não mudam — já são agregadas por
  slot/dia/origem, sem dado pessoal na URL, nada a ajustar aqui.

## 6. Testes

TDD nas funções/rotas novas ou alteradas:
- `lib/validate-url.test.ts` — https válido, http rejeitado, `javascript:`/`data:`/`file:`/`ftp:`
  rejeitados, malformada rejeitada, vazio, espaços nas pontas, limite de tamanho, relativo aceito
  só com `allowRelative`, host privado/localhost rejeitado.
- `tests/anunciante-ads-route.test.ts` (existente) — adiciona casos de URL sem protocolo
  https/inválida sendo rejeitada na criação (hoje não tinha esse caso coberto).
- `tests/anunciante-ads-edit-route.test.ts` (novo) — dono edita link com sucesso (PENDING
  continua PENDING; APPROVED vira PENDING_APPROVAL e limpa `rejectionReason`); outro usuário não
  consegue editar anúncio alheio (mesmo 404 genérico do padrão de posse); status
  REJECTED/EXPIRED/CANCELLED rejeitam edição; URL inválida rejeitada; sem sessão/sem papel
  ADVERTISER rejeitado.
- `tests/admin-ads-private-edit-route.test.ts` (novo) — admin edita link sem mudar status; não-admin
  rejeitado; URL inválida rejeitada.
- `tests/admin-ads-house-route.test.ts` / rota do slot (existentes) — URL vazia aceita (campo
  ficou opcional), http rejeitado agora (antes era aceito), relativo aceito.
- `AdSlotRenderer` (Server Component) continua sem teste automatizado dedicado — convenção já
  estabelecida do projeto pra esse tipo de componente; a lógica de decisão (tem link ou não) já
  fica coberta indiretamente pelos testes de validação/dados. Verificação de teclado/leitor de
  tela é manual (mesma limitação já registrada em sessões anteriores — sem acesso a navegador
  neste ambiente).

Rodar suíte completa + `tsc --noEmit` + `npm run build` ao final, mesma convenção do projeto.

## 7. Fora de escopo

- Lista de domínios bloqueados/permitidos (não existe hoje, briefing pede só "se possuir").
- Proteção anti-SSRF via resolução de DNS (a URL nunca é buscada pelo servidor).
- Mudança em métricas/analytics de clique além do que já existe.
- Tornar a área inteira de outras telas (ex.: listagem do anunciante) clicável — só o
  `AdSlotRenderer` público é afetado.
