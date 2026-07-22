"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState } from "react";
import ThemeToggle from "./ThemeToggle";
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";

export default function Header({ appName }: { appName: string }) {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const dashboardLink =
    session?.user?.role === "ADMIN"
      ? "/admin"
      : session?.user?.role === "ORGANIZER"
      ? "/organizador"
      : "/dashboard";

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl text-primary-700 dark:text-primary-400 flex items-center gap-2">
          🏃 {appName}
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600 dark:text-gray-300">
          <Link href="/eventos" className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors">Eventos</Link>
          {session?.user && (
            <Link href={dashboardLink} className="hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
              Minha Área
            </Link>
          )}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <ThemeToggle />
          {session?.user ? (
            <div className="flex items-center gap-3 ml-1">
              <span className="text-sm text-gray-600 dark:text-gray-400">{session.user.name?.split(" ")[0]}</span>
              <button onClick={signOutAndClearNudge} className="btn-secondary text-sm px-3 py-1.5">
                Sair
              </button>
            </div>
          ) : (
            <>
              <Link href="/auth/login" className="btn-secondary text-sm px-4 py-1.5">Entrar</Link>
              <Link href="/auth/cadastro" className="btn-primary text-sm px-4 py-1.5">Cadastrar</Link>
            </>
          )}
        </div>

        <div className="md:hidden flex items-center gap-2">
          <ThemeToggle />
          <button
            className="p-2 text-gray-600 dark:text-gray-400"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menu"
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4 space-y-3 text-sm">
          <Link href="/eventos" className="block py-2 text-gray-700 dark:text-gray-300" onClick={() => setMenuOpen(false)}>Eventos</Link>
          {session?.user ? (
            <>
              <Link href={dashboardLink} className="block py-2 text-gray-700 dark:text-gray-300" onClick={() => setMenuOpen(false)}>Minha Área</Link>
              <button onClick={signOutAndClearNudge} className="block py-2 text-red-600 dark:text-red-400 w-full text-left">Sair</button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="block py-2 text-gray-700 dark:text-gray-300" onClick={() => setMenuOpen(false)}>Entrar</Link>
              <Link href="/auth/cadastro" className="block py-2 text-primary-600 dark:text-primary-400 font-medium" onClick={() => setMenuOpen(false)}>Cadastrar</Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
