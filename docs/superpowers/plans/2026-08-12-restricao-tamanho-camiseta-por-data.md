# Restrição de tamanho de camiseta por data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o organizador configure, por evento, uma data a partir da qual só um
subconjunto de tamanhos de camiseta continua disponível para novas inscrições, com a UI de
checkout refletindo isso e o backend bloqueando de verdade qualquer tentativa de escolher um
tamanho fora da lista permitida depois da data.

**Architecture:** Dois campos novos em `Event` (`shirtSizeRestrictionDate`,
`shirtSizeRestrictionSizes`), um helper puro `getAllowedShirtSizes()` compartilhado entre
client e server (mesmo padrão de `lib/batch-status.ts`), consumido em 3 pontos: a validação
de verdade em `createCheckout`, o filtro do `<select>` no checkout, e (indiretamente) a UI de
edição do evento que só grava os dois campos.

**Tech Stack:** Next.js App Router, Prisma (Postgres), react-hook-form + zod, Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-12-restricao-tamanho-camiseta-por-data-design.md`.
- Regra única por evento: uma data + um conjunto de tamanhos que sobra depois dela (não uma sequência de cortes).
- Sem restrição configurada (`shirtSizeRestrictionDate` null), ou antes da data: todos os 6 tamanhos disponíveis (comportamento atual).
- **O banco local aponta para produção** (registrado em memória do processo de deploy) — **nenhuma task deste plano executa `prisma migrate dev`, `prisma db push`, ou qualquer comando que toque o banco**. A migration é escrita à mão (Task 1) e só é aplicada em produção depois de confirmação explícita do usuário, como parte do processo de deploy documentado (`/opt/corridas/deploy.sh` + `docker compose run --rm app sh -c "npx prisma db push --skip-generate"` na VPS) — isso acontece FORA deste plano, na conversa com o humano, não como uma task aqui.
- `npx prisma generate` (só regenera o client TS a partir do schema, não toca no banco) é seguro e necessário rodar localmente após a Task 1.
- Fora de escopo: página pública do evento, card "Camisetas" do relatório, múltiplas datas de corte, exibição da restrição no admin.

---

### Task 1: Schema — novos campos em `Event` + migration escrita à mão

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260812120000_add_shirt_size_restriction/migration.sql`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: campos `Event.shirtSizeRestrictionDate: DateTime | null` e
  `Event.shirtSizeRestrictionSizes: ShirtSize[]` disponíveis no Prisma Client gerado
  (`@prisma/client`), consumidos por todas as tasks seguintes.

- [ ] **Step 1: Adicionar os campos no schema**

Em `prisma/schema.prisma`, no `model Event` (linha 257 atualmente termina com
`allowProxyRegistration       Boolean   @default(false)`), acrescentar logo depois:

```prisma
  allowProxyRegistration       Boolean   @default(false)
  shirtSizeRestrictionDate     DateTime?
  shirtSizeRestrictionSizes    ShirtSize[]
```

(As duas linhas novas ficam entre `allowProxyRegistration` e a linha em branco que
precede `organizer     OrganizerProfile @relation(...)`.)

- [ ] **Step 2: Escrever a migration à mão**

Criar o diretório `prisma/migrations/20260812120000_add_shirt_size_restriction/` com o
arquivo `migration.sql`:

```sql
-- AlterTable
ALTER TABLE "events" ADD COLUMN "shirtSizeRestrictionDate" TIMESTAMP(3);
ALTER TABLE "events" ADD COLUMN "shirtSizeRestrictionSizes" "ShirtSize"[] NOT NULL DEFAULT ARRAY[]::"ShirtSize"[];
```

Não rodar `prisma migrate dev`, `prisma migrate resolve`, nem qualquer comando que se
conecte ao banco — o arquivo é só texto, criado com o Write tool, igual foi feito pra
migration de `sensitive_action_codes` em `prisma/migrations/20260811060000_add_sensitive_action_codes/migration.sql`
(pode usar esse arquivo como referência de formato).

- [ ] **Step 3: Regenerar o Prisma Client (seguro, não toca no banco)**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client ... to ./node_modules/@prisma/client`, sem erros.

- [ ] **Step 4: Confirmar que o projeto ainda compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos (o projeto inteiro já compilava limpo antes desta task).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260812120000_add_shirt_size_restriction/migration.sql
git commit -m "feat: schema da restricao de tamanho de camiseta por data no evento"
```

---

### Task 2: Helper `getAllowedShirtSizes`

