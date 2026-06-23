import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/layout/Providers";
import { getAppName } from "@/lib/settings";

export async function generateMetadata(): Promise<Metadata> {
  const appName = await getAppName();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    metadataBase: new URL(appUrl),
    title: {
      default: `${appName} — Inscrições Esportivas`,
      template: `%s | ${appName}`,
    },
    description: "Plataforma de inscrições para corridas de rua, trail run, ciclismo e mais.",
    keywords: ["corridas", "inscrições", "corrida de rua", "trail run", "esportes"],
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
