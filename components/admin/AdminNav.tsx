"use client";

import Link from "next/link";
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
import ThemeToggle from "@/components/layout/ThemeToggle";

export default function AdminNav() {
  return (
    <nav className="bg-gray-900 dark:bg-gray-950 text-white px-4 py-3 border-b border-gray-800 print:hidden">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Link href="/admin" className="font-bold text-yellow-400">Dashboard</Link>
          <Link href="/admin/eventos" className="hover:text-gray-300">Eventos</Link>
          <Link href="/admin/usuarios" className="hover:text-gray-300">Usuários</Link>
          <Link href="/admin/pagamentos" className="hover:text-gray-300">Pagamentos</Link>
          <Link href="/admin/pedidos-vencidos" className="hover:text-gray-300">Pedidos vencidos</Link>
          <Link href="/admin/carrinhos-abandonados" className="hover:text-gray-300">Carrinhos abandonados</Link>
          <Link href="/admin/reembolsos-pendentes" className="hover:text-gray-300">Cancelamentos pendentes</Link>
          <Link href="/admin/cupons" className="hover:text-gray-300">Cupons</Link>
          <Link href="/admin/repasses" className="hover:text-gray-300">Repasses</Link>
          <Link href="/admin/relatorio" className="hover:text-gray-300">Relatório</Link>
          <Link href="/admin/conciliacao" className="hover:text-gray-300">Conciliação</Link>
          <Link href="/admin/auditoria" className="hover:text-gray-300">Auditoria</Link>
          <Link href="/admin/whatsapp" className="hover:text-gray-300">WhatsApp</Link>
          <Link href="/admin/alertas" className="hover:text-gray-300">Alertas</Link>
          <Link href="/admin/mensagens" className="hover:text-gray-300">Mensagens</Link>
          <Link href="/admin/anuncios" className="hover:text-gray-300">Anúncios</Link>
          <Link href="/admin/anunciantes/solicitacoes" className="hover:text-gray-300">Solicitações</Link>
          <Link href="/admin/seo" className="hover:text-gray-300">SEO</Link>
          <Link href="/admin/configuracoes" className="hover:text-gray-300">Config.</Link>
          <Link href="/admin/conteudo-legal" className="hover:text-gray-300">Legal</Link>
          <Link href="/admin/backup" className="hover:text-gray-300">Backup</Link>
          <Link href="/admin/assistentes" className="hover:text-gray-300">Assistentes</Link>
          <Link href="/admin/perfil" className="hover:text-gray-300">Meus Dados</Link>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/eventos"
            className="text-xs bg-blue-900/40 text-blue-300 hover:bg-blue-900/60 px-2 py-1 rounded font-medium"
          >
            Área do atleta
          </Link>
          <ThemeToggle className="text-gray-400 hover:text-white hover:bg-gray-800" />
          <button onClick={signOutAndClearNudge} className="text-sm text-gray-400 hover:text-white">
            Sair
          </button>
        </div>
      </div>
    </nav>
  );
}
