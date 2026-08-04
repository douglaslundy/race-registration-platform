# Redes sociais administráveis (Etapa 8) — Design

## Contexto

Etapa 8 do mega-prompt de 10 etapas. Auditoria da Etapa 1 (`IMPLEMENTATION_PLAN.md` §2.5/§3.4) já
confirmou: hoje não existe nenhuma chave em `PlatformSetting`, nenhum componente, nenhum campo de
admin pra redes sociais — 100% a construir, mas o padrão de armazenamento (chave-valor via
`PlatformSetting`) já existe e deve ser reaproveitado, sem tabela nova.

## Redes cobertas

Instagram, Facebook, WhatsApp, YouTube, TikTok, X (antigo Twitter). Cada uma guarda a **URL
completa** que o admin colar (ex: `https://instagram.com/suapagina`,
`https://wa.me/5511999999999`) — sem parsing nem validação de formato específico por rede, só uma
string opcional. Rede sem valor preenchido simplesmente não aparece em lugar nenhum.

## Onde aparece

Só no rodapé (`components/layout/Footer.tsx`), que já existe e já é renderizado uma vez em
`app/(public)/layout.tsx` — ou seja, aparece em toda página pública automaticamente, sem precisar
tocar em nenhuma outra tela.

## Backend — zero código novo

`POST /api/admin/settings` (`app/api/admin/settings/route.ts`) já existe e já cobre 100% do que
esta feature precisa: admin-only (`session.user.role !== "ADMIN"` → 403), grava
`AuditLog` (`SETTING_UPDATED`), e já roda `revalidatePath("/", "layout")` — que já invalida o cache
do layout público, e portanto do `Footer` (que vive dentro desse layout). Esta etapa não cria
nenhuma rota nova, nenhuma migração de schema — só usa 6 chaves novas de `PlatformSetting`:

```
social_instagram
social_facebook
social_whatsapp
social_youtube
social_tiktok
social_x
```

## Admin (`/admin/configuracoes`)

Novo componente `components/admin/SocialLinksForm.tsx`, no mesmo padrão client-component de
`components/admin/GoogleAdSenseClientIdForm.tsx` (mesmo endpoint, `useState` + `fetch`), mas
diferente na forma: em vez de 1 campo + 1 botão "Salvar" por chave (como o Adsense), é **um bloco
só** com os 6 campos de texto (um por rede, com label) e **um único botão "Salvar"**, que dispara os
6 `POST /api/admin/settings` (um por chave, sequencial ou em paralelo — decisão de implementação,
sem impacto observável já que cada `POST` é independente e idempotente). Página server-component
(`app/admin/configuracoes/page.tsx`) passa os 6 valores atuais (via `getSetting` de
`lib/settings.ts`, mesma função já usada por `GoogleAdSenseClientIdForm`'s `currentClientId`) como
props iniciais.

Sem `alert()`/`confirm()`/`prompt()` — regra fixa do `CLAUDE.md`. Esta tela não precisa de nenhum
deles (não há ação destrutiva aqui, só salvar texto), mas o formulário deve mostrar erro inline
(mesmo padrão do `GoogleAdSenseClientIdForm`: texto de erro abaixo do campo, não modal) se algum dos
6 `POST`s falhar.

## Footer (`components/layout/Footer.tsx`)

Vira `async` (já busca dados de outros componentes similares neste projeto via `getSetting`
diretamente, sem precisar que o layout pai passe as props) e busca as 6 chaves. Renderiza uma
fileira de ícones SVG inline (sem dependência de biblioteca de ícones externa) ao lado do nome da
plataforma, um `<Link>` por rede com valor não-vazio, `target="_blank" rel="noopener noreferrer"`.
Rede com valor vazio/ausente não renderiza ícone nenhum (não é ícone cinza/desabilitado — ausência
total). Se as 6 vierem vazias, a fileira inteira não aparece (mesmo princípio de "seção vazia some"
já usado na Etapa 6/home).

**Nota técnica**: `Footer` hoje é um componente síncrono (`export default function Footer(...)`,
recebe só `{ appName }` via prop). Vira `async function Footer(...)` — mudança compatível, já que
`app/(public)/layout.tsx` já renderiza componentes async em Server Components normalmente (mesmo
padrão de toda página deste projeto).

## Testes

- `SocialLinksForm.tsx`: sem teste dedicado (convenção já estabelecida — componente `"use client"`
  não tem teste dedicado neste projeto).
- `Footer.tsx`: como vira async e passa a buscar dado real, ganha um teste garantindo que só
  renderiza o link/ícone da rede com valor preenchido, e que a fileira inteira some quando as 6
  vêm vazias — mesmo padrão de teste leve já usado na Etapa 6 pra seção condicional da home.
- `POST /api/admin/settings`: já tem teste, sem mudança necessária (endpoint não muda).

## Critérios de aceite

- Admin consegue salvar/editar as 6 URLs de rede social em `/admin/configuracoes`, um botão
  "Salvar" só.
- Rodapé (toda página pública) mostra um ícone por rede preenchida, nenhum ícone pras vazias.
- Nenhuma rede preenchida → fileira de ícones não aparece.
- Nenhuma migração de schema, nenhuma rota de API nova.
- Suíte completa + `tsc --noEmit` + `npm run build` limpos, mesma exigência de sempre.
