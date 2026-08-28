import { requireAnyPermission } from "@/lib/auth/rbac";
import CategoriasClient from "./CategoriasClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["categories.create", "categories.edit", "categories.delete"], { eventId: id });
  return <CategoriasClient />;
}
