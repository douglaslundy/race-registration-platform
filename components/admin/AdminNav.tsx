"use client";

import Link from "next/link";
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
import ThemeToggle from "@/components/layout/ThemeToggle";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/eventos", label: "Eventos" },
  { href: "/admin/entrega-kits", label: "Entrega de kits" },
  { href: "/admin/usuarios", label: "Usuários" },
  { href: "/admin/pagamentos", label: "Pagamentos" },
  { href: "/admin/pedidos-vencidos", label: "Pedidos vencidos" },
  { href: "/admin/carrinhos-abandonados", label: "Carrinhos abandonados" },
  { href: "/admin/reembolsos-pendentes", label: "Cancelamentos pendentes" },
  { href: "/admin/cupons", label: "Cupons" },
  { href: "/admin/repasses", label: "Repasses" },
  { href: "/admin/relatorio", label: "Relatório" },
  { href: "/admin/conciliacao", label: "Conciliação" },
  { href: "/admin/auditoria", label: "Auditoria" },
  { href: "/admin/whatsapp", label: "WhatsApp" },
  { href: "/admin/alertas", label: "Alertas" },
  { href: "/admin/mensagens", label: "Mensagens" },
  { href: "/admin/campanhas", label: "Campanhas" },
  { href: "/admin/anuncios", label: "Anúncios" },
  { href: "/admin/anunciantes/solicitacoes", label: "Solicitações" },
  { href: "/admin/seo", label: "SEO" },
  { href: "/admin/configuracoes", label: "Config." },
  { href: "/admin/conteudo-legal", label: "Legal" },
  { href: "/admin/backup", label: "Backup" },
  { href: "/admin/assistentes", label: "Assistentes" },
  { href: "/admin/perfil", label: "Meus Dados" },
];

/** `allowedHrefs`: null = todos (ADMIN titular); lista = só esses itens (assistente). */
export default function AdminNav({ allowedHrefs }: { allowedHrefs: string[] | null }) {
  return (
    <nav className="bg-gray-900 dark:bg-gray-950 text-white px-4 py-3 border-b border-gray-800 print:hidden">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {LINKS.filter((l) => !allowedHrefs || allowedHrefs.includes(l.href)).map((l) => (
            <Link key={l.href} href={l.href} className={l.href === "/admin" ? "font-bold text-yellow-400" : "hover:text-gray-300"}>
              {l.label}
            </Link>
          ))}
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
