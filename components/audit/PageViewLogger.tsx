"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function PageViewLogger() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    const body = JSON.stringify({ path: pathname });

    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const sent = navigator.sendBeacon("/api/audit/pageview", blob);
      if (sent) return;
    }

    // Fallback pra navegadores sem sendBeacon (raro) ou se o envio foi recusado.
    fetch("/api/audit/pageview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {
      // Registro de auditoria é best-effort; falha de rede não deve afetar a navegação.
    });
  }, [pathname]);

  return null;
}
