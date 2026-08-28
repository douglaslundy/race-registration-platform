export type WhatsAppErrorKind =
  | "AUTH"
  | "INVALID_NUMBER"
  | "INVALID_TEMPLATE"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "UNKNOWN";

export class WhatsAppSendError extends Error {
  constructor(
    readonly kind: WhatsAppErrorKind,
    message: string,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = "WhatsAppSendError";
  }
}

const KIND_LABEL: Record<WhatsAppErrorKind, string> = {
  AUTH: "credenciais do provedor de WhatsApp inválidas",
  INVALID_NUMBER: "número de WhatsApp inválido ou inexistente",
  INVALID_TEMPLATE: "template do WhatsApp inválido ou não aprovado",
  RATE_LIMITED: "limite de envio do provedor atingido, tente mais tarde",
  PROVIDER_UNAVAILABLE: "provedor de WhatsApp temporariamente indisponível",
  TIMEOUT: "tempo de resposta do provedor esgotado",
  UNKNOWN: "falha ao enviar WhatsApp",
};

export function whatsAppErrorLabel(kind: WhatsAppErrorKind): string {
  return KIND_LABEL[kind];
}
