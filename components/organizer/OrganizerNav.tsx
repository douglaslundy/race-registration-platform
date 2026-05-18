"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

export default function OrganizerNav({ userName }: { userName: string }) {
  return (
    <nav className="bg-white border-b px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold text-primary-700">Corridas App</Link>
          <div className="hidden md:flex items-center gap-4 text-sm">
            <Link href="/organizador" className="text-gray-700 hover:text-primary-600">Dashboard</Link>
            <Link href="/organizador/eventos/novo" className="text-gray-700 hover:text-primary-600">Novo Evento</Link>
            <Link href="/organizador/perfil" className="text-gray-700 hover:text-primary-600">Perfil</Link>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-600">{userName}</span>
          <button onClick={() => signOut({ callbackUrl: "/" })} className="btn-secondary text-xs px-3 py-1">
            Sair
          </button>
        </div>
      </div>
    </nav>
  );
}
