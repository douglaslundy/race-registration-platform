import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/rbac";
import { getLegalTerms, getLegalPrivacy } from "@/lib/settings";
import LegalContentForm from "@/components/admin/LegalContentForm";
import { DEFAULT_LEGAL_PRIVACY, DEFAULT_LEGAL_TERMS, LEGAL_CONTENT_UPDATED_AT } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Conteúdo Legal — Admin" };
export const dynamic = "force-dynamic";

export default async function ConteudoLegalPage() {
  await requireAdmin();
  const [terms, privacy] = await Promise.all([getLegalTerms(), getLegalPrivacy()]);

  const termsContent = terms.content || DEFAULT_LEGAL_TERMS;
  const termsUpdatedAt = terms.updatedAt || LEGAL_CONTENT_UPDATED_AT;
  const privacyContent = privacy.content || DEFAULT_LEGAL_PRIVACY;
  const privacyUpdatedAt = privacy.updatedAt || LEGAL_CONTENT_UPDATED_AT;

  return (
    <div className="space-y-8 max-w-4xl">
      <h1 className="text-2xl font-bold dark:text-gray-100">Conteúdo Legal</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Edite os textos exibidos nas páginas públicas de Termos de Uso e Política de Privacidade.
        O conteúdo é salvo no banco de dados e exibido imediatamente.
      </p>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Termos de Uso</h2>
        <LegalContentForm
          type="terms"
          label="Termos de Uso"
          initialContent={termsContent}
          initialUpdatedAt={termsUpdatedAt}
        />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Política de Privacidade</h2>
        <LegalContentForm
          type="privacy"
          label="Política de Privacidade"
          initialContent={privacyContent}
          initialUpdatedAt={privacyUpdatedAt}
        />
      </div>
    </div>
  );
}
