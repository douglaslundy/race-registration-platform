import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";
import { normalizeCep, isValidCep } from "@/lib/cep";
import { hasValidMxRecord } from "@/lib/validate-email-domain";
import { zodErrorResponse } from "@/lib/http/zod-error";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

const registerSchema = z
  .object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["ATHLETE", "ORGANIZER"]).default("ATHLETE"),
    birthDate: z.string().optional(),
    cpf: z.string().optional(),
    phone: z.string().optional(),
    postalCode: z.string().optional(),
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role !== "ATHLETE") return;

    if (!data.birthDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Data de nascimento é obrigatória",
        path: ["birthDate"],
      });
    }

    if (!data.cpf) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF é obrigatório",
        path: ["cpf"],
      });
    } else if (!isValidCpf(data.cpf)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CPF inválido",
        path: ["cpf"],
      });
    }

    if (!data.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Telefone é obrigatório",
        path: ["phone"],
      });
    } else if (data.phone.replace(/\D/g, "").length < 10) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Telefone inválido",
        path: ["phone"],
      });
    }

    if (!data.postalCode || !isValidCep(data.postalCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CEP é obrigatório e deve ser válido",
        path: ["postalCode"],
      });
    }

    if (!data.street) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Rua/logradouro é obrigatório",
        path: ["street"],
      });
    }

    if (!data.number) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Número é obrigatório",
        path: ["number"],
      });
    }

    if (!data.neighborhood) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bairro é obrigatório",
        path: ["neighborhood"],
      });
    }

    if (!data.city) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cidade é obrigatória",
        path: ["city"],
      });
    }

    if (!data.state) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Estado é obrigatório",
        path: ["state"],
      });
    }
  });

export async function POST(req: NextRequest) {
  try {
    const { allowed } = checkRateLimit(`register:${getClientIp(req)}`, RATE_LIMITS.AUTH);
    if (!allowed) {
      return NextResponse.json({ error: "Muitas tentativas. Aguarde um minuto e tente novamente." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return zodErrorResponse(parsed.error);
    }

    const {
      name, email, password, role, birthDate, cpf, phone,
      postalCode, street, number, complement, neighborhood, city, state,
    } = parsed.data;

    if (!(await hasValidMxRecord(email))) {
      return NextResponse.json({ error: "Domínio de e-mail inválido ou inexistente" }, { status: 400 });
    }

    const exists = await db.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
    }

    let normalizedCpf: string | undefined;
    if (role === "ATHLETE" && cpf) {
      normalizedCpf = normalizeCpf(cpf);
      const cpfTaken = await db.athleteProfile.findFirst({ where: { cpf: normalizedCpf } });
      if (cpfTaken) {
        return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await db.user.create({
      data: { name, email, passwordHash, role },
      select: { id: true, name: true, email: true, role: true },
    });

    if (role === "ATHLETE" && birthDate) {
      try {
        await db.athleteProfile.create({
          data: {
            userId: user.id,
            birthDate: new Date(birthDate),
            cpf: normalizedCpf,
            phone,
            postalCode: postalCode ? normalizeCep(postalCode) : undefined,
            street,
            number,
            complement,
            neighborhood,
            city,
            state,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return NextResponse.json({ error: "Este CPF já está cadastrado em outra conta" }, { status: 409 });
        }
        throw error;
      }
    }

    await db.auditLog.create({
      data: { userId: user.id, action: "USER_REGISTERED", entityType: "User", entityId: user.id },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    console.error("[register] error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
