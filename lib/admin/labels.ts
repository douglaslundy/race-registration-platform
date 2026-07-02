export const ACTION_LABEL: Record<string, string> = {
  EVENT_CREATED: "Evento criado",
  EVENT_UPDATED: "Evento atualizado",
  EVENT_CANCELLED: "Evento cancelado",
  EVENT_DELETED: "Evento excluído",
  EVENT_APPROVED: "Evento aprovado",
  EVENT_REJECTED: "Evento rejeitado",
  EVENT_FEE_UPDATED: "Taxa de evento atualizada",
  REGISTRATION_CANCELLED: "Inscrição cancelada",
  USER_CREATED: "Usuário criado",
  USER_UPDATED: "Usuário atualizado",
  USER_DELETED: "Usuário removido",
  USER_ROLE_CHANGED: "Papel alterado",
  USER_DEACTIVATED: "Usuário desativado",
  USER_ACTIVATED: "Usuário ativado",
  CHECKOUT_COMPLETED: "Checkout concluído",
  SETTING_UPDATED: "Configuração atualizada",
  TRANSFER_CREATED: "Repasse criado",
  TRANSFER_COMPLETED: "Repasse concluído",
  TRANSFER_FAILED: "Repasse falhou",
};

export const ENTITY_LABEL: Record<string, string> = {
  Event: "Evento",
  Registration: "Inscrição",
  User: "Usuário",
  Order: "Pedido",
  Payment: "Pagamento",
  PlatformSetting: "Configuração",
  TransferPayout: "Repasse",
};

export const EVENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Rascunho",
  UNDER_REVIEW: "Em análise",
  PUBLISHED: "Publicado",
  REGISTRATIONS_OPEN: "Inscrições abertas",
  SOLD_OUT: "Esgotado",
  REGISTRATIONS_CLOSED: "Inscrições encerradas",
  ACTIVE: "Ativo",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
  SUSPENDED: "Suspenso",
  REJECTED: "Rejeitado",
};

export const MODALITY_LABEL: Record<string, string> = {
  ROAD_RACE: "Corrida de rua",
  TRAIL_RUN: "Trail run",
  MTB: "MTB",
  CYCLING: "Ciclismo",
  WALK: "Caminhada",
  TRIATHLON: "Triatlo",
  OTHER: "Outros",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  EXPIRED: "Expirado",
  CANCELLED: "Cancelado",
  REFUNDED: "Estornado",
  CHARGEBACK: "Chargeback",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  CANCELLED: "Cancelado",
  REFUNDED: "Estornado",
  EXPIRED: "Expirado",
};

export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  PROCESSING: "Processando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
};
