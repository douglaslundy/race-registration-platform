export interface VariableDefinition {
  name: string;
  label: string;
  category: string;
  description: string;
  sample: string;
}

export const ALL_VARIABLES: VariableDefinition[] = [
  // Atleta
  { name: "nome_atleta", label: "Nome do atleta", category: "Atleta", description: "Registration.athlete.name (User.name).", sample: "Maria Exemplo" },
  { name: "primeiro_nome_atleta", label: "Primeiro nome do atleta", category: "Atleta", description: "Primeira palavra de nome_atleta.", sample: "Maria" },
  { name: "email_atleta", label: "E-mail do atleta", category: "Atleta", description: "User.email.", sample: "maria@exemplo.com" },
  { name: "telefone_atleta", label: "Telefone do atleta", category: "Atleta", description: "AthleteProfile.phone. Pode ser vazio.", sample: "(11) 98888-8888" },
  { name: "documento_atleta", label: "CPF do atleta", category: "Atleta", description: "AthleteProfile.cpf. Pode ser vazio.", sample: "123.456.789-00" },
  { name: "data_nascimento_atleta", label: "Data de nascimento", category: "Atleta", description: "AthleteProfile.birthDate, formatada dd/mm/aaaa.", sample: "15/03/1990" },
  { name: "equipe_atleta", label: "Equipe do atleta", category: "Atleta", description: "AthleteProfile.teamName. Pode ser vazio.", sample: "Equipe Exemplo Corrida" },
  { name: "categoria_inscricao", label: "Categoria da inscrição", category: "Atleta", description: "EventCategory.name da inscrição (não é campo do atleta).", sample: "Masculino 30-34" },

  // Organizador
  { name: "nome_organizador", label: "Nome do organizador", category: "Organizador", description: "Event.organizer.user.name.", sample: "João Organizador" },
  { name: "email_organizador", label: "E-mail do organizador", category: "Organizador", description: "Event.organizer.user.email.", sample: "joao@organizacao.com" },
  { name: "telefone_organizador", label: "Telefone do organizador", category: "Organizador", description: "OrganizerProfile.phone. Pode ser vazio.", sample: "(11) 97777-7777" },
  { name: "empresa_organizador", label: "Empresa do organizador", category: "Organizador", description: "OrganizerProfile.companyName. Pode ser vazio.", sample: "Organização Exemplo Eventos" },

  // Evento
  { name: "nome_evento", label: "Nome do evento", category: "Evento", description: "Event.title.", sample: "Corrida Exemplo 5k" },
  { name: "descricao_evento", label: "Descrição do evento", category: "Evento", description: "Event.description.", sample: "Corrida de rua de 5km pelas ruas da cidade." },
  { name: "data_evento", label: "Data do evento", category: "Evento", description: "Event.startAt, data em horário de Brasília.", sample: "20/09/2026" },
  { name: "hora_evento", label: "Hora do evento", category: "Evento", description: "Event.startAt, hora em horário de Brasília.", sample: "07:00" },
  { name: "local_evento", label: "Local do evento", category: "Evento", description: "Event.venueName. Pode ser vazio.", sample: "Parque Exemplo" },
  { name: "cidade_evento", label: "Cidade do evento", category: "Evento", description: "Event.city.", sample: "São Paulo" },
  { name: "estado_evento", label: "Estado do evento", category: "Evento", description: "Event.state.", sample: "SP" },
  { name: "endereco_evento", label: "Endereço do evento", category: "Evento", description: "Event.addressLine. Pode ser vazio.", sample: "Av. Exemplo, 1000" },
  { name: "link_evento", label: "Link do evento", category: "Evento", description: "Derivado de Event.slug + URL base da plataforma.", sample: "https://exemplo.com/eventos/corrida-exemplo" },
  { name: "patrocinio", label: "Patrocínio", category: "Evento", description: "Patrocinadores ativos cadastrados no evento. Pode ser vazio. Só disponível nos alertas de confirmação de inscrição.", sample: "Confira nosso patrocinador! https://patrocinador.com" },
  { name: "redes_sociais", label: "Redes sociais", category: "Evento", description: "Promoções de redes sociais cadastradas no evento, respeitando o limite de envios por pessoa. Pode ser vazio. Disponível nos alertas de confirmação, carrinho abandonado e erro de pagamento.", sample: "Segue a gente no Instagram! https://instagram.com/corrida" },
  { name: "nome_modalidade", label: "Modalidade/percurso", category: "Evento", description: "EventRoute.name, quando a inscrição tem rota associada.", sample: "5km" },

  // Inscrição
  { name: "numero_inscricao", label: "Número da inscrição", category: "Inscrição", description: "Registration.id.", sample: "reg_exemplo123" },
  { name: "status_inscricao", label: "Status da inscrição", category: "Inscrição", description: "Registration.status, traduzido.", sample: "Confirmada" },
  { name: "data_inscricao", label: "Data da inscrição", category: "Inscrição", description: "Registration.createdAt.", sample: "01/08/2026" },
  { name: "valor_inscricao", label: "Valor da inscrição", category: "Inscrição", description: "Order.totalAmount, formatado em R$.", sample: "R$ 90,00" },
  { name: "codigo_confirmacao", label: "Código do pedido", category: "Inscrição", description: "Order.id.", sample: "ord_exemplo123" },

  // Cancelamento
  { name: "data_cancelamento", label: "Data do cancelamento", category: "Cancelamento", description: "Data do evento de cancelamento (auditoria).", sample: "02/08/2026" },
  { name: "motivo_cancelamento", label: "Motivo do cancelamento", category: "Cancelamento", description: "Justificativa informada pelo solicitante.", sample: "Não poderei comparecer" },
  { name: "status_reembolso", label: "Status do reembolso", category: "Cancelamento", description: "Refund.status.", sample: "Processado" },
  { name: "valor_reembolso", label: "Valor do reembolso", category: "Cancelamento", description: "Refund.amount, formatado em R$.", sample: "R$ 90,00" },

  // Pagamento
  { name: "status_pagamento", label: "Status do pagamento", category: "Pagamento", description: "Payment.status, traduzido.", sample: "Aprovado" },
  { name: "valor_pagamento", label: "Valor do pagamento", category: "Pagamento", description: "Payment.amount, formatado em R$.", sample: "R$ 90,00" },
  { name: "forma_pagamento", label: "Forma de pagamento", category: "Pagamento", description: "Payment.method.", sample: "PIX" },
  { name: "data_pagamento", label: "Data do pagamento", category: "Pagamento", description: "Payment.paidAt.", sample: "01/08/2026" },
  { name: "codigo_transacao", label: "Código da transação", category: "Pagamento", description: "Payment.providerPaymentId.", sample: "mp_exemplo123" },

  // Plataforma
  { name: "nome_plataforma", label: "Nome da plataforma", category: "Plataforma", description: "getAppName().", sample: "Circuito das Corridas" },
  { name: "email_suporte", label: "E-mail de suporte", category: "Plataforma", description: "PlatformSetting['support_email']. Vazio até o admin preencher.", sample: "suporte@exemplo.com" },
  { name: "telefone_suporte", label: "Telefone de suporte", category: "Plataforma", description: "PlatformSetting['support_phone']. Vazio até o admin preencher.", sample: "(11) 96666-6666" },
  { name: "link_plataforma", label: "Link da plataforma", category: "Plataforma", description: "NEXT_PUBLIC_APP_URL.", sample: "https://exemplo.com" },
  { name: "ano_atual", label: "Ano atual", category: "Plataforma", description: "new Date().getFullYear().", sample: "2026" },

  // Específicas de alerta (não fazem parte da lista genérica do prompt, mas têm origem real e
  // são necessárias para os textos que já existem hoje em produção)
  { name: "nome_lote", label: "Nome do lote", category: "Vagas", description: "TicketBatch.name. Só disponível no alerta de vagas se esgotando.", sample: "Lote 1" },
  { name: "vagas_vendidas", label: "Vagas vendidas", category: "Vagas", description: "TicketBatch.soldCount. Só disponível no alerta de vagas se esgotando.", sample: "95" },
  { name: "capacidade_lote", label: "Capacidade do lote", category: "Vagas", description: "TicketBatch.capacity. Só disponível no alerta de vagas se esgotando.", sample: "100" },
  { name: "percentual_vendido", label: "Percentual vendido", category: "Vagas", description: "Calculado (vagas_vendidas/capacidade_lote). Só disponível no alerta de vagas se esgotando.", sample: "95" },
  { name: "link_finalizar_pagamento", label: "Link para finalizar pagamento", category: "Inscrição", description: "URL de /dashboard/inscricoes. Só disponível no alerta de carrinho abandonado.", sample: "https://exemplo.com/dashboard/inscricoes" },
  { name: "nome_comprador", label: "Nome do comprador", category: "Inscrição", description: "Order.buyer.name — quem comprou/criou a inscrição, pode diferir do atleta em inscrição por procuração. Só disponível nos alertas de confirmação por procuração.", sample: "João Comprador" },
  { name: "empresa_anunciante", label: "Empresa do anunciante", category: "Anunciante", description: "AdvertiserProfile.companyName. Só disponível no alerta de solicitação de anunciante pendente.", sample: "Academia Exemplo Ltda" },
  { name: "nome_plano", label: "Nome do plano", category: "Anunciante", description: "AdPlan.name. Só disponível no alerta de solicitação de anunciante pendente.", sample: "Plano Premium" },
  { name: "link_solicitacoes_pendentes", label: "Link das solicitações pendentes", category: "Anunciante", description: "URL de /admin/anunciantes/solicitacoes. Só disponível no alerta de solicitação de anunciante pendente.", sample: "https://exemplo.com/admin/anunciantes/solicitacoes" },
  { name: "total_divergencias", label: "Total de divergências", category: "Pagamento", description: "Quantidade total de divergências encontradas pela conciliação. Só disponível no alerta de conciliação.", sample: "3" },
  { name: "divergencias_corrigidas", label: "Divergências corrigidas", category: "Pagamento", description: "Quantidade de divergências corrigidas automaticamente pela conciliação. Só disponível no alerta de conciliação.", sample: "2" },
  { name: "divergencias_manuais", label: "Divergências que precisam de revisão manual", category: "Pagamento", description: "Quantidade de divergências que precisam de revisão manual. Só disponível no alerta de conciliação.", sample: "1" },
  { name: "data_resumo", label: "Data do resumo", category: "Plataforma", description: "Data de referência do resumo diário (dateLabel). Só disponível no alerta de resumo diário.", sample: "03/08/2026" },
  { name: "papel_destinatario", label: "Papel do destinatário", category: "Plataforma", description: "'administrador' ou 'organizador' — para quem o resumo diário foi gerado. Só disponível no alerta de resumo diário.", sample: "administrador" },
  { name: "total_inscricoes_pagas", label: "Inscrições pagas no dia", category: "Plataforma", description: "Contagem de inscrições pagas no resumo diário. Só disponível no alerta de resumo diário.", sample: "12" },
  { name: "receita_periodo", label: "Receita do período", category: "Plataforma", description: "Receita bruta (admin) ou receita do organizador no resumo diário, formatada em R$. Só disponível no alerta de resumo diário.", sample: "R$ 1.850,00" },
  { name: "novos_usuarios", label: "Novos usuários", category: "Plataforma", description: "Contagem de novos usuários cadastrados no dia. Só disponível no resumo diário do administrador.", sample: "5" },
  { name: "eventos_criados", label: "Eventos criados", category: "Plataforma", description: "Contagem de eventos criados no dia. Só disponível no resumo diário do administrador.", sample: "2" },
  { name: "cupons_usados", label: "Cupons usados", category: "Plataforma", description: "Contagem de cupons usados no dia. Só disponível no resumo diário do organizador.", sample: "3" },
  { name: "novos_organizadores", label: "Novos organizadores", category: "Plataforma", description: "Contagem de novos organizadores cadastrados no dia. Só disponível no resumo diário do administrador.", sample: "1" },
  { name: "taxa_plataforma", label: "Taxa da plataforma", category: "Plataforma", description: "Soma de Order.platformFeeAmount no período, formatada em R$. Só disponível no resumo diário do administrador.", sample: "R$ 150,00" },
  { name: "taxa_servico", label: "Taxa de serviço", category: "Plataforma", description: "Soma de Order.paymentFeeAmount no período, formatada em R$. Só disponível no resumo diário do administrador.", sample: "R$ 45,00" },
  { name: "repasses_gerados", label: "Repasses gerados", category: "Plataforma", description: "Quantidade de repasses (TransferPayout) gerados no período. Só disponível no resumo diário do administrador.", sample: "3" },
  { name: "valor_repasses", label: "Valor dos repasses", category: "Plataforma", description: "Valor total dos repasses gerados no período, formatado em R$. Só disponível no resumo diário do administrador.", sample: "R$ 900,00" },
  { name: "cancelamentos_estornos", label: "Cancelamentos/estornos", category: "Plataforma", description: "Cancelamentos solicitados + pagamentos estornados/chargeback no período. Só disponível no resumo diário do administrador.", sample: "2" },
  { name: "cancelamentos_solicitados", label: "Cancelamentos solicitados", category: "Plataforma", description: "Cancelamentos solicitados no período. Disponível no resumo diário do organizador e no resumo diário por evento.", sample: "1" },
  { name: "lotes_esgotados", label: "Lotes esgotados", category: "Plataforma", description: "Lotes que esgotaram no período. Só disponível no resumo diário do organizador.", sample: "1" },
  { name: "inscricoes_pagas", label: "Inscrições pagas (evento)", category: "Evento", description: "Inscrições pagas no dia, só deste evento. Só disponível no resumo diário por evento.", sample: "4" },
  { name: "receita_evento", label: "Receita do evento", category: "Evento", description: "Receita bruta do evento no dia, formatada em R$. Só disponível no resumo diário por evento.", sample: "R$ 360,00" },
  { name: "vagas_restantes", label: "Vagas restantes", category: "Evento", description: "Soma de (capacidade - vendidas) dos lotes ativos do evento. Só disponível no resumo diário por evento.", sample: "56" },

  // Linha de divergência (rowVariables do alerta de conciliação)
  { name: "evento", label: "Evento (linha de divergência)", category: "Conciliação", description: "Event.title da divergência. Só disponível no template de cada linha do alerta de conciliação.", sample: "Corrida Exemplo 5k" },
  { name: "pedido", label: "Pedido (linha de divergência)", category: "Conciliação", description: "Order.id da divergência. Só disponível no template de cada linha do alerta de conciliação.", sample: "ord_exemplo123" },
  { name: "status_local", label: "Status local (linha de divergência)", category: "Conciliação", description: "Status do pagamento no banco local antes da correção. Só disponível no template de cada linha do alerta de conciliação.", sample: "PENDING" },
  { name: "status_gateway", label: "Status no gateway (linha de divergência)", category: "Conciliação", description: "Status do pagamento no gateway. Só disponível no template de cada linha do alerta de conciliação.", sample: "PAID" },
  { name: "situacao", label: "Situação (linha de divergência)", category: "Conciliação", description: "'Corrigido automaticamente' ou 'Requer verificação manual'. Só disponível no template de cada linha do alerta de conciliação.", sample: "Corrigido automaticamente" },
];

export function getVariablesByNames(names: string[]): VariableDefinition[] {
  const wanted = new Set(names);
  return ALL_VARIABLES.filter((v) => wanted.has(v.name));
}

export const VARIABLE_CATEGORIES: string[] = [...new Set(ALL_VARIABLES.map((v) => v.category))];

export const SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  ALL_VARIABLES.map((v) => [v.name, v.sample]),
);
