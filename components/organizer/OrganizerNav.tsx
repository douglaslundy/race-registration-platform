"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import ThemeToggle from "@/components/layout/ThemeToggle";

export default function OrganizerNav({ userName, appName }: { userName: string; appName: string }) {
  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold text-primary-700 dark:text-primary-400">{appName}</Link>
          <div className="hidden md:flex items-center gap-4 text-sm">
            <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
            <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
            <Link href="/organizador/relatorio" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Relatório</Link>
            <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
            <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Dados</Link>
            <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
            <Link href="/organizador/pedidos-vencidos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Pedidos vencidos</Link>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">{userName}</span>
          <Link
            href="/eventos"
            className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-1 rounded font-medium"
          >
            Área do atleta
          </Link>
          <ThemeToggle />
          <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
            Sair
          </button>
        </div>
      </div>
      <div className="md:hidden border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-sm">
          <Link href="/organizador" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Dashboard</Link>
          <Link href="/organizador#meus-eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Eventos</Link>
          <Link href="/organizador/relatorio" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Relatório</Link>
          <Link href="/organizador/eventos/novo" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Novo Evento</Link>
          <Link href="/organizador/perfil" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Meus Dados</Link>
          <Link href="/organizador/conciliacao" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Conciliação</Link>
          <Link href="/organizador/pedidos-vencidos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Pedidos vencidos</Link>
          <Link href="/eventos" className="text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400">Área do atleta</Link>
        </div>
      </div>
    </nav>
  );
}
