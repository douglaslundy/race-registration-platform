import { BADGE } from "@/lib/badge-colors";

export const PRIVATE_AD_STATUS: Record<string, { label: string; color: string }> = {
  PENDING_APPROVAL: { label: "Aguardando aprovação", color: BADGE.yellow },
  APPROVED: { label: "Aprovado", color: BADGE.green },
  REJECTED: { label: "Rejeitado", color: BADGE.red },
  EXPIRED: { label: "Expirado", color: BADGE.gray },
  CANCELLED: { label: "Cancelado", color: BADGE.gray },
};
