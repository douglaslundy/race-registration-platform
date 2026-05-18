import type { Metadata } from "next";
import "./globals.css";
import SessionProvider from "@/components/layout/SessionProvider";

export const metadata: Metadata = {
  title: {
    default: "Corridas App — Inscrições Esportivas",
    template: "%s | Corridas App",
  },
  description: "Plataforma de inscrições para corridas de rua, trail run, ciclismo e mais.",
  keywords: ["corridas", "inscrições", "corrida de rua", "trail run", "esportes"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
