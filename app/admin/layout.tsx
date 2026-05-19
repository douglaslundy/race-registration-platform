import { requireAdmin } from "@/lib/auth/rbac";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      <AdminNav />
      <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
