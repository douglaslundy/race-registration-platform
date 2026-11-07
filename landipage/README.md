# Material para anúncio — pasta `landipage/`

Conteúdo gerado para anunciar o sistema no Mercado Livre.

## Arquivos

- `descricao-mercado-livre.md` — texto pronto para colar na descrição do anúncio (título,
  descrição persuasiva completa e palavras-chave sugeridas).
- `index.html` — landing page completa para divulgar/vender o sistema. Abra direto no navegador
  (duplo clique) ou hospede onde preferir. Tem botão **"Comprar o sistema"** e botão flutuante de
  **WhatsApp**, ambos apontando para `+55 35 98429-7193`.
- `images/*.svg` — as 7 imagens usadas na landing page (e que também podem ser usadas no anúncio
  do Mercado Livre).

## Sobre as imagens (importante)

O banco de dados do projeto (Supabase, `db.usgslzpuovvrkvvrhljt.supabase.co`) estava
**inacessível** no momento em que este material foi gerado (DNS não resolvia — provavelmente o
projeto Supabase está pausado ou foi removido). Por isso não foi possível rodar o sistema
localmente e tirar screenshots reais.

As 7 imagens em `images/` são **mockups ilustrativos**, redesenhadas a partir da leitura direta do
código de cada página (`app/admin/usuarios/page.tsx`, `app/admin/page.tsx`, `app/organizador/page.tsx`,
`app/organizador/mensagens/page.tsx`, `app/admin/alertas/page.tsx`, `app/admin/anuncios/page.tsx`,
`components/events/EventCard.tsx`, `components/events/EventFilters.tsx` etc.) — reproduzem a
estrutura real de cada tela (colunas de tabela, filtros, cards, gráficos) e a paleta de cores do
`tailwind.config.ts`, mas os dados exibidos (nomes, valores, números) são fictícios.

**Atenção:** revise ainda assim antes de publicar — o código muda com o tempo, e uma captura de
tela real sempre bate melhor com o produto do que uma reprodução.

### Como substituir por screenshots reais depois

1. Reative o projeto Supabase (verifique se está pausado no painel) ou ajuste `DATABASE_URL` /
   `DIRECT_URL` no `.env` para um banco acessível.
2. Rode `npm run dev` na raiz do projeto.
3. Faça login com os usuários do seed (senha `12345678` para todos):
   - Admin: `admin@corridasapp.com.br`
   - Organizador: `organizador@exemplo.com.br`
4. Capture as telas equivalentes às listadas abaixo e salve com os mesmos nomes de arquivo em
   `images/` (pode salvar como `.png` — só ajuste a extensão nos `src` do `index.html`):
   - `tela-01-home-publica` → `/eventos`
   - `tela-02-admin-organizadores` → `/admin/usuarios`
   - `tela-03-admin-financeiro` → `/admin` (dashboard principal do admin)
   - `tela-04-organizador-eventos` → `/organizador`
   - `tela-05-mensagens` → `/organizador/mensagens`
   - `tela-06-alertas` → `/admin/alertas`
   - `tela-07-anuncios` → `/admin/anuncios`

Se o banco não tiver eventos/organizadores de exemplo cadastrados, crie 1–2 eventos de teste pelo
painel do organizador antes de capturar, para as telas não ficarem vazias no anúncio.
