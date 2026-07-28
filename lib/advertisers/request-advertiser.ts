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
 *
 * No caminho anônimo, a criação do User e do AdvertiserProfile acontece na mesma transação
 * (mesmo padrão de `app/api/auth/register-advertiser/route.ts` e `lib/advertisers/promote.ts`) —
 * assim uma falha no meio do caminho nunca deixa um User(role=ATHLETE) órfão sem perfil, o que
 * bloquearia permanentemente aquele e-mail (o retry cairia no "E-mail já cadastrado").
 */
export async function requestAdvertiserAccount(
  input: RequestAdvertiserInput,
): Promise<RequestAdvertiserResult> {
  if (!isValidDocument(input.profile.document)) {
    return { ok: false, error: "CPF ou CNPJ inválido", status: 400 };
  }

  const profileData = {
    companyName: input.profile.companyName,
    document: input.profile.document,
    address: input.profile.address,
    contactEmail: input.profile.contactEmail,
    contactPhone: input.profile.contactPhone,
    instagram: input.profile.instagram ?? null,
    facebook: input.profile.facebook ?? null,
  };

  if (input.existingUserId) {
    const userId = input.existingUserId;
    const existingProfile = await db.advertiserProfile.findUnique({ where: { userId } });
    const advertiserProfile = existingProfile
      ? await db.advertiserProfile.update({ where: { id: existingProfile.id }, data: profileData })
      : await db.advertiserProfile.create({ data: { userId, ...profileData } });

    return { ok: true, userId, advertiserId: advertiserProfile.id };
  }

  const newAccount = input.newAccount;
  if (!newAccount) {
    return { ok: false, error: "Dados da conta são obrigatórios", status: 400 };
  }

  if (!(await hasValidMxRecord(newAccount.email))) {
    return { ok: false, error: "Domínio de e-mail inválido ou inexistente", status: 400 };
  }

  const exists = await db.user.findUnique({ where: { email: newAccount.email } });
  if (exists) {
    return { ok: false, error: "E-mail já cadastrado", status: 409 };
  }

  const passwordHash = await bcrypt.hash(newAccount.password, 12);

  const { userId, advertiserId } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: newAccount.name,
        email: newAccount.email,
        passwordHash,
        role: "ATHLETE",
      },
      select: { id: true },
    });

    const existingProfile = await tx.advertiserProfile.findUnique({ where: { userId: user.id } });
    const advertiserProfile = existingProfile
      ? await tx.advertiserProfile.update({ where: { id: existingProfile.id }, data: profileData })
      : await tx.advertiserProfile.create({ data: { userId: user.id, ...profileData } });

    return { userId: user.id, advertiserId: advertiserProfile.id };
  });

  return { ok: true, userId, advertiserId };
}
