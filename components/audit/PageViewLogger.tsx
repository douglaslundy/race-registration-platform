"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PageViewLogger() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    fetch("/api/audit/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
    }).catch(() => {
      // Registro de auditoria é best-effort; falha de rede não deve afetar a navegação.
    });
  }, [pathname]);

  return null;
}
