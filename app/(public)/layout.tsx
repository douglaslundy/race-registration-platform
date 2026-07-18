import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { getAppName } from "@/lib/settings";
import { hasActiveGoogleAdSlot } from "@/lib/ad-slots";
import { getSetting } from "@/lib/settings";
import Script from "next/script";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [appName, showAdSenseScript, clientId] = await Promise.all([
    getAppName(),
    hasActiveGoogleAdSlot(),
    getSetting("google_adsense_client_id"),
  ]);

  return (
    <div className="flex flex-col min-h-screen">
      {showAdSenseScript && clientId && (
        <Script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      )}
      <Header appName={appName} />
      <div className="flex-1">{children}</div>
      <Footer appName={appName} />
    </div>
  );
}
