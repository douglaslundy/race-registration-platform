"use client";

import Link from "next/link";
import { signOutAndClearNudge } from "@/components/dashboard/ProfileCompletionNudge";
import ThemeToggle from "@/components/layout/ThemeToggle";
import type { OrganizerNavItem } from "@/lib/auth/organizer-access";

const LINK_CLS =
  "text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400";

export default function OrganizerNav({
  userName,
  appName,
  items,
}: {
  userName: string;
  appName: string;
  items: OrganizerNavItem[];
}) {
  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3 print:hidden">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold text-primary-700 dark:text-primary-400">{appName}</Link>
          <div className="hidden md:flex items-center gap-4 text-sm">
            {items.map((item) => (
              <Link key={item.href} href={item.href} className={LINK_CLS}>{item.label}</Link>
            ))}
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
          <button onClick={signOutAndClearNudge} className="btn-secondary text-xs px-3 py-1">
            Sair
          </button>
        </div>
      </div>
      <div className="md:hidden border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-4 text-sm">
          {items.map((item) => (
            <Link key={item.href} href={item.href} className={LINK_CLS}>{item.label}</Link>
          ))}
          <Link href="/eventos" className={LINK_CLS}>Área do atleta</Link>
        </div>
      </div>
    </nav>
  );
}
