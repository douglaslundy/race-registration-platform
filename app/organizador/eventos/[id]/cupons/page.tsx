import { requireAnyPermission } from "@/lib/auth/rbac";
import CuponsClient from "./CuponsClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["coupons.view", "coupons.create", "coupons.edit", "coupons.delete"], { eventId: id });
  return <CuponsClient />;
}
