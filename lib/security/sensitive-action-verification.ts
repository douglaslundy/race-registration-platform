import crypto from "crypto";
import { db } from "@/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { sendSensitiveActionCodeEmail } from "@/lib/email";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export type SensitiveActionType =
  | "PAYMENT_REFUND"
  | "REGISTRATION_CANCELLATION_REFUND"
  | "REGISTRATION_CANCEL_CONFIRMED"
  | "PAYMENT_ACCOUNT_CHANGE"
  | "BACKUP_IMPORT"
  | "USER_SECURITY_CHANGE"
  | "PAYOUT_STATUS_CHANGE";

const CODE_EXPIRY_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const INVALID_OR_EXPIRED = "Código expirado ou inválido, solicite um novo.";

const ACTION_LABEL: Record<SensitiveActionType, string> = {
  PAYMENT_REFUND: "Confirmação de estorno de pagamento",
  REGISTRATION_CANCELLATION_REFUND: "Confirmação de aprovação de cancelamento com estorno",
  REGISTRATION_CANCEL_CONFIRMED: "Confirmação de cancelamento de inscrição confirmada",
  PAYMENT_ACCOUNT_CHANGE: "Confirmação de alteração de conta de pagamento",
  BACKUP_IMPORT: "Confirmação de importação de backup",
  USER_SECURITY_CHANGE: "Confirmação de alteração de acesso de usuário (perfil / status / senha)",
  PAYOUT_STATUS_CHANGE: "Confirmação de mudança de status de repasse",
};

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export type RequestCodeResult = { ok: true; verificationId: string } | { ok: false; error: string };

export async function requestSensitiveActionCode(params: {
  userId: string;
  actionType: SensitiveActionType;
  targetId: string;
}): Promise<RequestCodeResult> {
  const rateLimitKey = `sensitive-code:${params.userId}:${params.actionType}:${params.targetId}`;
  const { allowed } = checkRateLimit(rateLimitKey, RATE_LIMITS.SENSITIVE_ACTION_CODE);
  if (!allowed) {
    return { ok: false, error: "Muitos pedidos de código em pouco tempo. Aguarde alguns minutos e tente novamente." };
  }

  const user = await db.user.findUnique({
    where: { id: params.userId },
    select: { name: true, email: true, phone: true },
  });
  if (!user) return { ok: false, error: "Usuário não encontrado" };

  const code = String(crypto.randomInt(100000, 1000000));
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  const record = await db.sensitiveActionCode.create({
    data: { userId: params.userId, actionType: params.actionType, targetId: params.targetId, codeHash, expiresAt },
  });

  const actionLabel = ACTION_LABEL[params.actionType];

  try {
    await sendSensitiveActionCodeEmail({ to: user.email, name: user.name, code, actionLabel });
  } catch (err) {
    await db.sensitiveActionCode.delete({ where: { id: record.id } });
    console.error("[requestSensitiveActionCode] falha ao enviar e-mail:", err);
    return { ok: false, error: "Não foi possível enviar o código por e-mail. Tente novamente." };
  }

  if (user.phone) {
    try {
      const text = `${actionLabel}\n\nSeu código de verificação é: ${code}\n\nVálido por 10 minutos. Se você não solicitou esta ação, ignore esta mensagem.`;
      await sendWhatsAppMessage(user.phone, text, "SENSITIVE_ACTION_CODE", { logSubject: actionLabel });
    } catch (err) {
      console.error("[requestSensitiveActionCode] falha ao enviar WhatsApp (e-mail já enviado):", err);
    }
  }

  return { ok: true, verificationId: record.id };
}

export type VerifyCodeResult = { ok: true } | { ok: false; error: string; attemptsRemaining?: number };

export async function verifySensitiveActionCode(params: {
  verificationId: string;
  userId: string;
  actionType: SensitiveActionType;
  targetId: string;
  code: string;
}): Promise<VerifyCodeResult> {
  const record = await db.sensitiveActionCode.findUnique({ where: { id: params.verificationId } });

  if (
    !record ||
    record.userId !== params.userId ||
    record.actionType !== params.actionType ||
    record.targetId !== params.targetId ||
    record.consumedAt !== null ||
    record.expiresAt < new Date() ||
    record.attempts >= MAX_ATTEMPTS
  ) {
    return { ok: false, error: INVALID_OR_EXPIRED };
  }

  const recordHashBuf = Buffer.from(record.codeHash);
  const providedHashBuf = Buffer.from(hashCode(params.code));
  const matches =
    recordHashBuf.length === providedHashBuf.length && crypto.timingSafeEqual(recordHashBuf, providedHashBuf);

  if (!matches) {
    const updated = await db.sensitiveActionCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: "Código incorreto.", attemptsRemaining: Math.max(0, MAX_ATTEMPTS - updated.attempts) };
  }

  await db.sensitiveActionCode.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
  return { ok: true };
}
