import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isValidCpf, normalizeCpf } from "@/lib/cpf";

const registerSchema = z
  .object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    password: z.string().min(8),
    role: z.enum(["ATHLETE", "ORGANIZER"]).default("ATHLETE"),
    birthDate: z.string().optional(),
    cpf: z.string().optional(),
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
  });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { name, email, password, role, birthDate, cpf } = parsed.data;

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
          data: { userId: user.id, birthDate: new Date(birthDate), cpf: normalizedCpf },
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
