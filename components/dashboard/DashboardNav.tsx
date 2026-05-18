"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const NAV_LINKS = [
  { href: "/dashboard", label: "Início", exact: true },
  { href: "/dashboard/inscricoes", label: "Inscrições" },
  { href: "/dashboard/pagamentos", label: "Pagamentos" },
  { href: "/dashboard/perfil", label: "Perfil" },
];

export default function DashboardNav({ userName, userRole }: { userName: string; userRole: string }) {
  const pathname = usePathname();

  return (
    <nav className="bg-white border-b">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-1">
            <Link href="/" className="font-bold text-primary-700 mr-4 text-sm">🏃 Corridas App</Link>
            {NAV_LINKS.map((l) => {
              const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    active ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500 hidden sm:block">{userName}</span>
            {(userRole === "ADMIN" || userRole === "ORGANIZER") && (
              <Link
                href={userRole === "ADMIN" ? "/admin" : "/organizador"}
                className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded font-medium"
              >
                {userRole === "ADMIN" ? "Admin" : "Organizador"}
              </Link>
            )}
            <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
              Sair
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
