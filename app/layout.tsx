import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";
import Providers from "@/components/layout/Providers";
import { getAppName, getSetting } from "@/lib/settings";

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tag de verificação/carregamento do Google AdSense — precisa estar presente em toda página
  // do site (exigência do próprio Google), em texto puro no HTML inicial, não injetada via JS
  // depois do carregamento (o crawler de verificação do AdSense não executa JavaScript).
  // strategy="beforeInteractive" no layout raiz garante isso.
  const adSenseClientId = await getSetting("google_adsense_client_id");

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        {adSenseClientId && (
          <Script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adSenseClientId}`}
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
