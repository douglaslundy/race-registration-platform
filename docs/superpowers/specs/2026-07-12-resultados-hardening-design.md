# Robustecer importação/publicação de resultados

## Contexto

Terceiro de uma leva de 6 sub-projetos pedidos pelo usuário nesta sessão (ordem: carrinhos
abandonados ✅ → filtros/resumo no evento ✅ → verificar resultados → corrigir expiração de
pagamentos → verificar repasses → dashboards). O pedido original era "criar página de resultado
caso ela não exista" — investigação confirmou que já existe de ponta a ponta:
`app/organizador/eventos/[id]/resultados/page.tsx` (upload CSV), `app/api/events/[id]/results/
route.ts` (parse + import + publish), e `app/(public)/eventos/[slug]/resultados/page.tsx` (exibição
pública com busca). Usuário confirmou (após eu reportar 3 lacunas encontradas na verificação) que
quer as 3 corrigidas agora, mantendo o formato de colunas do CSV inalterado.

## 1. Trocar o parser manual de CSV pelo `papaparse`

`app/api/events/[id]/results/route.ts` tem uma função `parseCSV` própria
(`line.split(",")`) que quebra em qualquer campo entre aspas contendo vírgula (ex: nome de atleta
"Silva, João" em uma planilha exportada do Excel/Sheets). `papaparse` já é dependência instalada
(`package.json`) mas não é usado em nenhum lugar do código hoje — claramente destinado a esse uso e
nunca ligado.

Troca `parseCSV` por:

```ts
import Papa from "papaparse";

function parseCSV(text: string): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
    transform: (v) => v.trim(),
  });
  if (result.data.length === 0) throw new Error("CSV vazio ou sem dados");
  return result.data;
}
```

Mesmo formato de colunas aceito (`bib_number`, `athlete_name` obrigatórias; `route`, `category`,
`gender`, `gross_time`, `net_time`, `placement_general`, `placement_category`, `placement_gender`
opcionais) — só a implementação interna muda. O resto da rota (`POST`/`PATCH`) não muda.

## 2. Testes para a rota de import/publish

Hoje `app/api/events/[id]/results/route.ts` não tem nenhum teste. Novo arquivo
`tests/event-results-route.test.ts` cobrindo:

- `POST`: 403 sem sessão/role inválida; 400 sem arquivo; 400 CSV vazio; 400 faltando coluna
  obrigatória; 404 evento não encontrado ou fora do escopo do organizador autenticado; sucesso —
  cria `ResultImport` + `RaceResult[]` via `createMany` + grava `AuditLog` `RESULTS_IMPORTED`,
  retorna `{ importId, rowCount }`.
- `PATCH`: 403 sem sessão/role inválida; sucesso — marca `published: true` e `publishedAt`.

`tests/setup.ts` precisa ganhar os métodos que a rota realmente chama e que faltam nos mocks atuais
(`resultImport`/`raceResult` só têm `count`/`deleteMany`/`findMany` hoje):

```ts
resultImport: { count: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
raceResult: { findMany: vi.fn(), createMany: vi.fn() },
```

Sem teste de página (nem a de upload do organizador nem a pública de exibição) — nenhuma página
deste projeto tem teste dedicado hoje, e este sub-projeto não muda essa convenção.

## 3. Filtro de categoria na página pública de resultados

`app/(public)/eventos/[slug]/resultados/page.tsx` já lê `searchParams.categoria` e filtra a query
por ele, mas não existe nenhum controle na UI pra definir esse valor (só busca por nome/número e
gênero). Adiciona um `<select name="categoria">` no formulário de busca, populado pelas categorias
*realmente presentes* no import atual — não pelas categorias configuradas no evento
(`EventCategory`), já que a categoria no CSV é texto livre e pode não bater exatamente com o nome
cadastrado no evento.

Nova query, independente da já existente (que já é filtrada por `q`/`categoria`/`genero`) — precisa
ser sem filtro de categoria pra sempre listar todas as opções disponíveis, não só as que sobraram
depois do filtro atual:

```ts
const availableCategories = latestImport
  ? await db.raceResult.findMany({
      where: { importId: latestImport.id, category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    })
  : [];
```

`<select name="categoria" defaultValue={sp.categoria}>` com uma opção "Todas as categorias" e uma
`<option>` por `c.category` de `availableCategories`.

## Fora de escopo

- Reescrever a tela de upload do organizador (`app/organizador/eventos/[id]/resultados/page.tsx`) —
  já funciona, não precisa de mudança.
- Histórico de imports anteriores / desfazer publicação — não pedido.
- Validar que a `category`/`route` do CSV batem com `EventCategory`/`EventRoute` cadastrados no
  evento — o CSV é intencionalmente texto livre (times/percursos podem ter nomes diferentes na
  planilha da cronometragem oficial).
