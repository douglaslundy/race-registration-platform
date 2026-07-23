# Anúncio da casa (admin) — design

## Contexto

Hoje, cada posição de anúncio (`AdSlot`) tem uma fonte (`source`): `"GOOGLE"` (AdSense) ou
`"PRIVATE"` (marketplace de anunciantes — o admin só aprova/rejeita o que anunciantes enviam em
`/anunciante/anuncios/novo`, nunca cadastra conteúdo diretamente). Usuário perguntou se o admin
consegue cadastrar um anúncio ele mesmo, direto na plataforma, sem depender de um anunciante
pagante — resposta era não. Este spec adiciona essa capacidade: um "anúncio da casa", cadastrado
e ativado pelo próprio admin, pra preencher uma posição sem anunciante.

## Escopo

Caso de uso confirmado com o usuário: anúncio próprio da plataforma numa posição vaga (não é "em
nome de um anunciante que já comprou um plano" — esse caso já existe via o fluxo normal do
anunciante). Ativação: imediata, sem passo de aprovação (é o próprio admin, sem moderação de
terceiro).

## Decisão de arquitetura

Duas abordagens foram consideradas:

- **(A, escolhida) Campos isolados no `AdSlot` + fonte nova `"HOUSE"`.** Zero mudança em
  `PrivateAd`/`AdPurchase`/`AdvertiserProfile` — nenhum risco pro marketplace de anunciantes já em
  produção.
- **(B, rejeitada) Reaproveitar `PrivateAd` com `adPurchaseId` opcional**, já `APPROVED`, sem
  compra vinculada. Reaproveitaria a renderização/clique existentes, mas exigiria tornar
  `adPurchaseId` opcional — e essa relação é assumida como sempre presente em vários pontos
  (moderação mostra `adPurchase.advertiser.companyName`, cancelamento libera vaga da compra,
  relatório em PDF, cron de expiração). Mudar isso replicaria o mesmo tipo de efeito cascata já
  visto neste projeto quando `Payment.orderId` foi tornado opcional (quebrou 13 arquivos
  pré-existentes). Descartada por risco desproporcional ao ganho.

## Modelo de dados

`prisma/schema.prisma`, `model AdSlot`: dois campos novos, nullable (sem mudar `source`, que
continua `String?` livre, sem enum):

```prisma
model AdSlot {
  ...
  source           String?
  googleAdUnitId   String?
  houseAdImageUrl  String?
  houseAdTargetUrl String?
  ...
}
```

Migração documentada em `prisma/migrations/` (deploy usa `prisma db push --skip-generate`, mesmo
padrão de todas as migrações anteriores do projeto).

`lib/ad-slots.ts`: `AdSlotRow` e `UpdateAdSlotData` ganham os 2 campos novos (`houseAdImageUrl?:
string | null`, `houseAdTargetUrl?: string | null`).

## Fluxo do admin

`components/admin/AdSlotEditForm.tsx`: o `<select>` de fonte ganha uma 3ª opção:

```tsx
<option value="HOUSE">Anúncio da casa (admin)</option>
```

Quando `source === "HOUSE"` **e o slot já foi salvo com essa fonte** (mesmo padrão condicional já
usado hoje pro campo de Google Ad Unit ID), a página (`app/admin/anuncios/page.tsx`) renderiza um
novo componente `components/admin/HouseAdUploadForm.tsx` abaixo do `AdSlotEditForm`, para aquele
slot. Esse componente é um formulário simples (mesmo padrão visual de
`components/advertiser/PrivateAdForm.tsx`, mas sem os campos de percurso/categoria/plano — só
imagem + URL de destino):

- Input de arquivo (imagem) + campo de texto para a URL de destino.
- Preenche com os valores atuais (`houseAdImageUrl`/`houseAdTargetUrl`) se já existirem, permitindo
  ver/trocar a arte atual.
- Botão "Salvar" envia `multipart/form-data` para o novo endpoint (ver abaixo). Sucesso atualiza o
  preview na tela; erro mostra a mensagem retornada pela API (sem `alert()`/`confirm()` — regra
  permanente do projeto, `CLAUDE.md`).

Reenviar uma imagem/URL nova **substitui** a anterior — sem histórico de versões, sem
confirmação extra (o usuário confirmou: ativação imediata, sem passo de revisão).

`app/api/admin/ads/slots/[id]/route.ts` (PATCH existente, JSON): o Zod schema passa a aceitar
`source: z.enum(["GOOGLE", "PRIVATE", "HOUSE"])`. Quando `source` for salvo como algo diferente de
`"HOUSE"`, `houseAdImageUrl`/`houseAdTargetUrl` são zerados — mesmo padrão já existente pra
`googleAdUnitId` quando a fonte deixa de ser `"GOOGLE"`.

## Novo endpoint: upload do anúncio da casa

`POST /api/admin/ads/slots/[id]/house-ad` (novo arquivo, `route.ts` na mesma pasta do PATCH
existente):

