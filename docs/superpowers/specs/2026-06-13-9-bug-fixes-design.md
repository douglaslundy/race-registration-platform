# Design: 9 Bug Fixes — Dark Mode, Storage, Regulation, Payments, PIX QR Code

## Scope

Nine targeted bug fixes across admin, organizer, and checkout flows. No new pages. Minimal DB migration (one column). No breaking changes.

---

## Task 01-02: Dark Mode Button Contrast (admin/configuracoes, admin/eventos)

**Problem:** Inline button-like links use hardcoded `text-gray-700 border-gray-300 hover:bg-gray-50` without dark variants. On dark backgrounds these become unreadable. Status badge `bg-gray-100 text-gray-700` stays light in dark mode.

**Fix:**
- `app/admin/eventos/page.tsx`: Add `dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-800` to "Exportar CSV", "Limpar", and pagination links. Add `dark:bg-gray-700 dark:text-gray-200` to status badge.
- `components/admin/SetPlatformFeeForm.tsx`: Add `dark:border-gray-700 dark:text-gray-200` to the container div.
- No change to `btn-primary` (blue/white works in any theme) or `btn-secondary` (already has dark variants).

---

## Task 03-04: Storage Configuration (banner e regulamento uploads)

**Problem:** `.env` has empty `STORAGE_BUCKET/ACCESS_KEY/SECRET_KEY`. `isS3Configured()` returns false → 503 on upload.

**Architecture:**
- Restore Supabase project via MCP → create public bucket `uploads`.
- Supabase Storage exposes an S3-compatible endpoint: `https://<project-ref>.supabase.co/storage/v1/s3`.
- Credentials come from Supabase service role key (used as `STORAGE_ACCESS_KEY` with project ref as `STORAGE_SECRET_KEY`).
- `lib/s3.ts` refactored: `getStorageConfig()` reads from `PlatformSetting` (keys: `storage_provider`, `storage_bucket`, `storage_endpoint`, `storage_access_key`, `storage_secret_key`) with `.env` fallback.
- New `components/admin/StorageSettingsForm.tsx`: dropdown "Supabase Storage" / "S3 / Cloudflare R2 (custom)" + fields for bucket, endpoint (optional), access key, secret key. Pattern mirrors `PaymentGatewayForm`.
- `app/admin/configuracoes/page.tsx`: add Storage section.

---

## Task 05: Regulation Text Field

**Problem:** Organizer can only upload a PDF for the regulation. No text alternative.

**DB change:** Add `regulationText TEXT` to `events` table (nullable, migration via Supabase MCP).

**Schema:** Add `regulationText String? @db.Text` to `Event` model in `schema.prisma`.

**Form:** `EditEventForm` gains a textarea "Regulamento (texto)" below the PDF upload. Both are optional; organizer can fill one or both.

**API:** `PATCH /api/events/[id]` already accepts arbitrary fields from the body — add `regulationText` to the allowed fields and Zod schema.

**Display:** Event detail page (`app/(public)/eventos/[slug]/page.tsx`) shows `regulationText` in a prose block when present, alongside the PDF link.

---

## Task 06-07: Payment Errors (card, boleto)

**Problem:** If `payment_provider` setting in DB is `mercadopago` but no `mp_access_token` is configured, `getClient()` throws `"MP_ACCESS_TOKEN não configurado"` which is caught generically as `"Erro ao processar inscrição"`.

**Fix:**
- `app/api/checkout/route.ts`: before calling `provider.createPayment()`, if provider is MercadoPago check that the token is configured. If not, return a clear 422: `"Gateway de pagamento não configurado. Configure o Mercado Pago em Admin › Configurações."`.
- This unblocks sandbox testing too (sandbox always works regardless of MP token).

---

## Task 08: PIX QR Code Image

**Problem:** Checkout result shows only the PIX copia-e-cola text. No QR code image.

**Fix:**
- Install `react-qr-code` (client-side, no external service, keeps PIX code private).
- `components/checkout/CheckoutForm.tsx` result view: render `<QRCodeSVG value={pixQrCodeText} size={200} />` above the text block.
- `components/dashboard/PixPaymentCard.tsx`: same — add QR image above copy button.

---

## Task 09: Mercado Pago Checkout Configuration

**Steps:**
1. Use `mcp__mercadopago__get_credentials` to retrieve test/prod credentials.
2. Set `payment_provider = mercadopago` via `POST /api/admin/settings`.
3. Set `mp_access_token` via admin settings API.
4. Configure webhook: use `mcp__mercadopago__save_webhook` pointing to `<APP_URL>/api/webhooks/payment`.
5. Verify with `mcp__mercadopago__quality_checklist`.

---

## Constraints

- No new pages (storage and MP config go into existing `admin/configuracoes`).
- One DB migration only (`regulationText` column).
- No changes to auth or registration flow.
- Sandbox provider remains the default when MP is unconfigured.
