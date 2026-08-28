import { requireAnyPermission } from "@/lib/auth/rbac";
import ResultadosClient from "./ResultadosClient";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAnyPermission(["results.import", "results.publish"], { eventId: id });
  return <ResultadosClient />;
}
