import { requireAuth } from "@/lib/auth/rbac";
import DashboardNav from "@/components/dashboard/DashboardNav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth();
  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardNav userName={session.user.name} userRole={session.user.role} />
      <div className="max-w-5xl mx-auto px-4 py-8">{children}</div>
    </div>
  );
}
