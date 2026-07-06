import { requireAuth } from "@/lib/auth/rbac";
import { getAppName } from "@/lib/settings";

export default async function CompletarCadastroLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const appName = await getAppName();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        <p className="text-center text-sm font-semibold text-primary-700 dark:text-primary-400">{appName}</p>
        {children}
      </div>
    </div>
  );
}
