"use client";

import Link from "next/link";
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
import ThemeToggle from "@/components/layout/ThemeToggle";

export default function AdvertiserNav({ userName, appName }: { userName: string; appName: string }) {
  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold text-primary-700 dark:text-primary-400">{appName}</Link>
          <div className="hidden md:flex items-center gap-4 text-sm">
            <Link href="/anunciante" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
            <Link href="/anunciante/planos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Planos</Link>
            <Link href="/anunciante/anuncios" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Anúncios</Link>
            <Link href="/anunciante/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Dados</Link>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">{userName}</span>
          <ThemeToggle />
          <button onClick={signOutAndClearNudge} className="btn-secondary text-xs px-3 py-1">
            Sair
          </button>
        </div>
      </div>
      <div className="md:hidden border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-sm">
          <Link href="/anunciante" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
          <Link href="/anunciante/planos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Planos</Link>
          <Link href="/anunciante/anuncios" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Anúncios</Link>
          <Link href="/anunciante/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Dados</Link>
        </div>
      </div>
    </nav>
  );
}
