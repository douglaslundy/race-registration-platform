import { requireAdmin } from "@/lib/auth/rbac";
import {
  getWhatsAppConfig,
  getWhatsAppProvider,
  getTwilioConfig,
  isWhatsAppConfigured,
} from "@/lib/whatsapp-settings";
import WhatsAppProviderSelector from "@/components/admin/WhatsAppProviderSelector";
import WhatsAppCredentialsForm from "@/components/admin/WhatsAppCredentialsForm";
import TwilioCredentialsForm from "@/components/admin/TwilioCredentialsForm";
import WhatsAppConnectionPanel from "@/components/admin/WhatsAppConnectionPanel";
import WhatsAppTestSender from "@/components/admin/WhatsAppTestSender";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "WhatsApp — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminWhatsAppPage() {
  await requireAdmin();

  const [provider, config, twilio] = await Promise.all([
    getWhatsAppProvider(),
    getWhatsAppConfig(),
    getTwilioConfig(),
  ]);
  const configured = isWhatsAppConfigured(config);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-bold">WhatsApp</h1>
        <p className="text-sm text-gray-500 mt-1">
          Escolha o provedor e configure as credenciais para enviar alertas da plataforma por WhatsApp.
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Provedor</h2>
        <WhatsAppProviderSelector current={provider} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Credenciais</h2>
        {provider === "twilio" ? (
          <TwilioCredentialsForm
            accountSidConfigured={Boolean(twilio.accountSid)}
            authTokenConfigured={Boolean(twilio.authToken)}
            fromNumberConfigured={Boolean(twilio.fromNumber)}
            contentSidConfigured={Boolean(twilio.contentSid)}
            currentAccountSid={twilio.accountSid}
            currentFromNumber={twilio.fromNumber}
            currentContentSid={twilio.contentSid}
          />
        ) : (
          <WhatsAppCredentialsForm
            urlConfigured={Boolean(config.apiUrl)}
            keyConfigured={Boolean(config.apiKey)}
            currentUrl={config.apiUrl}
            currentInstanceName={config.instanceName}
          />
        )}
      </div>

      {provider === "evolution" && (
        <div className="card">
          <h2 className="font-semibold mb-4">Conexão</h2>
          <WhatsAppConnectionPanel configured={configured} />
        </div>
      )}

      <div className="card space-y-4">
        <h2 className="font-semibold">Teste de envio</h2>
        <WhatsAppTestSender />
      </div>
    </div>
  );
}
