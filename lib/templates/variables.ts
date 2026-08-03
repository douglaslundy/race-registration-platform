export interface VariableDefinition {
  name: string;
  label: string;
  category: string;
  description: string;
}

export const ALL_VARIABLES: VariableDefinition[] = [
  // Atleta
  { name: "nome_atleta", label: "Nome do atleta", category: "Atleta", description: "Registration.athlete.name (User.name)." },
  { name: "primeiro_nome_atleta", label: "Primeiro nome do atleta", category: "Atleta", description: "Primeira palavra de nome_atleta." },
  { name: "email_atleta", label: "E-mail do atleta", category: "Atleta", description: "User.email." },
  { name: "telefone_atleta", label: "Telefone do atleta", category: "Atleta", description: "AthleteProfile.phone. Pode ser vazio." },
  { name: "documento_atleta", label: "CPF do atleta", category: "Atleta", description: "AthleteProfile.cpf. Pode ser vazio." },
  { name: "data_nascimento_atleta", label: "Data de nascimento", category: "Atleta", description: "AthleteProfile.birthDate, formatada dd/mm/aaaa." },
  { name: "equipe_atleta", label: "Equipe do atleta", category: "Atleta", description: "AthleteProfile.teamName. Pode ser vazio." },
  { name: "categoria_inscricao", label: "Categoria da inscrição", category: "Atleta", description: "EventCategory.name da inscrição (não é campo do atleta)." },

  // Organizador
  { name: "nome_organizador", label: "Nome do organizador", category: "Organizador", description: "Event.organizer.user.name." },
  { name: "email_organizador", label: "E-mail do organizador", category: "Organizador", description: "Event.organizer.user.email." },
  { name: "telefone_organizador", label: "Telefone do organizador", category: "Organizador", description: "OrganizerProfile.phone. Pode ser vazio." },
  { name: "empresa_organizador", label: "Empresa do organizador", category: "Organizador", description: "OrganizerProfile.companyName. Pode ser vazio." },

  // Evento
  { name: "nome_evento", label: "Nome do evento", category: "Evento", description: "Event.title." },
  { name: "descricao_evento", label: "Descrição do evento", category: "Evento", description: "Event.description." },
  { name: "data_evento", label: "Data do evento", category: "Evento", description: "Event.startAt, data em horário de Brasília." },
  { name: "hora_evento", label: "Hora do evento", category: "Evento", description: "Event.startAt, hora em horário de Brasília." },
  { name: "local_evento", label: "Local do evento", category: "Evento", description: "Event.venueName. Pode ser vazio." },
  { name: "cidade_evento", label: "Cidade do evento", category: "Evento", description: "Event.city." },
  { name: "estado_evento", label: "Estado do evento", category: "Evento", description: "Event.state." },
  { name: "endereco_evento", label: "Endereço do evento", category: "Evento", description: "Event.addressLine. Pode ser vazio." },
  { name: "link_evento", label: "Link do evento", category: "Evento", description: "Derivado de Event.slug + URL base da plataforma." },
  { name: "nome_modalidade", label: "Modalidade/percurso", category: "Evento", description: "EventRoute.name, quando a inscrição tem rota associada." },

  // Inscrição
  { name: "numero_inscricao", label: "Número da inscrição", category: "Inscrição", description: "Registration.id." },
  { name: "status_inscricao", label: "Status da inscrição", category: "Inscrição", description: "Registration.status, traduzido." },
  { name: "data_inscricao", label: "Data da inscrição", category: "Inscrição", description: "Registration.createdAt." },
  { name: "valor_inscricao", label: "Valor da inscrição", category: "Inscrição", description: "Order.totalAmount, formatado em R$." },
  { name: "codigo_confirmacao", label: "Código do pedido", category: "Inscrição", description: "Order.id." },

  // Cancelamento
  { name: "data_cancelamento", label: "Data do cancelamento", category: "Cancelamento", description: "Data do evento de cancelamento (auditoria)." },
  { name: "motivo_cancelamento", label: "Motivo do cancelamento", category: "Cancelamento", description: "Justificativa informada pelo solicitante." },
  { name: "status_reembolso", label: "Status do reembolso", category: "Cancelamento", description: "Refund.status." },
  { name: "valor_reembolso", label: "Valor do reembolso", category: "Cancelamento", description: "Refund.amount, formatado em R$." },

  // Pagamento
  { name: "status_pagamento", label: "Status do pagamento", category: "Pagamento", description: "Payment.status, traduzido." },
  { name: "valor_pagamento", label: "Valor do pagamento", category: "Pagamento", description: "Payment.amount, formatado em R$." },
  { name: "forma_pagamento", label: "Forma de pagamento", category: "Pagamento", description: "Payment.method." },
  { name: "data_pagamento", label: "Data do pagamento", category: "Pagamento", description: "Payment.paidAt." },
  { name: "codigo_transacao", label: "Código da transação", category: "Pagamento", description: "Payment.providerPaymentId." },

  // Plataforma
  { name: "nome_plataforma", label: "Nome da plataforma", category: "Plataforma", description: "getAppName()." },
  { name: "email_suporte", label: "E-mail de suporte", category: "Plataforma", description: "PlatformSetting['support_email']. Vazio até o admin preencher." },
  { name: "telefone_suporte", label: "Telefone de suporte", category: "Plataforma", description: "PlatformSetting['support_phone']. Vazio até o admin preencher." },
  { name: "link_plataforma", label: "Link da plataforma", category: "Plataforma", description: "NEXT_PUBLIC_APP_URL." },
  { name: "ano_atual", label: "Ano atual", category: "Plataforma", description: "new Date().getFullYear()." },

  // Específicas de alerta (não fazem parte da lista genérica do prompt, mas têm origem real e
  // são necessárias para os textos que já existem hoje em produção)
  { name: "nome_lote", label: "Nome do lote", category: "Vagas", description: "TicketBatch.name. Só disponível no alerta de vagas se esgotando." },
  { name: "vagas_vendidas", label: "Vagas vendidas", category: "Vagas", description: "TicketBatch.soldCount. Só disponível no alerta de vagas se esgotando." },
  { name: "capacidade_lote", label: "Capacidade do lote", category: "Vagas", description: "TicketBatch.capacity. Só disponível no alerta de vagas se esgotando." },
  { name: "percentual_vendido", label: "Percentual vendido", category: "Vagas", description: "Calculado (vagas_vendidas/capacidade_lote). Só disponível no alerta de vagas se esgotando." },
  { name: "link_finalizar_pagamento", label: "Link para finalizar pagamento", category: "Inscrição", description: "URL de /dashboard/inscricoes. Só disponível no alerta de carrinho abandonado." },
  { name: "nome_comprador", label: "Nome do comprador", category: "Inscrição", description: "Order.buyer.name — quem comprou/criou a inscrição, pode diferir do atleta em inscrição por procuração. Só disponível nos alertas de confirmação por procuração." },
  { name: "empresa_anunciante", label: "Empresa do anunciante", category: "Anunciante", description: "AdvertiserProfile.companyName. Só disponível no alerta de solicitação de anunciante pendente." },
  { name: "nome_plano", label: "Nome do plano", category: "Anunciante", description: "AdPlan.name. Só disponível no alerta de solicitação de anunciante pendente." },
  { name: "link_solicitacoes_pendentes", label: "Link das solicitações pendentes", category: "Anunciante", description: "URL de /admin/anunciantes/solicitacoes. Só disponível no alerta de solicitação de anunciante pendente." },
  { name: "total_divergencias", label: "Total de divergências", category: "Pagamento", description: "Quantidade total de divergências encontradas pela conciliação. Só disponível no alerta de conciliação." },
  { name: "divergencias_corrigidas", label: "Divergências corrigidas", category: "Pagamento", description: "Quantidade de divergências corrigidas automaticamente pela conciliação. Só disponível no alerta de conciliação." },
  { name: "divergencias_manuais", label: "Divergências que precisam de revisão manual", category: "Pagamento", description: "Quantidade de divergências que precisam de revisão manual. Só disponível no alerta de conciliação." },
  { name: "data_resumo", label: "Data do resumo", category: "Plataforma", description: "Data de referência do resumo diário (dateLabel). Só disponível no alerta de resumo diário." },
  { name: "papel_destinatario", label: "Papel do destinatário", category: "Plataforma", description: "'administrador' ou 'organizador' — para quem o resumo diário foi gerado. Só disponível no alerta de resumo diário." },
];

export function getVariablesByNames(names: string[]): VariableDefinition[] {
  const wanted = new Set(names);
  return ALL_VARIABLES.filter((v) => wanted.has(v.name));
}

export const VARIABLE_CATEGORIES: string[] = [...new Set(ALL_VARIABLES.map((v) => v.category))];
