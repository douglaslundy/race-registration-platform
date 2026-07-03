import { requireAdmin } from "@/lib/auth/rbac";
import { getWhatsAppConfig, isWhatsAppConfigured } from "@/lib/whatsapp-settings";
import WhatsAppCredentialsForm from "@/components/admin/WhatsAppCredentialsForm";
import WhatsAppConnectionPanel from "@/components/admin/WhatsAppConnectionPanel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "WhatsApp — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminWhatsAppPage() {
  await requireAdmin();

  const config = await getWhatsAppConfig();
  const configured = isWhatsAppConfigured(config);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">WhatsApp (Evolution API)</h1>
        <p className="text-sm text-gray-500 mt-1">
          Conecte um número de WhatsApp para enviar alertas da plataforma. O servidor Evolution API precisa já
          estar rodando — esta página só se conecta a ele.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Credenciais</h2>
        <WhatsAppCredentialsForm
          urlConfigured={Boolean(config.apiUrl)}
          keyConfigured={Boolean(config.apiKey)}
          currentUrl={config.apiUrl}
          currentInstanceName={config.instanceName}
        />
      </div>

      <div className="card">
        <h2 className="font-semibold mb-4">Conexão</h2>
        <WhatsAppConnectionPanel configured={configured} />
      </div>
    </div>
  );
}
