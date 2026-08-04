import Link from "next/link";
import { getSetting } from "@/lib/settings";
import { buildSocialLinks, SOCIAL_NETWORK_KEYS } from "@/lib/social-links";
import { SOCIAL_ICON_BY_KEY } from "./SocialIcons";

export default async function Footer({ appName }: { appName: string }) {
  const values = Object.fromEntries(
    await Promise.all(SOCIAL_NETWORK_KEYS.map(async (key) => [key, await getSetting(key)] as const)),
  );
  const socialLinks = buildSocialLinks(values);

  return (
    <footer className="bg-gray-900 text-gray-400 mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          <div>
            <p className="text-white font-bold text-lg mb-2">🏃 {appName}</p>
            <p className="text-sm">Plataforma de inscrições para corridas de rua, trail run e eventos esportivos.</p>
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-3 mt-4">
                {socialLinks.map((link) => {
                  const Icon = SOCIAL_ICON_BY_KEY[link.key];
                  return (
                    <Link
                      key={link.key}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.label}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      <Icon className="w-5 h-5" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <p className="text-white font-medium mb-3">Links úteis</p>
            <ul className="space-y-2 text-sm">
              <li><Link href="/eventos" className="hover:text-white transition-colors">Ver eventos</Link></li>
              <li><Link href="/auth/cadastro" className="hover:text-white transition-colors">Criar conta</Link></li>
              <li><Link href="/auth/login" className="hover:text-white transition-colors">Entrar</Link></li>
              <li><Link href="/anuncie" className="hover:text-white transition-colors">Anuncie no site</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-white font-medium mb-3">Legal</p>
            <ul className="space-y-2 text-sm">
              <li><Link href="/termos" className="hover:text-white transition-colors">Termos de Uso</Link></li>
              <li><Link href="/privacidade" className="hover:text-white transition-colors">Política de Privacidade</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 pt-6 text-center text-xs">
          © {new Date().getFullYear()} {appName}. Todos os direitos reservados.
        </div>
      </div>
    </footer>
  );
}