**Files:**
- Create: `lib/shirt-size-restriction.ts`
- Test: `tests/unit/shirt-size-restriction.test.ts`

**Interfaces:**
- Consumes: nada (função pura, sem dependência de Task 1 além do schema já existir
  conceitualmente — a assinatura usa tipos estruturais simples, não importa `@prisma/client`).
- Produces:
  - `export const ALL_SHIRT_SIZES: string[]` = `["PP", "P", "M", "G", "GG", "XGG"]`
  - `export function getAllowedShirtSizes(event: { shirtSizeRestrictionDate: Date | null; shirtSizeRestrictionSizes: string[] }, now?: Date): string[]`
  - Consumido por Task 3 (`lib/checkout.ts`) e Task 5 (`CheckoutForm.tsx`).

- [ ] **Step 1: Write the failing tests**

Criar `tests/unit/shirt-size-restriction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAllowedShirtSizes, ALL_SHIRT_SIZES } from "@/lib/shirt-size-restriction";

describe("getAllowedShirtSizes", () => {
  it("retorna todos os tamanhos quando não há restrição configurada", () => {
    const result = getAllowedShirtSizes({ shirtSizeRestrictionDate: null, shirtSizeRestrictionSizes: [] });
    expect(result).toEqual(ALL_SHIRT_SIZES);
  });

  it("retorna todos os tamanhos quando a data de corte ainda não chegou", () => {
    const now = new Date("2026-08-12T12:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: new Date("2026-09-01T00:00:00Z"), shirtSizeRestrictionSizes: ["G"] },
      now,
    );
    expect(result).toEqual(ALL_SHIRT_SIZES);
  });

  it("retorna só os tamanhos configurados quando a data de corte já passou", () => {
    const now = new Date("2026-09-02T00:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: new Date("2026-09-01T00:00:00Z"), shirtSizeRestrictionSizes: ["G"] },
      now,
    );
    expect(result).toEqual(["G"]);
  });

  it("retorna os tamanhos configurados exatamente no instante da data de corte (inclusivo)", () => {
    const cutoff = new Date("2026-09-01T00:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: cutoff, shirtSizeRestrictionSizes: ["G", "GG"] },
      cutoff,
    );
    expect(result).toEqual(["G", "GG"]);
  });

  it("cai de volta pra todos os tamanhos se a lista configurada vier vazia (defensivo)", () => {
    const now = new Date("2026-09-02T00:00:00Z");
    const result = getAllowedShirtSizes(
      { shirtSizeRestrictionDate: new Date("2026-09-01T00:00:00Z"), shirtSizeRestrictionSizes: [] },
      now,
    );
    expect(result).toEqual(ALL_SHIRT_SIZES);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/shirt-size-restriction.test.ts`
Expected: FAIL — `Cannot find module '@/lib/shirt-size-restriction'` (ou erro de import equivalente).

- [ ] **Step 3: Implementar o helper**

Criar `lib/shirt-size-restriction.ts`:

```ts
export const ALL_SHIRT_SIZES: string[] = ["PP", "P", "M", "G", "GG", "XGG"];

export interface ShirtSizeRestrictionInput {
  shirtSizeRestrictionDate: Date | null;
  shirtSizeRestrictionSizes: string[];
}

export function getAllowedShirtSizes(event: ShirtSizeRestrictionInput, now: Date = new Date()): string[] {
  if (!event.shirtSizeRestrictionDate || now < event.shirtSizeRestrictionDate) {
    return ALL_SHIRT_SIZES;
  }
  return event.shirtSizeRestrictionSizes.length > 0 ? event.shirtSizeRestrictionSizes : ALL_SHIRT_SIZES;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/shirt-size-restriction.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add lib/shirt-size-restriction.ts tests/unit/shirt-size-restriction.test.ts
git commit -m "feat: helper getAllowedShirtSizes para restricao de tamanho por data"
```

---

### Task 3: Validação de verdade no checkout (`createCheckout`)

**Files:**
- Modify: `lib/checkout.ts`
- Test: `tests/unit/checkout-shirt-size-restriction.test.ts`

**Interfaces:**
- Consumes: `getAllowedShirtSizes` de `lib/shirt-size-restriction` (Task 2); campos
  `Event.shirtSizeRestrictionDate` / `Event.shirtSizeRestrictionSizes` do Prisma Client (Task 1).
- Produces: nada consumido por outras tasks (Task 4 e 5 usam o helper diretamente, não esta task).

- [ ] **Step 1: Write the failing tests**

