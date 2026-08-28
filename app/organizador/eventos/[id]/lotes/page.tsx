import { requireAnyPermission } from "@/lib/auth/rbac";
import LotesClient from "./LotesClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["batches.create", "batches.edit", "batches.delete"], { eventId: id });
  return <LotesClient />;
}
