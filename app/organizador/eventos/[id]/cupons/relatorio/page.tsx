import { requireOrganizer } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Relatório de Cupons" };
export const dynamic = "force-dynamic";

export default async function CuponsRelatorioPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireOrganizer();
  const { id } = await params;

  const event = await db.event.findFirst({
    where: { id, organizer: { userId: session.user.id } },
    select: { id: true, title: true },
  });
  if (!event) notFound();

  const coupons = await db.coupon.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      code: true,
      discountType: true,
      discountValue: true,
      maxUses: true,
      usedCount: true,
      expiresAt: true,
      active: true,
    },
  });

  const couponIds = coupons.map((c) => c.id);

  const orders = couponIds.length
    ? await db.order.findMany({
        where: { eventId: id, couponId: { in: couponIds }, status: "PAID" },
        select: {
          id: true,
          couponId: true,
          discountAmount: true,
          totalAmount: true,
          createdAt: true,
          buyer: { select: { name: true, email: true } },
          registrations: {
            select: {
              id: true,
              status: true,
              route: { select: { name: true } },
              category: { select: { name: true } },
              ticketBatch: { select: { name: true } },
            },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const ordersByCoupon = new Map<string, typeof orders>();
  for (const order of orders) {
    if (!order.couponId) continue;
    const list = ordersByCoupon.get(order.couponId) ?? [];
    list.push(order);
    ordersByCoupon.set(order.couponId, list);
  }

  const totalDiscountAll = orders.reduce((s, o) => s + o.discountAmount, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <Link href={`/organizador/eventos/${id}/cupons`} className="text-sm text-gray-500 hover:text-primary-600">
          ← Voltar aos cupons
        </Link>
        <h1 className="text-xl font-bold mt-1">Relatório de cupons</h1>
        <p className="text-sm text-gray-500">{event.title}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-primary-600">{coupons.length}</p>
          <p className="text-gray-500 text-sm mt-1">Cupons criados</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-green-600">{orders.length}</p>
          <p className="text-gray-500 text-sm mt-1">Pedidos com cupom</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-orange-600">{formatCurrency(totalDiscountAll)}</p>
          <p className="text-gray-500 text-sm mt-1">Total de desconto concedido</p>
        </div>
      </div>

      {coupons.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">Nenhum cupom criado para este evento.</div>
      ) : (
        <div className="space-y-6">
          {coupons.map((coupon) => {
            const couponOrders = ordersByCoupon.get(coupon.id) ?? [];
            const totalDiscount = couponOrders.reduce((s, o) => s + o.discountAmount, 0);
            const discountLabel = coupon.discountType === "PERCENT"
              ? `${coupon.discountValue}% de desconto`
              : `${formatCurrency(coupon.discountValue)} de desconto`;

            return (
              <div key={coupon.id} className="card space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-lg">{coupon.code}</span>
                      {!coupon.active && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          inativo
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {discountLabel}
                      {coupon.maxUses ? ` · Limite: ${coupon.maxUses} usos` : " · Ilimitado"}
                      {coupon.expiresAt && ` · Expira ${new Date(coupon.expiresAt).toLocaleDateString("pt-BR")}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-green-700 dark:text-green-400">
                      {formatCurrency(totalDiscount)} concedidos
                    </p>
                    <p className="text-xs text-gray-500">{couponOrders.length} uso{couponOrders.length !== 1 ? "s" : ""}</p>
                  </div>
                </div>

                {couponOrders.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">Nenhum uso registrado ainda.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase text-gray-500 border-b dark:border-gray-700">
                          <th className="pb-2 pr-4">Atleta</th>
                          <th className="pb-2 pr-4">E-mail</th>
                          <th className="pb-2 pr-4">Lote</th>
                          <th className="pb-2 pr-4">Percurso / Categoria</th>
                          <th className="pb-2 pr-4 text-right">Desconto</th>
                          <th className="pb-2 text-right">Total pago</th>
                        </tr>
                      </thead>
                      <tbody>
                        {couponOrders.map((order) => {
                          const reg = order.registrations[0];
                          return (
                            <tr key={order.id} className="border-b dark:border-gray-700 last:border-0">
                              <td className="py-2 pr-4 font-medium">{order.buyer.name}</td>
                              <td className="py-2 pr-4 text-gray-500 text-xs">{order.buyer.email}</td>
                              <td className="py-2 pr-4 text-gray-600">{reg?.ticketBatch.name ?? "—"}</td>
                              <td className="py-2 pr-4 text-gray-600 text-xs">
                                {[reg?.route?.name, reg?.category?.name].filter(Boolean).join(" · ") || "—"}
                              </td>
                              <td className="py-2 pr-4 text-right text-green-700 dark:text-green-400 font-medium">
                                {formatCurrency(order.discountAmount)}
                              </td>
                              <td className="py-2 text-right font-medium">{formatCurrency(order.totalAmount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t dark:border-gray-600">
                          <td colSpan={4} className="pt-2 text-xs text-gray-500">Total</td>
                          <td className="pt-2 text-right font-semibold text-green-700 dark:text-green-400">
                            {formatCurrency(totalDiscount)}
                          </td>
                          <td className="pt-2 text-right font-semibold">
                            {formatCurrency(couponOrders.reduce((s, o) => s + o.totalAmount, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
