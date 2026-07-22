"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";

const NAV_LINKS = [
  { href: "/dashboard", label: "Início", exact: true },
  { href: "/dashboard/inscricoes", label: "Inscrições" },
  { href: "/dashboard/pagamentos", label: "Pagamentos" },
  { href: "/dashboard/perfil", label: "Meus Dados" },
];

export default function DashboardNav({
  userName,
  userRole,
  appName,
}: {
  userName: string;
  userRole: string;
  appName: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-1 min-w-0">
            <Link href="/" className="font-bold text-primary-700 dark:text-primary-400 mr-4 text-sm whitespace-nowrap">🏃 {appName}</Link>
            <div className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((l) => {
                const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                        : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                    }`}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm shrink-0">
            <span className="text-gray-500 dark:text-gray-400 hidden sm:block">{userName}</span>
            {(userRole === "ADMIN" || userRole === "ORGANIZER") && (
              <Link
                href={userRole === "ADMIN" ? "/admin" : "/organizador"}
                className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-2 py-1 rounded font-medium"
              >
                {userRole === "ADMIN" ? "Admin" : "Organizador"}
              </Link>
            )}
            <ThemeToggle />
            <button onClick={signOutAndClearNudge} className="btn-secondary text-xs px-3 py-1">
              Sair
            </button>
          </div>
        </div>
        <div className="md:hidden flex flex-wrap gap-1 pb-2">
          {NAV_LINKS.map((l) => {
            const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                    : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
