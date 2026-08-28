import { requireAnyPermission } from "@/lib/auth/rbac";
import PatrocinioClient from "./PatrocinioClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["sponsors.view", "sponsors.create", "sponsors.edit", "sponsors.delete"], { eventId: id });
  return <PatrocinioClient />;
}
