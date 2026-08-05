import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { getAppName, getSetting } from "@/lib/settings";
import { buildSocialLinks, SOCIAL_NETWORK_KEYS } from "@/lib/social-links";

export const dynamic = "force-dynamic";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Script do Google AdSense agora carrega no layout raiz (app/layout.tsx), sitewide — precisa
  // estar em toda página, não só nas públicas (exigência do próprio Google pra verificação do
  // site), e via strategy="beforeInteractive" pra aparecer no HTML inicial.
  const [appName, socialValues] = await Promise.all([
    getAppName(),
    Promise.all(SOCIAL_NETWORK_KEYS.map(async (key) => [key, await getSetting(key)] as const)),
  ]);
  const socialLinks = buildSocialLinks(Object.fromEntries(socialValues), appName);

  return (
    <div className="flex flex-col min-h-screen">
      <Header appName={appName} socialLinks={socialLinks} />
      <div className="flex-1">{children}</div>
      <Footer appName={appName} socialLinks={socialLinks} />
    </div>
  );
}
