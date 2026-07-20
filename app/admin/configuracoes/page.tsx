import { requireAdmin } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAppName, getSetting } from "@/lib/settings";
import SetPlatformFeeForm from "@/components/admin/SetPlatformFeeForm";
import AppNameForm from "@/components/admin/AppNameForm";
import PaymentMethodsForm from "@/components/admin/PaymentMethodsForm";
import PaymentGatewayForm from "@/components/admin/PaymentGatewayForm";
import StorageSettingsForm from "@/components/admin/StorageSettingsForm";
import SmtpSettingsForm from "@/components/admin/SmtpSettingsForm";
import DefaultPlatformFeeForm from "@/components/admin/DefaultPlatformFeeForm";
import ServiceFeeForm from "@/components/admin/ServiceFeeForm";
import BannerIntervalForm from "@/components/admin/BannerIntervalForm";
import CancellationPolicyToggleForm from "@/components/admin/CancellationPolicyToggleForm";
import AdsMarketplaceToggle from "@/components/admin/AdsMarketplaceToggle";
import { parseEnabledPaymentMethods } from "@/lib/payment-methods";
import { ACTION_LABEL, ENTITY_LABEL } from "@/lib/admin/labels";
import { getPaymentProviderSetting } from "@/lib/payment-settings";
import { getStorageConfig } from "@/lib/storage-settings";
import { getSmtpConfig } from "@/lib/smtp-settings";
import { getDefaultPlatformFee, getServiceFeePercent, getServiceFeeMin, getBannerInterval, getCancellationPolicyEnabled } from "@/lib/settings";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Configurações — Admin" };
export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  await requireAdmin();

  const [events, appName, enabledPaymentMethods, paymentProvider, accessToken, webhookSecret, mpPublicKey, pagarmeApiKey, pagarmePublicKey, pagarmeWebhookPassword, recentLogs, storageConfig, defaultPlatformFee, serviceFeePercent, serviceFeeMin, bannerInterval, smtpConfig, cancellationPolicyEnabled, adsMarketplaceEnabledSetting] = await Promise.all([
    db.event.findMany({
      where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: { id: true, title: true, platformFeePercent: true, status: true },
      orderBy: { title: "asc" },
    }),
    getAppName(),
    getSetting("enabled_payment_methods"),
    getPaymentProviderSetting(),
    getSetting("mp_access_token"),
    getSetting("mp_webhook_secret"),
    getSetting("mp_public_key"),
    getSetting("pagarme_api_key"),
    getSetting("pagarme_public_key"),
    getSetting("pagarme_webhook_password"),
    db.auditLog.findMany({
      where: {
        OR: [
          { action: "SETTING_UPDATED", entityType: "PlatformSetting" },
          { action: "EVENT_FEE_UPDATED", entityType: "Event" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
    getStorageConfig(),
    getDefaultPlatformFee(),
    getServiceFeePercent(),
    getServiceFeeMin(),
    getBannerInterval(),
    getSmtpConfig(),
    getCancellationPolicyEnabled(),
    getSetting("ads_marketplace_enabled"),
  ]);

  const adsMarketplaceEnabled = adsMarketplaceEnabledSetting === "true";

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold dark:text-gray-100">Configurações</h1>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Nome da plataforma</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Nome exibido no cabeçalho, rodapé, e-mails e título das páginas.
        </p>
        <AppNameForm currentName={appName} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Intervalo do carrossel de banners</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Tempo em segundos entre a troca automática de banners na página de eventos. Padrão: 3 segundos.
        </p>
        <BannerIntervalForm currentInterval={bannerInterval} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Taxa da plataforma por evento</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Taxa percentual adicionada ao valor da inscrição e paga pelo inscrito. Configurada por evento em pontos base (1100 = 11%). Alterar aqui afeta somente novos pedidos.
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhum evento ativo.</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <SetPlatformFeeForm key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Taxa mínima da plataforma</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Valor mínimo cobrado do inscrito por inscrição. Aplica-se quando o evento é gratuito ou quando a taxa percentual resultar em valor inferior a este mínimo.
        </p>
        <DefaultPlatformFeeForm currentFee={defaultPlatformFee} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Taxa de serviço de ingresso</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Taxa percentual global adicionada ao valor da inscrição como taxa de serviço. O valor mínimo é aplicado quando o percentual resultar em valor inferior. Use 0 para não cobrar.
        </p>
        <ServiceFeeForm currentPercent={serviceFeePercent} currentMin={serviceFeeMin} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Meios de pagamento</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Selecione quais opções aparecem no checkout e podem ser usadas pelos atletas.
        </p>
        <PaymentMethodsForm currentMethods={parseEnabledPaymentMethods(enabledPaymentMethods)} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Gateway de pagamento</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure o provedor e as credenciais usadas para criar cobranças e validar webhooks.
        </p>
        <PaymentGatewayForm
          currentProvider={paymentProvider}
          accessTokenConfigured={Boolean(accessToken)}
          webhookSecretConfigured={Boolean(webhookSecret)}
          mpPublicKeyConfigured={Boolean(mpPublicKey)}
          pagarmeApiKeyConfigured={Boolean(pagarmeApiKey)}
          pagarmePublicKeyConfigured={Boolean(pagarmePublicKey)}
          pagarmeWebhookPasswordConfigured={Boolean(pagarmeWebhookPassword)}
        />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Política de cancelamento por evento</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Quando ativado, os organizadores podem configurar prazo de cancelamento, exigência de aprovação e contato de
          aviso em cada evento (aba de edição do evento). Quando desativado, o cancelamento do atleta funciona como hoje
          (livre até o início do evento, sempre imediato).
        </p>
        <CancellationPolicyToggleForm currentEnabled={cancellationPolicyEnabled} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Marketplace de anunciantes</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Quando ativado, a página de cadastro de anunciantes (<code>/auth/cadastro-anunciante</code>) fica
          acessível e permite que novas empresas se registrem. Quando desativado, o cadastro é bloqueado.
        </p>
        <AdsMarketplaceToggle currentEnabled={adsMarketplaceEnabled} />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Storage de arquivos</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure onde banners e regulamentos são armazenados. Supabase Storage (recomendado) ou qualquer bucket S3-compatible.
        </p>
        <StorageSettingsForm
          bucketConfigured={Boolean(storageConfig.bucket)}
          accessKeyConfigured={Boolean(storageConfig.accessKey)}
          endpointConfigured={storageConfig.endpoint ?? null}
        />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">E-mail (SMTP)</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Configure o servidor SMTP usado para enviar a confirmação de inscrição e a recuperação de senha.
          Para Gmail use <code>smtp.gmail.com</code> com uma senha de app. Salve e use o botão de teste para validar.
        </p>
        <SmtpSettingsForm
          hostConfigured={Boolean(smtpConfig.host)}
          fromConfigured={Boolean(smtpConfig.from)}
          currentHost={smtpConfig.host}
          currentPort={String(smtpConfig.port)}
          currentUser={smtpConfig.user}
          currentFrom={smtpConfig.from}
          currentSecure={smtpConfig.secure}
        />
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold text-lg dark:text-gray-100">Últimas alterações</h2>
        {recentLogs.length === 0 ? (
          <p className="text-sm text-gray-500">Nenhuma alteração registrada ainda.</p>
        ) : (
          <div className="space-y-2 text-sm">
            {recentLogs.map((log) => (
              <div key={log.id} className="flex flex-col gap-1 border-b last:border-0 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">{ACTION_LABEL[log.action] ?? log.action}</span>
                  <span className="text-gray-600">
                    {ENTITY_LABEL[log.entityType] ?? log.entityType}
                    {log.entityId ? `:${log.entityId.slice(0, 8)}` : ""}
                  </span>
                  <span className="text-gray-400 text-xs ml-auto">{log.createdAt.toLocaleString("pt-BR")}</span>
                </div>
                <div className="text-xs text-gray-500 flex items-center justify-between gap-2">
                  <span>{log.user?.name ?? "Sistema"}</span>
                  {log.entityType === "PlatformSetting" ? (
                    <Link href="/admin/configuracoes" className="text-primary-700 hover:underline">
                      Ajuste de configuração
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
