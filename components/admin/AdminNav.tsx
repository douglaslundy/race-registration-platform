"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export default function AdminNav() {
  return (
    <nav className="bg-gray-900 text-white px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6 text-sm">
          <Link href="/admin" className="font-bold text-yellow-400">Admin</Link>
          <Link href="/admin/eventos" className="hover:text-gray-300">Eventos</Link>
          <Link href="/admin/usuarios" className="hover:text-gray-300">Usuários</Link>
          <Link href="/admin/pagamentos" className="hover:text-gray-300">Pagamentos</Link>
          <Link href="/admin/repasses" className="hover:text-gray-300">Repasses</Link>
          <Link href="/admin/relatorio" className="hover:text-gray-300">Relatório</Link>
          <Link href="/admin/auditoria" className="hover:text-gray-300">Auditoria</Link>
          <Link href="/admin/configuracoes" className="hover:text-gray-300">Config.</Link>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/" })} className="text-sm text-gray-400 hover:text-white">
          Sair
        </button>
      </div>
    </nav>
  );
}
