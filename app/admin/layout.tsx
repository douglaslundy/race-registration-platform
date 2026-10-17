import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth/rbac";
import { adminNavHrefs, resolveAdminAccess } from "@/lib/auth/admin-access";
import AdminNav from "@/components/admin/AdminNav";
import PageViewLogger from "@/components/audit/PageViewLogger";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (!(await resolveAdminAccess(session, pathname))) redirect("/acesso-negado");
  const allowedHrefs = await adminNavHrefs(session);
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      <PageViewLogger />
      <AdminNav allowedHrefs={allowedHrefs} />
      <div className="max-w-7xl mx-auto px-4 py-8 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}
