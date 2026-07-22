import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { getAppName } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Script do Google AdSense agora carrega no layout raiz (app/layout.tsx), sitewide — precisa
  // estar em toda página, não só nas públicas (exigência do próprio Google pra verificação do
  // site), e via strategy="beforeInteractive" pra aparecer no HTML inicial.
  const appName = await getAppName();

  return (
    <div className="flex flex-col min-h-screen">
      <Header appName={appName} />
      <div className="flex-1">{children}</div>
      <Footer appName={appName} />
    </div>
  );
}