Criar `tests/unit/checkout-shirt-size-restriction.test.ts`, seguindo o padrão de mock de
`tests/unit/checkout-notes.test.ts` (mock de `db.$transaction` via `db as any`):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckout } from "@/lib/checkout";
import { db } from "@/lib/db";

const dbMock = db as any;

describe("createCheckout — restrição de tamanho de camiseta por data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ticketBatch = {
    id: "batch-1",
    active: true,
    soldCount: 0,
    capacity: 10,
    priceAmount: 20000,
  };

  const createTx = (event: any) => ({
    ticketBatch: {
      findUnique: vi.fn().mockResolvedValue(ticketBatch),
      findMany: vi.fn().mockResolvedValue([ticketBatch]),
      update: vi.fn().mockResolvedValue({}),
    },
    event: {
      findUnique: vi.fn().mockResolvedValue(event),
    },
    eventRoute: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    eventCategory: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    coupon: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      create: vi.fn().mockResolvedValue({ id: "order-1" }),
    },
    registration: {
      create: vi.fn().mockResolvedValue({ id: "reg-1" }),
    },
  });

  it("permite um tamanho fora da lista restrita quando a data de corte ainda não chegou", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: new Date("2099-01-01T00:00:00Z"),
      shirtSizeRestrictionSizes: ["G"],
    };
    const tx = createTx(event);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "PP" as any,
      }),
    ).resolves.toBeDefined();
  });

  it("rejeita um tamanho fora da lista restrita quando a data de corte já passou", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: new Date("2000-01-01T00:00:00Z"),
      shirtSizeRestrictionSizes: ["G"],
    };
    const tx = createTx(event);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "PP" as any,
      }),
    ).rejects.toThrow("Tamanho de camiseta indisponível para este evento");
  });

  it("permite o tamanho que continua na lista restrita depois da data de corte", async () => {
    const event = {
      id: "event-1",
      status: "REGISTRATIONS_OPEN",
      platformFeePercent: 1100,
      shirtSizeRestrictionDate: new Date("2000-01-01T00:00:00Z"),
      shirtSizeRestrictionSizes: ["G"],
    };
    const tx = createTx(event);
    dbMock.$transaction.mockImplementationOnce(async (fn: any) => fn(tx));

    await expect(
      createCheckout({
        eventId: "event-1",
        ticketBatchId: "batch-1",
        buyerUserId: "user-1",
        athleteUserId: "user-1",
        shirtSize: "G" as any,
      }),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/checkout-shirt-size-restriction.test.ts`
Expected: FAIL — o teste "rejeita um tamanho fora da lista restrita..." falha porque
`createCheckout` ainda não lança o erro (ainda aceita qualquer tamanho).

- [ ] **Step 3: Implementar a validação**

Em `lib/checkout.ts`, adicionar o import no topo do arquivo:

```ts
import { getAllowedShirtSizes } from "./shirt-size-restriction";
```

E logo após a linha existente (dentro de `db.$transaction(async (tx) => { ... })`):

```ts
    const event = await tx.event.findUnique({ where: { id: input.eventId } });
    if (!event || event.status !== "REGISTRATIONS_OPEN") throw new Error("Inscrições não abertas");
```

acrescentar:

```ts
    if (input.shirtSize) {
      const allowedSizes = getAllowedShirtSizes(event, new Date());
      if (!allowedSizes.includes(input.shirtSize)) {
        throw new Error("Tamanho de camiseta indisponível para este evento");
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/checkout-shirt-size-restriction.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Rodar a suíte de testes de checkout inteira, pra garantir que nada quebrou**

Run: `npx vitest run tests/unit/checkout-notes.test.ts tests/unit/checkout-coupon.test.ts tests/unit/checkout-proxy-athlete.test.ts tests/checkout-route.test.ts`
Expected: PASS em todos (esses arquivos usam eventos mock sem os dois campos novos — como
`getAllowedShirtSizes` trata `shirtSizeRestrictionDate` ausente/`undefined` como "sem
restrição" da mesma forma que `null`, graças ao `!event.shirtSizeRestrictionDate`, não
deve quebrar nada; se algum teste quebrar por causa de tipo estrito do TS reclamando de
campo faltando no mock, é aceitável — os mocks já usam `any`).

- [ ] **Step 6: Commit**

```bash
git add lib/checkout.ts tests/unit/checkout-shirt-size-restriction.test.ts
git commit -m "feat: bloqueia tamanho de camiseta fora da restricao no createCheckout"
```

---

### Task 4: UI de edição do evento (organizador)

**Files:**
- Modify: `components/organizer/EditEventForm.tsx`
- Modify: `app/api/events/[id]/route.ts`
- Modify: `app/organizador/eventos/[id]/editar/page.tsx`

**Interfaces:**
- Consumes: campos `Event.shirtSizeRestrictionDate` / `Event.shirtSizeRestrictionSizes` do Prisma Client (Task 1).
- Produces: nada consumido por outras tasks (Task 5 é independente, lê os mesmos campos via `getEventBySlug`, que já não tem `select` restritivo).

- [ ] **Step 1: Acrescentar os campos ao `select` da página de edição**

Em `app/organizador/eventos/[id]/editar/page.tsx`, o `select` do `db.event.findFirst`
tem hoje:

```ts
      select: {
        id: true, title: true, description: true, modality: true,
        startAt: true, kitPickupAt: true, venueName: true, addressLine: true,
        city: true, state: true, maxParticipants: true, organizerContact: true,
        bannerUrl: true, listBannerUrl: true, regulationUrl: true, regulationText: true,
        metaTitle: true, metaDescription: true,
        cancellationDeadline: true, cancellationRequiresApproval: true,
        cancellationContactPhone: true, cancellationContactEmail: true,
        allowProxyRegistration: true,
      },
```

Acrescentar as duas linhas novas ao final do `select`:

```ts
      select: {
        id: true, title: true, description: true, modality: true,
        startAt: true, kitPickupAt: true, venueName: true, addressLine: true,
        city: true, state: true, maxParticipants: true, organizerContact: true,
        bannerUrl: true, listBannerUrl: true, regulationUrl: true, regulationText: true,
        metaTitle: true, metaDescription: true,
        cancellationDeadline: true, cancellationRequiresApproval: true,
        cancellationContactPhone: true, cancellationContactEmail: true,
        allowProxyRegistration: true,
        shirtSizeRestrictionDate: true, shirtSizeRestrictionSizes: true,
      },
```

- [ ] **Step 2: Estender o schema, o tipo `EventData` e os valores padrão do formulário**

Em `components/organizer/EditEventForm.tsx`, no `schema` (zod), acrescentar depois de
`allowProxyRegistration: z.boolean().optional(),` (linha 29 atual):

```ts
  allowProxyRegistration: z.boolean().optional(),
  shirtSizeRestrictionDate: z.string().optional(),
  shirtSizeRestrictionSizes: z.array(z.enum(["PP", "P", "M", "G", "GG", "XGG"])).optional(),
});
```

No tipo `EventData` (linha 53-77 atual), acrescentar depois de
`allowProxyRegistration?: boolean;`:

```ts
  allowProxyRegistration?: boolean;
  shirtSizeRestrictionDate?: Date | string | null;
  shirtSizeRestrictionSizes?: string[];
};
```

Nos `defaultValues` do `useForm` (depois de
`allowProxyRegistration: event.allowProxyRegistration ?? false,`, linha 124 atual):

```ts
      allowProxyRegistration: event.allowProxyRegistration ?? false,
      shirtSizeRestrictionDate: event.shirtSizeRestrictionDate ? toDatetimeLocal(event.shirtSizeRestrictionDate) : "",
      shirtSizeRestrictionSizes: event.shirtSizeRestrictionSizes ?? [],
    },
  });
```

- [ ] **Step 3: Adicionar validação condicional (data preenchida exige ≥1 tamanho)**

O `handleSubmit` do react-hook-form não faz validação cross-field automática com
`z.object` simples; a forma mais direta aqui, seguindo o estilo já usado no componente pra
outros erros (`setError`), é validar dentro de `onSubmit` antes do `fetch`. Em
`components/organizer/EditEventForm.tsx`, dentro de `async function onSubmit(data: FormData)`
(linha 144 atual), logo após `setError(null);`:

```ts
  async function onSubmit(data: FormData) {
    setError(null);
    if (data.shirtSizeRestrictionDate && (data.shirtSizeRestrictionSizes ?? []).length === 0) {
      setError("Selecione pelo menos um tamanho de camiseta para a restrição.");
      return;
    }
    const maxParticipants = data.maxParticipants === 0 ? null : data.maxParticipants;
```

E no corpo do `fetch` (dentro do `JSON.stringify({...})`, depois de
`cancellationContactEmail: data.cancellationContactEmail || null,`):

```ts
        cancellationContactEmail: data.cancellationContactEmail || null,
        shirtSizeRestrictionDate: data.shirtSizeRestrictionDate ? new Date(data.shirtSizeRestrictionDate).toISOString() : null,
        shirtSizeRestrictionSizes: data.shirtSizeRestrictionDate ? (data.shirtSizeRestrictionSizes ?? []) : [],
      }),
    });
```

(Zerar `shirtSizeRestrictionSizes` quando a data é removida evita ficar com tamanhos
"órfãos" salvos sem data de corte.)

- [ ] **Step 4: Adicionar a seção no JSX**

Em `components/organizer/EditEventForm.tsx`, logo depois do bloco
`{cancellationPolicyEnabled && (...)}` (fecha na linha 354 atual) e antes de
`{error && (...)}`, acrescentar:

```tsx
      <div className="border-t pt-5 dark:border-gray-700 space-y-3">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Restrição de tamanho de camiseta</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Deixe a data em branco para manter todos os tamanhos disponíveis durante toda a
          inscrição (padrão). Se preenchida, só os tamanhos marcados abaixo continuam
          disponíveis a partir dessa data.
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Restringir tamanhos a partir de
          </label>
          <input type="datetime-local" {...register("shirtSizeRestrictionDate")} className="input w-full" />
        </div>
        <div className="flex flex-wrap gap-3">
          {["PP", "P", "M", "G", "GG", "XGG"].map((size) => (
            <label key={size} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" value={size} {...register("shirtSizeRestrictionSizes")} className="h-4 w-4" />
              {size}
            </label>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
```

- [ ] **Step 5: Estender o schema e a persistência da rota PATCH**

Em `app/api/events/[id]/route.ts`, no `updateEventSchema`, acrescentar depois de
`allowProxyRegistration: z.boolean().optional(),` (linha 30 atual):

```ts
  allowProxyRegistration: z.boolean().optional(),
  shirtSizeRestrictionDate: z.string().datetime().optional().nullable(),
  shirtSizeRestrictionSizes: z.array(z.enum(["PP", "P", "M", "G", "GG", "XGG"])).optional(),
});
```

No `db.event.update` (dentro do `data: {...}`), acrescentar mais uma linha condicional
depois da já existente de `cancellationDeadline` (linha 65 atual):

```ts
      ...(parsed.data.cancellationDeadline !== undefined ? { cancellationDeadline: parsed.data.cancellationDeadline ? new Date(parsed.data.cancellationDeadline) : null } : {}),
      ...(parsed.data.shirtSizeRestrictionDate !== undefined ? { shirtSizeRestrictionDate: parsed.data.shirtSizeRestrictionDate ? new Date(parsed.data.shirtSizeRestrictionDate) : null } : {}),
    },
```

(`shirtSizeRestrictionSizes` não precisa de linha condicional própria — já é um array de
strings, passa direto pelo `...parsed.data` no início do `data: {...}` sem precisar de
conversão de tipo.)

- [ ] **Step 6: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 7: Conferir visualmente no navegador**

Run: `npm run dev`, abrir `/organizador/eventos/<id>/editar` de um evento existente.
Confirmar:
- A nova seção "Restrição de tamanho de camiseta" aparece, com o campo de data e os 6
  checkboxes.
- Marcar uma data + 1 tamanho, salvar, reabrir a página: os valores persistem.
- Tentar salvar com data preenchida e nenhum tamanho marcado: aparece a mensagem de erro
  "Selecione pelo menos um tamanho..." e o formulário não submete.
- Limpar a data e salvar: `shirtSizeRestrictionSizes` é zerado (conferir no banco ou no
  próximo carregamento da página, que deve voltar com os checkboxes desmarcados).

- [ ] **Step 8: Commit**

```bash
git add components/organizer/EditEventForm.tsx "app/api/events/[id]/route.ts" "app/organizador/eventos/[id]/editar/page.tsx"
git commit -m "feat: organizador configura restricao de tamanho de camiseta por data no evento"
```

---

### Task 5: Filtro e aviso no checkout

**Files:**
- Modify: `components/checkout/CheckoutForm.tsx`

**Interfaces:**
- Consumes: `getAllowedShirtSizes` de `lib/shirt-size-restriction` (Task 2); campos
  `Event.shirtSizeRestrictionDate` / `Event.shirtSizeRestrictionSizes`, já retornados por
  `getEventBySlug` sem `select` restritivo (Task 1) — nenhuma mudança necessária em
  `lib/events.ts` nem em `app/(public)/inscricao/[slug]/page.tsx`.
- Produces: nada consumido por outras tasks (última task do plano).

- [ ] **Step 1: Estender a interface `EventData` e importar o helper**

Em `components/checkout/CheckoutForm.tsx`, acrescentar o import (junto aos outros imports
de `@/lib/...`, perto da linha 9 atual):

```ts
import { getAllowedShirtSizes } from "@/lib/shirt-size-restriction";
```

Na interface `EventData` (linha 45-51 atual), acrescentar:

```ts
interface EventData {
  id: string;
  title: string;
  slug: string;
  routes: { id: string; name: string; distanceKm: number }[];
  categories: { id: string; name: string }[];
  shirtSizeRestrictionDate?: Date | string | null;
  shirtSizeRestrictionSizes?: string[];
}
```

- [ ] **Step 2: Calcular os tamanhos permitidos e filtrar o `<select>`**

Dentro do componente `CheckoutForm`, antes do `return (...)` (o componente já tem outras
variáveis calculadas no corpo — inserir perto do topo do corpo da função, após a
desestruturação de props), acrescentar:

```ts
  const allowedShirtSizes = getAllowedShirtSizes(
    {
      shirtSizeRestrictionDate: event.shirtSizeRestrictionDate ? new Date(event.shirtSizeRestrictionDate) : null,
      shirtSizeRestrictionSizes: event.shirtSizeRestrictionSizes ?? [],
    },
    new Date(),
  );
  const shirtSizeRestricted = allowedShirtSizes.length < 6;
```

No JSX do select de camiseta (linha 459-464 atual):

```tsx
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Camiseta</label>
            <select {...register("shirtSize")} className="input-field">
              <option value="">Selecione</option>
              {allowedShirtSizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {shirtSizeRestricted && event.shirtSizeRestrictionDate && (
              <p className="text-xs text-gray-500 mt-1">
                Alguns tamanhos deixaram de estar disponíveis a partir de{" "}
                {new Date(event.shirtSizeRestrictionDate).toLocaleDateString("pt-BR")}.
              </p>
            )}
          </div>
```

- [ ] **Step 3: Rodar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Rodar a suíte de testes inteira**

Run: `npm test`
Expected: PASS em todos os arquivos (nenhum teste existente cobre `CheckoutForm.tsx`
diretamente — é um client component sem teste de unidade dedicado neste repositório;
a suíte inteira serve só de guarda-chuva contra regressão em outros lugares).

- [ ] **Step 5: Conferir visualmente no navegador**

Com `npm run dev` rodando e um evento de teste com a restrição configurada (via Task 4) pra
uma data no passado e só o tamanho "G" marcado: abrir `/inscricao/<slug>` desse evento e
confirmar que o select de camiseta só lista "G", com o aviso abaixo. Testar também um
evento sem restrição configurada: select mostra os 6 tamanhos, sem aviso.

- [ ] **Step 6: Commit**

```bash
git add components/checkout/CheckoutForm.tsx
git commit -m "feat: filtra tamanhos de camiseta disponiveis no checkout conforme restricao do evento"
```

---

## Self-Review Notes

- **Spec coverage:** schema + migration manual (Task 1) ✓; helper puro com fallback
  defensivo pra lista vazia (Task 2) ✓; bloqueio de verdade em `createCheckout` (Task 3) ✓;
  configuração pelo organizador com validação de "≥1 tamanho se data preenchida" (Task 4) ✓;
  filtro + aviso no checkout (Task 5) ✓; nenhuma task mexe na página pública, no card
  "Camisetas" do relatório, em múltiplas datas de corte, ou no admin ✓.
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — cada task tem o código
  completo a ser inserido, inclusive os testes.
- **Type consistency:** `getAllowedShirtSizes(event: { shirtSizeRestrictionDate: Date | null; shirtSizeRestrictionSizes: string[] }, now?: Date): string[]`
  usado com a mesma assinatura em Task 3 (`lib/checkout.ts`, passando o `event` do Prisma
  direto — que já tem `Date | null` e `ShirtSize[]`, ambos compatíveis estruturalmente com
  `string[]`) e Task 5 (`CheckoutForm.tsx`, convertendo a prop serializada `Date | string | null`
  pra `Date | null` antes de chamar).
- **Risco de produção:** a única ação que toca o banco de produção (aplicar a migration) é
  deliberadamente deixada FORA das tasks — fica para uma conversa explícita com o usuário
  no momento do deploy, seguindo a mesma cautela já registrada em memória pra essa mesma
  situação (schema change + banco local apontando pra produção).
