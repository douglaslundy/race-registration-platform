import { requireAnyPermission } from "@/lib/auth/rbac";
import RedesSociaisClient from "./RedesSociaisClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["social-links.view", "social-links.create", "social-links.edit", "social-links.delete"], { eventId: id });
  return <RedesSociaisClient />;
}
