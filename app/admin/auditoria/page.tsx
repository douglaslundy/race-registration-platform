import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Auditoria — Admin" };

import { BADGE } from "@/lib/badge-colors";

const ACTION_COLOR: Record<string, string> = {
  EVENT_CREATED:          BADGE.blue,
  EVENT_UPDATED:          BADGE.yellow,
  EVENT_CANCELLED:        BADGE.red,
  REGISTRATION_CANCELLED: BADGE.red,
  USER_ROLE_CHANGED:      BADGE.purple,
  USER_DEACTIVATED:       BADGE.red,
  USER_ACTIVATED:         BADGE.green,
  CHECKOUT_COMPLETED:     BADGE.green,
};

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; userId?: string; page?: string }>;
}) {
  await requireAdmin();
  const { action, entity, userId, page: pageStr } = await searchParams;
  const page = parseInt(pageStr ?? "1");
  const pageSize = 50;

  const where = {
    ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
    ...(entity ? { entityType: entity } : {}),
    ...(userId ? { userId } : {}),
  };

  const [logs, total, distinctActions] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { name: true, email: true } },
      },
    }),
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      select: { action: true },
      distinct: ["action"],
      orderBy: { action: "asc" },
    }),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  const buildUrl = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { action, entity, userId, page: "1", ...overrides };
    for (const [k, v] of Object.entries(merged)) {
      if (v) params.set(k, v);
    }
    return `/admin/auditoria?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Log de Auditoria</h1>
        <span className="text-sm text-gray-500">{total} registros</span>
      </div>

      <form method="GET" className="card flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Ação</label>
          <select name="action" defaultValue={action ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {distinctActions.map((a) => (
              <option key={a.action} value={a.action}>{a.action}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Entidade</label>
          <select name="entity" defaultValue={entity ?? ""} className="input-field text-sm py-1.5">
            <option value="">Todas</option>
            {["Event", "Registration", "User", "Order", "Payment"].map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">User ID</label>
          <input
            name="userId"
            defaultValue={userId ?? ""}
            placeholder="cuid..."
            className="input-field text-sm py-1.5 w-48"
          />
        </div>
        <button type="submit" className="btn-primary py-1.5 px-4 text-sm">Filtrar</button>
        <Link href="/admin/auditoria" className="btn-secondary py-1.5 px-4 text-sm">Limpar</Link>
      </form>

      {logs.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">Nenhum registro encontrado.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b text-xs uppercase">
                <th className="pb-2 pr-4">Data</th>
                <th className="pb-2 pr-4">Usuário</th>
                <th className="pb-2 pr-4">Ação</th>
                <th className="pb-2 pr-4">Entidade</th>
                <th className="pb-2">ID da entidade</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-xs text-gray-400 whitespace-nowrap">
                    {log.createdAt.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-4">
                    {log.user ? (
                      <Link href={`/admin/usuarios/${log.userId}`} className="hover:underline text-primary-700">
                        {log.user.name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">Sistema</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLOR[log.action] ?? BADGE.gray}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-gray-600">{log.entityType}</td>
                  <td className="py-2 font-mono text-xs text-gray-500 truncate max-w-[12rem]">{log.entityId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 justify-center flex-wrap">
          {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={buildUrl({ page: String(p) })}
              className={`text-sm px-3 py-1.5 rounded-lg border ${p === page ? "bg-primary-600 text-white" : "border-gray-300 hover:border-primary-400"}`}
            >
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
