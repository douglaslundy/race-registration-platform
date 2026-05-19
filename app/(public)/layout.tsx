import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { getAppName } from "@/lib/settings";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const appName = await getAppName();
  return (
    <div className="flex flex-col min-h-screen">
      <Header appName={appName} />
      <div className="flex-1">{children}</div>
      <Footer appName={appName} />
    </div>
  );
}
