import type { Metadata } from "next";
import "./globals.css";
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
  // do site como texto puro no HTML inicial, não injetada via JS depois do carregamento (o
  // crawler de verificação do AdSense não executa JavaScript). O componente <Script> do
  // next/script, mesmo com strategy="beforeInteractive", só emite um <link rel="preload"> no
  // HTML e monta a <script> de verdade via hidratação no navegador — confirmado direto no HTML
  // servido em produção, não aparecia nenhuma tag <script> literal. Por isso aqui é uma tag
  // <script> nativa, escrita à mão dentro de um <head> explícito, sem passar pelo next/script.
  const adSenseClientId = await getSetting("google_adsense_client_id");

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {adSenseClientId && (
          <script
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adSenseClientId}`}
            crossOrigin="anonymous"
          />
        )}
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
