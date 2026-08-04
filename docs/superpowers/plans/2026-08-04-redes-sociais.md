# Redes sociais administráveis (Etapa 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin configures a URL for up to 6 social networks (Instagram, Facebook, WhatsApp,
YouTube, TikTok, X) at `/admin/configuracoes`; the site footer shows an icon per network that has a
URL configured, on every public page.

**Architecture:** No schema change, no new API route — reuses the existing generic
`POST /api/admin/settings` (`{key, value}` → `PlatformSetting` upsert, already admin-only, already
audit-logs, already `revalidatePath("/", "layout")`s the public layout that contains the footer).
Three pieces: (1) a small pure function deciding which networks to show, given raw setting values —
the one part of this feature worth unit-testing; (2) `components/layout/Footer.tsx` becomes async
and renders the icon row; (3) a new admin form component + a new card in the existing
`/admin/configuracoes` page.

**Tech Stack:** Next.js 16 App Router, Prisma 5 (via the existing `PlatformSetting` model —
untouched), Vitest.

## Global Constraints

- No schema migration. No new API route.
- 6 `PlatformSetting` keys: `social_instagram`, `social_facebook`, `social_whatsapp`,
  `social_youtube`, `social_tiktok`, `social_x`. Each stores the full URL the admin pastes (no
  format validation beyond non-empty/trimmed).
- A network with an empty/missing value renders NO icon at all (not a disabled/greyed icon).
- No native `alert()`/`confirm()`/`prompt()` — not applicable to this feature (no destructive
  actions), but the admin form's error state must be inline text, not a modal (matches
  `GoogleAdSenseClientIdForm`'s existing pattern).
- This codebase has no precedent for testing a Next.js Server Component page/component directly —
  don't invent one. Extract the one piece of real logic (which networks to show, in what order)
  into a pure, unit-tested function instead; leave the async Server Component and the `"use client"`
  admin form untested, matching this project's established convention
  (`IMPLEMENTATION_PLAN.md` §2.6).
- Full spec: `docs/superpowers/specs/2026-08-04-redes-sociais-design.md`.

---

### Task 1: `lib/social-links.ts` — which networks to show, and the icon set

**Files:**
- Create: `lib/social-links.ts`
- Create: `components/layout/SocialIcons.tsx`
- Test: `tests/lib-social-links.test.ts`

**Interfaces:**
- Produces: `SOCIAL_NETWORK_KEYS: string[]` (the 6 `PlatformSetting` keys, in display order),
  `interface SocialLink { key: string; label: string; url: string }`,
  `buildSocialLinks(values: Record<string, string | null | undefined>): SocialLink[]` — consumed by
  Task 2 (`Footer.tsx`).
- Produces: `SOCIAL_ICONS: Record<string, (props: { className?: string }) => JSX.Element>` (or 6
  named exports — see Step 3) from `components/layout/SocialIcons.tsx` — consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Create `tests/lib-social-links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSocialLinks, SOCIAL_NETWORK_KEYS } from "@/lib/social-links";

describe("SOCIAL_NETWORK_KEYS", () => {
  it("tem exatamente as 6 chaves esperadas, nesta ordem", () => {
    expect(SOCIAL_NETWORK_KEYS).toEqual([
      "social_instagram",
      "social_facebook",
      "social_whatsapp",
      "social_youtube",
      "social_tiktok",
      "social_x",
    ]);
  });
});

describe("buildSocialLinks", () => {
  it("retorna só as redes com valor preenchido, na ordem de SOCIAL_NETWORK_KEYS", () => {
    const result = buildSocialLinks({
      social_instagram: "https://instagram.com/exemplo",
      social_facebook: null,
      social_whatsapp: "https://wa.me/5511999999999",
      social_youtube: "",
      social_tiktok: undefined,
      social_x: "   ",
    });

    expect(result).toEqual([
      { key: "social_instagram", label: "Instagram", url: "https://instagram.com/exemplo" },
      { key: "social_whatsapp", label: "WhatsApp", url: "https://wa.me/5511999999999" },
    ]);
  });

  it("apara espaços em branco da URL", () => {
    const result = buildSocialLinks({ social_instagram: "  https://instagram.com/exemplo  " });
    expect(result[0].url).toBe("https://instagram.com/exemplo");
  });

  it("retorna array vazio quando nenhuma rede está preenchida", () => {
    expect(buildSocialLinks({})).toEqual([]);
  });

  it("ignora chaves desconhecidas no objeto de entrada", () => {
    const result = buildSocialLinks({ social_instagram: "https://instagram.com/x", chave_invalida: "y" });
    expect(result).toEqual([{ key: "social_instagram", label: "Instagram", url: "https://instagram.com/x" }]);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `npx vitest run tests/lib-social-links.test.ts`
Expected: FAIL — `lib/social-links.ts` doesn't exist yet.

- [ ] **Step 3: Implement `lib/social-links.ts`**

```ts
export interface SocialNetworkDefinition {
  key: string;
  label: string;
}

