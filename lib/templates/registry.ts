export type AlertChannel = "EMAIL" | "WHATSAPP";
export type RecipientRole = "BUYER" | "ATHLETE" | "ORGANIZER" | "ADMIN";

export type AlertKey =
  | "LOW_STOCK"
  | "ABANDONED_CART"
  | "PAYMENT_ERROR"
  | "PAYMENT_ERROR_ORDER_CANCELLED"
  | "RECONCILIATION_MISMATCH"
  | "CANCELLATION_REQUESTED"
  | "DAILY_SUMMARY"
  | "ADVERTISER_REQUEST_PENDING"
  | "ORDER_CONFIRMED"
  | "ORDER_CONFIRMED_PROXY_BUYER"
  | "ORDER_CONFIRMED_PROXY_ATHLETE";

export interface AlertTemplateDefinition {
  alertKey: AlertKey;
  description: string;
  channels: AlertChannel[];
  recipientRoles: RecipientRole[];
  variables: string[];
  factoryDefault: (channel: AlertChannel, recipientRole: string) => { subject?: string; body: string };
}

export const ALERT_REGISTRY: Record<AlertKey, AlertTemplateDefinition> = {
  LOW_STOCK: {
    alertKey: "LOW_STOCK",
    description: "Vagas se esgotando — avisa o organizador quando um lote atinge o limiar configurado.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ORGANIZER"],
    variables: ["nome_organizador", "nome_evento", "nome_lote", "vagas_vendidas", "capacidade_lote", "percentual_vendido"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Vagas se esgotando — {{nome_evento}}",
            body:
              `<p>Olá {{nome_organizador}},</p>\n` +
              `<p>O lote <strong>{{nome_lote}}</strong> do evento <strong>{{nome_evento}}</strong> já vendeu\n` +
              `<strong>{{vagas_vendidas}} de {{capacidade_lote}}</strong> vagas ({{percentual_vendido}}%).</p>\n` +
              `<p>Considere abrir um novo lote em breve.</p>`,
          }
        : {
            body: `Alerta: o lote "{{nome_lote}}" do evento "{{nome_evento}}" já vendeu {{vagas_vendidas}} de {{capacidade_lote}} vagas.`,
          },
  },

  ABANDONED_CART: {
    alertKey: "ABANDONED_CART",
    description: "Carrinho abandonado — avisa o comprador quando um pedido fica pendente além do limite configurado.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "link_finalizar_pagamento"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Finalize sua inscrição — {{nome_evento}}",
            body:
              `<p>Olá {{nome_atleta}},</p>\n` +
              `<p>Notamos que você iniciou uma inscrição em <strong>{{nome_evento}}</strong> mas o pagamento ainda não foi concluído.</p>\n` +
              `<p><a href="{{link_finalizar_pagamento}}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Finalizar pagamento</a></p>`,
          }
        : {
            body: `Sua inscrição em "{{nome_evento}}" ainda não foi paga. Finalize o pagamento para garantir sua vaga.`,
          },
  },

  PAYMENT_ERROR: {
    alertKey: "PAYMENT_ERROR",
    description: "Erro de pagamento — avisa o comprador quando um pagamento é recusado ou expira.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "link_evento"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Inscrição cancelada — pagamento não identificado — {{nome_evento}}",
            body:
              `<p>Olá {{nome_atleta}},</p>\n` +
              `<p>Não conseguimos identificar o pagamento da sua inscrição em <strong>{{nome_evento}}</strong>, por isso ela foi cancelada.</p>\n` +
              `<p>Não fique de fora! Faça agora mesmo uma nova inscrição e venha participar conosco.</p>\n` +
              `<p><a href="{{link_evento}}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Fazer nova inscrição</a></p>`,
          }
        : {
            body: `Sua inscrição em "{{nome_evento}}" foi cancelada porque não identificamos o pagamento. Não fique de fora — faça agora mesmo uma nova inscrição e venha participar conosco: {{link_evento}}`,
          },
  },

  PAYMENT_ERROR_ORDER_CANCELLED: {
    alertKey: "PAYMENT_ERROR_ORDER_CANCELLED",
    description: "Mesmo texto de erro de pagamento, disparado manualmente para pedidos cancelados sem Payment associado.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "link_evento"],
    factoryDefault: (channel, role) => ALERT_REGISTRY.PAYMENT_ERROR.factoryDefault(channel, role),
  },

  RECONCILIATION_MISMATCH: {
    alertKey: "RECONCILIATION_MISMATCH",
    description: "Divergência de conciliação — avisa todos os admins quando o cron encontra pagamentos pendentes divergentes do gateway. Subject e introdução são editáveis; a tabela de divergências individuais continua gerada pelo código (mesmo padrão do resumo diário, fora do escopo de variáveis desta etapa).",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN"],
    variables: ["total_divergencias", "divergencias_corrigidas", "divergencias_manuais"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Conciliação de pagamentos — {{total_divergencias}} divergência(s) encontrada(s)",
            body:
              `<p>A rotina de conciliação encontrou divergências entre o status local e o status no gateway de\n` +
              `pagamento ({{divergencias_corrigidas}} corrigida(s) automaticamente, {{divergencias_manuais}} precisa(m) de revisão\n` +
              `manual).</p>\n` +
              `<p>Divergências marcadas como "Requer verificação manual" precisam de revisão em Admin →\n` +
              `Conciliação.</p>`,
          }
        : {
            body: `Conciliação de pagamentos: {{divergencias_corrigidas}} corrigida(s) automaticamente, {{divergencias_manuais}} precisam de revisão manual. Acesse /admin/conciliacao para detalhes.`,
          },
  },

  CANCELLATION_REQUESTED: {
    alertKey: "CANCELLATION_REQUESTED",
    description: "Solicitação de cancelamento — avisa admins e o organizador do evento.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN", "ORGANIZER"],
    variables: ["nome_atleta", "nome_evento", "motivo_cancelamento"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Solicitação de cancelamento — {{nome_evento}}",
            body:
              `<p>Olá,</p>\n` +
              `<p><strong>{{nome_atleta}}</strong> solicitou o cancelamento da inscrição em <strong>{{nome_evento}}</strong>.</p>\n` +
              `<p><strong>Justificativa:</strong> {{motivo_cancelamento}}</p>\n` +
              `<p>Acesse o painel do organizador para aprovar ou rejeitar esta solicitação.</p>`,
          }
        : {
            body: `{{nome_atleta}} solicitou o cancelamento da inscrição em "{{nome_evento}}". Justificativa: {{motivo_cancelamento}}`,
          },
  },

  DAILY_SUMMARY: {
    alertKey: "DAILY_SUMMARY",
    description: "Resumo diário — subject e introdução são editáveis; a tabela de métricas continua gerada pelo código (fora do escopo de variáveis desta etapa).",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN", "ORGANIZER"],
    variables: ["data_resumo", "papel_destinatario"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? { subject: "Resumo diário — {{data_resumo}}", body: `<p>Olá,</p>\n<p>Este é o resumo de atividade do dia <strong>{{data_resumo}}</strong> (visão de {{papel_destinatario}}):</p>` }
        : { body: `Resumo diário de atividade disponível.` },
  },

  ADVERTISER_REQUEST_PENDING: {
    alertKey: "ADVERTISER_REQUEST_PENDING",
    description: "Solicitação de conta de anunciante — avisa todos os admins imediatamente.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ADMIN"],
    variables: ["nome_plataforma", "empresa_anunciante", "nome_plano", "link_solicitacoes_pendentes"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Nova solicitação de anunciante — {{nome_plataforma}}",
            body:
              `<p>Uma nova solicitação de conta de anunciante chegou e está aguardando aprovação.</p>\n` +
              `<p><strong>Empresa:</strong> {{empresa_anunciante}}<br/>\n` +
              `   <strong>Plano:</strong> {{nome_plano}}</p>\n` +
              `<p><a href="{{link_solicitacoes_pendentes}}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver solicitações pendentes</a></p>`,
          }
        : { body: `Nova solicitação de anunciante: {{empresa_anunciante}} (plano {{nome_plano}}). Acesse o painel pra aprovar ou rejeitar.` },
  },

  ORDER_CONFIRMED: {
    alertKey: "ORDER_CONFIRMED",
    description: "Confirmação de inscrição — comprador confirmando a própria inscrição. Quando a inscrição tem uma observação registrada, a produção anexa um parágrafo extra com o texto — fora do escopo desta etapa (bloco condicional, o motor de renderização não suporta condicionais).",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "codigo_confirmacao", "link_evento"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? {
            subject: "Inscrição confirmada — {{nome_evento}} 🏅",
            body:
              `<p>Olá {{nome_atleta}},</p>\n` +
              `<p>Sua inscrição em <strong>{{nome_evento}}</strong> foi <strong>confirmada</strong> com sucesso! 🎉</p>\n` +
              `<p>O pagamento foi aprovado e sua vaga está garantida.</p>\n` +
              `<p>Código do pedido: <strong>{{codigo_confirmacao}}</strong></p>\n` +
              `<p><a href="{{link_evento}}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Ver detalhes da inscrição</a></p>`,
          }
        : { body: `Sua inscrição em {{nome_evento}} foi confirmada! Pedido {{codigo_confirmacao}}. Detalhes: {{link_evento}}` },
  },

  ORDER_CONFIRMED_PROXY_BUYER: {
    alertKey: "ORDER_CONFIRMED_PROXY_BUYER",
    description: "Confirmação de inscrição — comprador que inscreveu outra pessoa (procuração).",
    channels: ["WHATSAPP"],
    recipientRoles: ["BUYER"],
    variables: ["nome_atleta", "nome_evento", "codigo_confirmacao", "link_evento"],
    factoryDefault: () => ({ body: `Você inscreveu {{nome_atleta}} em {{nome_evento}}! Pedido {{codigo_confirmacao}}. Detalhes: {{link_evento}}` }),
  },

  ORDER_CONFIRMED_PROXY_ATHLETE: {
    alertKey: "ORDER_CONFIRMED_PROXY_ATHLETE",
    description: "Confirmação de inscrição — atleta convidado por procuração.",
    channels: ["EMAIL", "WHATSAPP"],
    recipientRoles: ["ATHLETE"],
    variables: ["nome_atleta", "nome_comprador", "nome_evento", "codigo_confirmacao", "link_evento"],
    factoryDefault: (channel) =>
      channel === "EMAIL"
        ? ALERT_REGISTRY.ORDER_CONFIRMED.factoryDefault("EMAIL", "ATHLETE")
        : { body: `{{nome_comprador}} criou uma inscrição pra você em {{nome_evento}}! Pedido {{codigo_confirmacao}}. Detalhes: {{link_evento}}` },
  },
};

export function getAlertDefinition(alertKey: string): AlertTemplateDefinition | undefined {
  return (ALERT_REGISTRY as Record<string, AlertTemplateDefinition>)[alertKey];
}
