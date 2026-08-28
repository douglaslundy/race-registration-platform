import { requireAnyPermission } from "@/lib/auth/rbac";
import PercursosClient from "./PercursosClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["routes.create", "routes.edit", "routes.delete"], { eventId: id });
  return <PercursosClient />;
}