export const SOCIAL_NETWORKS: SocialNetworkDefinition[] = [
  { key: "social_instagram", label: "Instagram" },
  { key: "social_facebook", label: "Facebook" },
  { key: "social_whatsapp", label: "WhatsApp" },
  { key: "social_youtube", label: "YouTube" },
  { key: "social_tiktok", label: "TikTok" },
  { key: "social_x", label: "X" },
];

export const SOCIAL_NETWORK_KEYS: string[] = SOCIAL_NETWORKS.map((n) => n.key);

export interface SocialLink {
  key: string;
  label: string;
  url: string;
}

/** Retorna só as redes com valor preenchido (não vazio/whitespace), na ordem de SOCIAL_NETWORKS. */
export function buildSocialLinks(values: Record<string, string | null | undefined>): SocialLink[] {
  const result: SocialLink[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const raw = values[network.key];
    const trimmed = raw?.trim();
    if (trimmed) {
      result.push({ key: network.key, label: network.label, url: trimmed });
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `npx vitest run tests/lib-social-links.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Create `components/layout/SocialIcons.tsx`**

No test for this file (pure presentational SVG, no logic branches — matches the "no component
tests" convention). Six small named components, one per network, each a simple monochrome outline
icon (`currentColor`, so it inherits the footer's text color) in a 24×24 viewBox, accepting an
optional `className` prop:

```tsx
type IconProps = { className?: string };

export function InstagramIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FacebookIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M14 3h-2a4 4 0 0 0-4 4v3H6v4h2v7h4v-7h2.5l.5-4H12V7a1 1 0 0 1 1-1h1V3z" />
    </svg>
  );
}

export function WhatsappIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export function YoutubeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6z" />
    </svg>
  );
}

export function TiktokIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16.5 3c.3 2 1.6 3.6 3.5 4v3a7 7 0 0 1-3.5-1v6.3a5.7 5.7 0 1 1-5.7-5.7c.3 0 .6 0 .9.1v3.1a2.6 2.6 0 1 0 1.8 2.5V3h3z" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.9 3H22l-7.2 8.2L23 21h-6.6l-5.2-6.4L5.2 21H2l7.7-8.8L1.5 3h6.8l4.7 5.9L18.9 3zm-1.2 16h1.8L7.3 5H5.4l12.3 14z" />
    </svg>
  );
}

