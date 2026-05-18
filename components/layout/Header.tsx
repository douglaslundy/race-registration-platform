"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";

export default function Header() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const dashboardLink =
    session?.user?.role === "ADMIN"
      ? "/admin"
      : session?.user?.role === "ORGANIZER"
      ? "/organizador"
      : "/dashboard";

  return (
    <header className="bg-white border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="font-bold text-xl text-primary-700 flex items-center gap-2">
          🏃 Corridas App
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
          <Link href="/eventos" className="hover:text-primary-600 transition-colors">Eventos</Link>
          {session?.user && (
            <Link href={dashboardLink} className="hover:text-primary-600 transition-colors">
              Minha Área
            </Link>
          )}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">{session.user.name?.split(" ")[0]}</span>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="btn-secondary text-sm px-3 py-1.5"
              >
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

        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Menu"
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && (
        <div className="md:hidden border-t bg-white px-4 py-4 space-y-3 text-sm">
          <Link href="/eventos" className="block py-2 text-gray-700" onClick={() => setMenuOpen(false)}>Eventos</Link>
          {session?.user ? (
            <>
              <Link href={dashboardLink} className="block py-2 text-gray-700" onClick={() => setMenuOpen(false)}>Minha Área</Link>
              <button onClick={() => signOut({ callbackUrl: "/" })} className="block py-2 text-red-600 w-full text-left">Sair</button>
            </>
          ) : (
            <>
              <Link href="/auth/login" className="block py-2 text-gray-700" onClick={() => setMenuOpen(false)}>Entrar</Link>
              <Link href="/auth/cadastro" className="block py-2 text-primary-600 font-medium" onClick={() => setMenuOpen(false)}>Cadastrar</Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