1. Autenticação: `session.user.role === "ADMIN"` (403 caso contrário — mesmo guard do PATCH
   irmão).
2. Body `multipart/form-data`: `image` (File) + `targetUrl` (string). Ambos obrigatórios (400 se
   faltar).
3. `targetUrl` validado com `new URL(...)` (400 se inválida) — mesmo padrão de
   `app/api/anunciante/ads/route.ts`.
4. Slot buscado por `id` (404 se não existir).
5. Tamanho/tipo de arquivo validados (mesmos limites do upload do anunciante: 10 MB, apenas
   jpeg/png/webp/gif).
6. Dimensão da imagem validada contra `slot.width`/`slot.height` via `validateImageDimensions`
   (já exportada de `lib/ads/private-ads.ts`, reaproveitada tal como está — nenhuma mudança nessa
   função). Validado **antes** do upload, pra não deixar arquivo órfão no storage se falhar (mesmo
   cuidado já usado no fluxo do anunciante).
7. Upload pro Supabase Storage (mesmo helper/padrão do fluxo do anunciante, prefixo
   `house-ads/<uuid>.<ext>` em vez de `private-ads/...`).
8. `db.adSlot.update({ where: { id }, data: { houseAdImageUrl: imageUrl, houseAdTargetUrl:
   targetUrl, source: "HOUSE" } })` — o endpoint também garante `source: "HOUSE"` (defesa contra
   o admin ter esquecido de salvar a fonte antes; idempotente se já estiver).

Resposta: `{ houseAdImageUrl, houseAdTargetUrl }` (200).

## Renderização pública e rastreio

`components/ads/AdSlotRenderer.tsx` ganha um branch novo, no mesmo formato do branch `PRIVATE`
existente:

```tsx
if (slot.source === "HOUSE") {
  if (!slot.houseAdImageUrl || !slot.houseAdTargetUrl) return null;
  await recordImpression(slot.id);
  return (
    <a href={`/api/ads/click/house/${slot.id}`} style={{ display: "inline-block", width: slot.width, height: slot.height }}>
      <Image src={slot.houseAdImageUrl} alt="" width={slot.width} height={slot.height} style={{ objectFit: "cover" }} />
    </a>
  );
}
```

Novo endpoint de clique, `app/api/ads/click/house/[slotId]/route.ts` (irmão do existente
`app/api/ads/click/[privateAdId]/route.ts`, mesmo formato):

```ts
export async function GET(_req: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;
  const slot = await db.adSlot.findUnique({ where: { id: slotId } });
  if (!slot || slot.source !== "HOUSE" || !slot.houseAdTargetUrl) {
    return NextResponse.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }
  await recordClick(slot.id);
  return new Response(null, { status: 307, headers: { location: slot.houseAdTargetUrl } });
}
```

`recordImpression`/`recordClick` (`lib/ads/private-ad-metrics.ts`) já são genéricos por
`adSlotId` — nenhuma mudança necessária ali, métricas de anúncio da casa aparecem no mesmo
`/admin/anuncios/metricas` que já existe, sem trabalho extra.

## Tratamento de erros

Idêntico ao padrão já estabelecido no fluxo do anunciante: dimensão errada rejeita antes do
upload (sem arquivo órfão); storage indisponível retorna 502; slot inexistente retorna 404; sem
`houseAdImageUrl` configurado ainda, o slot não renderiza nada (mesmo comportamento de uma
posição vazia hoje — não é erro, é estado normal "ainda não configurado").

## Testes

TDD (convenção do projeto) nas 2 rotas novas:
- `POST /api/admin/ads/slots/[id]/house-ad`: guard de auth, validação de URL, validação de
  dimensão, sucesso grava os 2 campos + `source`.
- `GET /api/ads/click/house/[slotId]`: 404 quando slot não existe/fonte não é HOUSE/sem
  targetUrl; redirect 307 + `recordClick` chamado no caso de sucesso.

`lib/ad-slots.ts`: teste do `updateAdSlot` cobrindo os 2 campos novos (se o arquivo de teste já
existir; senão, cobertura mínima nova).

Sem teste automatizado para `AdSlotEditForm.tsx`, `HouseAdUploadForm.tsx`,
`AdSlotRenderer.tsx`/`app/admin/anuncios/page.tsx` — componentes client / Server Components sem
infra de teste de componente React, mesma convenção já estabelecida no projeto.

## Fora de escopo (YAGNI, não pedido)

- Histórico de versões do anúncio da casa (troca simplesmente substitui).
- Múltiplos anúncios da casa por posição (rotação) — só 1 por slot, mesmo padrão de exclusividade
  já usado no marketplace privado (`findFirst` pega no máximo 1 ativo por vez).
- Qualquer aprovação/preview antes de publicar — usuário confirmou ativação imediata.
- Mudança em `PrivateAd`/`AdPurchase`/moderação/relatório em PDF do marketplace — nada disso é
  tocado.