export const SOCIAL_ICON_BY_KEY: Record<string, (props: IconProps) => JSX.Element> = {
  social_instagram: InstagramIcon,
  social_facebook: FacebookIcon,
  social_whatsapp: WhatsappIcon,
  social_youtube: YoutubeIcon,
  social_tiktok: TiktokIcon,
  social_x: XIcon,
};
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS (this task's own test plus everything else unaffected).

- [ ] **Step 7: Run `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add lib/social-links.ts components/layout/SocialIcons.tsx tests/lib-social-links.test.ts
git commit -m "feat: adiciona logica pura de quais redes sociais mostrar + icones SVG das 6 redes"
```

---

### Task 2: `Footer.tsx` renders the configured social icons

**Files:**
- Modify: `components/layout/Footer.tsx`

**Interfaces:**
- Consumes: `buildSocialLinks`, `SOCIAL_NETWORK_KEYS` (from `@/lib/social-links`, Task 1),
  `SOCIAL_ICON_BY_KEY` (from `@/components/layout/SocialIcons`, Task 1), `getSetting` (already
  exists in `@/lib/settings`).

No automated test for this file (async Server Component — no precedent in this codebase, per
Global Constraints; the logic worth testing already has its own test from Task 1).

- [ ] **Step 1: Read the current file**

Read `components/layout/Footer.tsx` (already read during planning — reproduced below; re-read the
live file in case anything changed before editing).

- [ ] **Step 2: Replace `components/layout/Footer.tsx` with:**

```tsx
import Link from "next/link";
import { getSetting } from "@/lib/settings";
import { buildSocialLinks, SOCIAL_NETWORK_KEYS } from "@/lib/social-links";
import { SOCIAL_ICON_BY_KEY } from "./SocialIcons";

export default async function Footer({ appName }: { appName: string }) {
  const values = Object.fromEntries(
    await Promise.all(SOCIAL_NETWORK_KEYS.map(async (key) => [key, await getSetting(key)] as const)),
  );
  const socialLinks = buildSocialLinks(values);

  return (
    <footer className="bg-gray-900 text-gray-400 mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <div>
            <p className="text-white font-bold text-lg mb-2">🏃 {appName}</p>
            <p className="text-sm">Plataforma de inscrições para corridas de rua, trail run e eventos esportivos.</p>
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-3 mt-4">
                {socialLinks.map((link) => {
                  const Icon = SOCIAL_ICON_BY_KEY[link.key];
                  return (
                    <Link
                      key={link.key}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.label}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      <Icon className="w-5 h-5" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className="text-white font-medium mb-3">Links úteis</p>
            <ul className="space-y-2 text-sm">
              <li><Link href="/eventos" className="hover:text-white transition-colors">Ver eventos</Link></li>
              <li><Link href="/auth/cadastro" className="hover:text-white transition-colors">Criar conta</Link></li>
              <li><Link href="/auth/login" className="hover:text-white transition-colors">Entrar</Link></li>
              <li><Link href="/anuncie" className="hover:text-white transition-colors">Anuncie no site</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-medium mb-3">Legal</p>
            <ul className="space-y-2 text-sm">
              <li><Link href="/termos" className="hover:text-white transition-colors">Termos de Uso</Link></li>
              <li><Link href="/privacidade" className="hover:text-white transition-colors">Política de Privacidade</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 pt-6 text-center text-xs">
          © {new Date().getFullYear()} {appName}. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  );
}
```

Note: `Footer` becomes `async function` — its only caller, `app/(public)/layout.tsx`, already
`await`s other async Server Components in the same tree (`getAppName()` above it), so an async
child component here needs no caller-side change; `<Footer appName={appName} />` continues to work
unmodified since React/Next.js resolves async Server Components automatically.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS — no test imports `Footer.tsx` directly (confirm via `git grep -rn "layout/Footer"
tests/` returns nothing, consistent with the "no Server Component tests" convention).

- [ ] **Step 4: Run `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step 5: Run `npm run build`**

Expected: clean production build.

- [ ] **Step 6: Commit**

```bash
git add components/layout/Footer.tsx
git commit -m "feat: rodape mostra icone das redes sociais configuradas"
```

---

### Task 3: Admin form + `/admin/configuracoes` wiring

**Files:**
- Create: `components/admin/SocialLinksForm.tsx`
- Modify: `app/admin/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `SOCIAL_NETWORKS` (from `@/lib/social-links`, Task 1), `getSetting` (already exists).
- `SocialLinksForm` props: `{ currentValues: Record<string, string | null> }` (keyed by
  `social_instagram` etc., matching `SOCIAL_NETWORK_KEYS`).

No automated test (client component form, matches the established convention — same as
`GoogleAdSenseClientIdForm`/`ServiceFeeForm`, neither of which has a dedicated test).

- [ ] **Step 1: Read the current files**

Read `components/admin/GoogleAdSenseClientIdForm.tsx` (the pattern to mirror for the fetch/save
logic) and the current `app/admin/configuracoes/page.tsx` (to confirm the exact `Promise.all`
array and card layout this task inserts into — both already read during planning; re-read live
files before editing in case anything changed).

- [ ] **Step 2: Create `components/admin/SocialLinksForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { SOCIAL_NETWORKS } from "@/lib/social-links";

export default function SocialLinksForm({
  currentValues,
}: {
  currentValues: Record<string, string | null>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, currentValues[n.key] ?? ""])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const results = await Promise.all(
        SOCIAL_NETWORKS.map((network) =>
          fetch("/api/admin/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: network.key, value: values[network.key].trim() }),
          }),
        ),
      );
      if (results.every((res) => res.ok)) {
        setSaved(true);
      } else {
        setError("Erro ao salvar uma ou mais redes");
      }
    } catch {
      setError("Erro ao salvar");
    }
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      {SOCIAL_NETWORKS.map((network) => (
        <div key={network.key}>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{network.label}</label>
          <input
            type="text"
            value={values[network.key]}
            onChange={(e) => {
              setValues((prev) => ({ ...prev, [network.key]: e.target.value }));
              setSaved(false);
            }}
            placeholder={`https://...`}
            className="input-field text-sm py-1"
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary py-1 px-3 text-sm disabled:opacity-50"
        >
          {saving ? "Salvando…" : saved ? "Salvo!" : "Salvar"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `app/admin/configuracoes/page.tsx`**

Add the import:

```tsx
import SocialLinksForm from "@/components/admin/SocialLinksForm";
import { SOCIAL_NETWORK_KEYS } from "@/lib/social-links";
```

In the `Promise.all` array, add one more entry that resolves all 6 settings at once and add
`socialLinkValues` to the destructured result:

```tsx
  const [events, appName, enabledPaymentMethods, paymentProvider, accessToken, webhookSecret, mpPublicKey, pagarmeApiKey, pagarmePublicKey, pagarmeWebhookPassword, recentLogs, storageConfig, defaultPlatformFee, serviceFeePercent, serviceFeeMin, bannerInterval, smtpConfig, cancellationPolicyEnabled, adsMarketplaceEnabledSetting, socialLinkValuesArray] = await Promise.all([
    db.event.findMany({ ... }), // unchanged
    getAppName(),
    getSetting("enabled_payment_methods"),
    getPaymentProviderSetting(),
    getSetting("mp_access_token"),
    getSetting("mp_webhook_secret"),
    getSetting("mp_public_key"),
    getSetting("pagarme_api_key"),
    getSetting("pagarme_public_key"),
    getSetting("pagarme_webhook_password"),
    db.auditLog.findMany({ ... }), // unchanged
    getStorageConfig(),
    getDefaultPlatformFee(),
    getServiceFeePercent(),
    getServiceFeeMin(),
    getBannerInterval(),
    getSmtpConfig(),
    getCancellationPolicyEnabled(),
    getSetting("ads_marketplace_enabled"),
    Promise.all(SOCIAL_NETWORK_KEYS.map(async (key) => [key, await getSetting(key)] as const)),
  ]);

  const adsMarketplaceEnabled = adsMarketplaceEnabledSetting === "true";
  const socialLinkValues = Object.fromEntries(socialLinkValuesArray);
```

(the `db.event.findMany({...})` and `db.auditLog.findMany({...})` entries keep their exact existing
bodies — only shown abbreviated above to highlight the one new array entry and its position at the
end).

Add a new card, placed right after the "Nome da plataforma" card (both are public-branding
settings):

```tsx
      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Redes sociais</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Links exibidos como ícones no rodapé do site. Deixe em branco a rede que não deve
          aparecer.
        </p>
        <SocialLinksForm currentValues={socialLinkValues} />
      </div>
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Run `npx tsc --noEmit`**

Expected: clean.

- [ ] **Step 6: Run `npm run build`**

Expected: clean production build.

- [ ] **Step 7: Commit**

```bash
git add components/admin/SocialLinksForm.tsx app/admin/configuracoes/page.tsx
git commit -m "feat: admin configura as 6 redes sociais em /admin/configuracoes"
```

---

## Final verification

- [ ] `npx vitest run` — full suite green.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run build` — clean.
- [ ] Manual browser verification (dev server permitting — this environment has had a known,
  pre-existing dev-DB connectivity issue; if still blocked, defer to post-deploy or a working dev
  environment): log in as admin, fill in 2-3 social URLs at `/admin/configuracoes`, save, confirm
  the footer on `/` shows exactly those icons and no others, confirm the icons link out with
  `target="_blank"`.
- [ ] Acceptance criteria from the spec re-checked: no schema migration, no new API route, empty
  network shows no icon, all-empty hides the row entirely.
