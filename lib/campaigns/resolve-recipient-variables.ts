import { db } from "@/lib/db";
import { formatDate, formatCurrency } from "@/lib/format";
import { REGISTRATION_STATUS } from "@/lib/registration-status";
import { getAppName, getSetting } from "@/lib/settings";
import { getSponsorPromoText } from "@/lib/event-sponsors";
import { getSocialPromoText } from "@/lib/event-social-links";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Resolve os valores REAIS (não mais amostra) das variáveis permitidas pra um destinatário de
 * campanha. Sempre resolve Atleta + Plataforma; quando `registrationId` não é nulo (campanha de
 * evento), resolve também Evento + Organizador + Inscrição + `patrocinio`/`redes_sociais`.
 * `patrocinio` (getSponsorPromoText) não tem efeito colateral, resolve sempre. `redes_sociais`
 * (getSocialPromoText) TEM efeito colateral real (incrementa cota de envio por link) — quando
 * `recipient.redesSociaisText` já vem preenchido (valor cacheado de uma tentativa anterior), reusa
 * esse valor sem chamar getSocialPromoText de novo; só resolve fresco (e retorna o valor resolvido
 * em `redesSociaisText`, pro chamador persistir) quando ainda não havia sido resolvido antes. */
export async function resolveCampaignRecipientVariables(recipient: {
  athleteUserId: string;
  registrationId: string | null;
  redesSociaisText?: string | null;
}): Promise<{ values: Record<string, string>; redesSociaisText?: string }> {
  const user = await db.user.findUnique({
    where: { id: recipient.athleteUserId },
    select: {
      name: true,
      email: true,
      athleteProfile: { select: { phone: true, cpf: true, birthDate: true, teamName: true } },
    },
  });

  const values: Record<string, string> = {
    nome_atleta: user?.name ?? "",
    primeiro_nome_atleta: user?.name ? firstName(user.name) : "",
    email_atleta: user?.email ?? "",
    telefone_atleta: user?.athleteProfile?.phone ?? "",
    documento_atleta: user?.athleteProfile?.cpf ?? "",
    data_nascimento_atleta: user?.athleteProfile?.birthDate ? formatDate(user.athleteProfile.birthDate) : "",
    equipe_atleta: user?.athleteProfile?.teamName ?? "",
    nome_plataforma: await getAppName(),
    email_suporte: (await getSetting("support_email")) ?? "",
    telefone_suporte: (await getSetting("support_phone")) ?? "",
    link_plataforma: process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? "",
    ano_atual: String(new Date().getFullYear()),
  };

  if (recipient.registrationId === null) {
    return { values };
  }

  const registration = await db.registration.findUnique({
    where: { id: recipient.registrationId },
    select: {
      status: true,
      createdAt: true,
      bibNumber: true,
      teamName: true,
      eventId: true,
      route: { select: { name: true, distanceKm: true } },
      category: { select: { name: true } },
      event: {
        select: {
          title: true,
          description: true,
          startAt: true,
          venueName: true,
          city: true,
          state: true,
          addressLine: true,
          slug: true,
          organizer: { select: { companyName: true, phone: true, user: { select: { name: true, email: true } } } },
        },
      },
      order: { select: { id: true, totalAmount: true } },
    },
  });

  if (!registration) return { values };

  values.categoria_inscricao = registration.category?.name ?? "";
  values.nome_modalidade = registration.route?.name ?? "";
  values.numero_peito = registration.bibNumber ?? "";
  values.equipe_inscricao = registration.teamName ?? "";
  values.distancia_percurso = registration.route?.distanceKm ? `${registration.route.distanceKm} km` : "";
  values.nome_evento = registration.event.title;
  values.descricao_evento = registration.event.description ?? "";
  values.data_evento = formatDate(registration.event.startAt);
  values.hora_evento = formatDate(registration.event.startAt, "HH:mm");
  values.local_evento = registration.event.venueName ?? "";
  values.cidade_evento = registration.event.city;
  values.estado_evento = registration.event.state;
  values.endereco_evento = registration.event.addressLine ?? "";
  values.link_evento = `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTAUTH_URL ?? ""}/eventos/${registration.event.slug}`;
  values.nome_organizador = registration.event.organizer.user.name;
  values.email_organizador = registration.event.organizer.user.email;
  values.telefone_organizador = registration.event.organizer.phone ?? "";
  values.empresa_organizador = registration.event.organizer.companyName ?? "";
  values.numero_inscricao = recipient.registrationId;
  values.status_inscricao = REGISTRATION_STATUS[registration.status]?.label ?? registration.status;
  values.data_inscricao = formatDate(registration.createdAt);
  values.valor_inscricao = registration.order ? formatCurrency(registration.order.totalAmount) : "";
  values.codigo_confirmacao = registration.order?.id ?? "";

  values.patrocinio = await getSponsorPromoText(registration.eventId);

  let redesSociaisText: string | undefined;
  if (recipient.redesSociaisText != null) {
    values.redes_sociais = recipient.redesSociaisText;
  } else {
    const resolved = await getSocialPromoText(registration.eventId, recipient.athleteUserId);
    values.redes_sociais = resolved;
    redesSociaisText = resolved;
  }

  return { values, redesSociaisText };
}
