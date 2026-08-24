import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/rbac";
import { listOptedOutAthletes } from "@/lib/campaigns/opted-out";
import CampaignsManager from "@/components/campaigns/CampaignsManager";

export const metadata: Metadata = { title: "Campanhas — Admin" };
export const dynamic = "force-dynamic";

/** Janela de páginas ao redor da atual (+ primeira/última), com "..." nos vãos — mesmo helper de
 * app/admin/mensagens/page.tsx, duplicado aqui (arquivos de página server-side deste projeto não
 * compartilham esse utilitário hoje). */
function getPaginationRange(current: number, total: number): (number | "...")[] {
  const siblingCount = 1;
  const totalVisible = siblingCount * 2 + 5;
  if (total <= totalVisible) return Array.from({ length: total }, (_, i) => i + 1);

  const leftSibling = Math.max(current - siblingCount, 1);
  const rightSibling = Math.min(current + siblingCount, total);
  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < total - 1;

  if (!showLeftDots && showRightDots) {
    const leftRange = Array.from({ length: 3 + siblingCount * 2 }, (_, i) => i + 1);
    return [...leftRange, "...", total];
  }
  if (showLeftDots && !showRightDots) {
    const rightCount = 3 + siblingCount * 2;
    const rightRange = Array.from({ length: rightCount }, (_, i) => total - rightCount + i + 1);
    return [1, "...", ...rightRange];
  }
  const middleRange = Array.from({ length: rightSibling - leftSibling + 1 }, (_, i) => leftSibling + i);
  return [1, "...", ...middleRange, "...", total];
}

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
}

function CampaignTabs({ active }: { active: "campanhas" | "optouts" }) {
  const tabClass = (isActive: boolean) =>
    `px-4 py-2 text-sm ${
      isActive
        ? "border-b-2 border-primary-600 text-primary-600 font-medium"
        : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    }`;
  return (
    <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
      <Link href="/admin/campanhas" className={tabClass(active === "campanhas")}>
        Campanhas
      </Link>
      <Link href="/admin/campanhas?tab=optouts" className={tabClass(active === "optouts")}>
        Opt-outs
      </Link>
    </div>
  );
}

export default async function AdminPlatformCampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePermission("campaigns.view");
  const params = await searchParams;
  const tab = params.tab === "optouts" ? "optouts" : "campanhas";

  if (tab === "campanhas") {
    return (
      <div className="space-y-4">
        <CampaignTabs active="campanhas" />
        <CampaignsManager
          apiBase="/api/admin/campaigns"
          backHref="/admin"
          scopeLabel="pra toda a base de atletas da plataforma"
          allowManualRecipients
        />
      </div>
    );
  }

  const q = params.q?.trim() || undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const { rows, total, totalPages } = await listOptedOutAthletes({ q, page });

  const pageHref = (p: number) => {
    const query = new URLSearchParams({ tab: "optouts" });
    if (q) query.set("q", q);
    query.set("page", String(p));
    return `/admin/campanhas?${query.toString()}`;
  };
  const pagerButtonClass = (disabledOrInactive: boolean, active = false) =>
    `text-sm px-3 py-1.5 rounded-lg border transition-colors ${
      active
        ? "bg-primary-600 text-white border-primary-600"
        : disabledOrInactive
          ? "pointer-events-none border-gray-200 text-gray-300 dark:border-gray-700 dark:text-gray-600"
          : "border-gray-300 hover:border-primary-400 hover:text-primary-600 dark:border-gray-600 dark:text-gray-200 dark:hover:border-primary-500"
    }`;

  return (
    <div className="space-y-4">
      <CampaignTabs active="optouts" />
      <div>
        <h1 className="text-xl font-bold">Atletas que optaram por não receber mensagens</h1>
        <p className="text-sm text-gray-500">{total} atleta(s) encontrado(s)</p>
      </div>

      <form method="GET" className="card flex gap-2">
        <input type="hidden" name="tab" value="optouts" />
        <input name="q" defaultValue={q ?? ""} placeholder="Nome, e-mail ou telefone" className="input-field text-sm py-1.5 flex-1" />
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        <Link href="/admin/campanhas?tab=optouts" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100 dark:border-gray-800">
              <th className="py-2 pr-4">Nome</th>
              <th className="py-2 pr-4">E-mail</th>
              <th className="py-2 pr-4">Telefone</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-6 text-center text-gray-400">Nenhum atleta encontrado.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-gray-900">
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2 pr-4">{r.email}</td>
                  <td className="py-2 pr-4">{r.phone ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-end">
          <nav className="flex items-center justify-end gap-1.5 flex-wrap" aria-label="Paginação">
            <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page === 1} className={pagerButtonClass(page === 1)}>
              ‹ Anterior
            </Link>
            {getPaginationRange(page, totalPages).map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-1 text-sm text-gray-400 select-none">…</span>
              ) : (
                <Link key={p} href={pageHref(p)} className={pagerButtonClass(false, p === page)}>{p}</Link>
              ),
            )}
            <Link
              href={pageHref(Math.min(totalPages, page + 1))}
              aria-disabled={page === totalPages}
              className={pagerButtonClass(page === totalPages)}
            >
              Próxima ›
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
