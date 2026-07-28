import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { hasValidMxRecord } from "@/lib/validate-email-domain";
import { isValidDocument } from "@/lib/document-validation";

export interface AdvertiserProfileInput {
  companyName: string;
  document: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  instagram?: string | null;
  facebook?: string | null;
}

export interface RequestAdvertiserInput {
  existingUserId: string | null;
  newAccount: { name: string; email: string; password: string } | null;
  profile: AdvertiserProfileInput;
}

export type RequestAdvertiserResult =
  | { ok: true; userId: string; advertiserId: string }
  | { ok: false; error: string; status: number };

/**
 * Cria (visitante anônimo) ou reaproveita (sessão já logada) a conta do usuário, e cria ou
 * atualiza o AdvertiserProfile correspondente — nunca muda o `role` do usuário aqui (isso só
 * acontece quando o admin aprova a solicitação, ver Task 12). Se o perfil já existir (ex.:
 * tentativa anterior rejeitada, perfil ficou órfão), atualiza os dados em vez de duplicar.
 */
export async function requestAdvertiserAccount(
  input: RequestAdvertiserInput,
): Promise<RequestAdvertiserResult> {
  if (!isValidDocument(input.profile.document)) {
    return { ok: false, error: "CPF ou CNPJ inválido", status: 400 };
  }

  let userId: string;

  if (input.existingUserId) {
    userId = input.existingUserId;
  } else {
    if (!input.newAccount) {
      return { ok: false, error: "Dados da conta são obrigatórios", status: 400 };
    }

    if (!(await hasValidMxRecord(input.newAccount.email))) {
      return { ok: false, error: "Domínio de e-mail inválido ou inexistente", status: 400 };
    }

    const exists = await db.user.findUnique({ where: { email: input.newAccount.email } });
    if (exists) {
      return { ok: false, error: "E-mail já cadastrado", status: 409 };
    }

    const passwordHash = await bcrypt.hash(input.newAccount.password, 12);
    const user = await db.user.create({
      data: {
        name: input.newAccount.name,
        email: input.newAccount.email,
        passwordHash,
        role: "ATHLETE",
      },
      select: { id: true },
    });
    userId = user.id;
  }

  const existingProfile = await db.advertiserProfile.findUnique({ where: { userId } });

  const profileData = {
    companyName: input.profile.companyName,
    document: input.profile.document,
    address: input.profile.address,
    contactEmail: input.profile.contactEmail,
    contactPhone: input.profile.contactPhone,
    instagram: input.profile.instagram ?? null,
    facebook: input.profile.facebook ?? null,
  };

  const advertiserProfile = existingProfile
    ? await db.advertiserProfile.update({ where: { id: existingProfile.id }, data: profileData })
    : await db.advertiserProfile.create({ data: { userId, ...profileData } });

  return { ok: true, userId, advertiserId: advertiserProfile.id };
}
