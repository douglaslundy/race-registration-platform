import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { buildAdminUserOrderBy, buildAdminUserWhere, escapeCsvValue } from "@/lib/admin/users";

const roleSchema = z.enum(["ATHLETE", "ORGANIZER", "ADMIN", "SUPPORT", "PARTNER"]);

const createSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8),
  role: roleSchema,
  active: z.boolean().optional().default(true),
});

async function requireAdminSession() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return null;
  }
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format");
  if (format !== "csv") {
    return NextResponse.json({ error: "Formato não suportado" }, { status: 400 });
  }

  const q = searchParams.get("q")?.trim() ?? "";
  const role = searchParams.get("role")?.trim() ?? "ALL";
  const status = searchParams.get("status")?.trim() ?? "ALL";
  const createdFrom = searchParams.get("createdFrom")?.trim() ?? "";
  const createdTo = searchParams.get("createdTo")?.trim() ?? "";
  const sort = searchParams.get("sort")?.trim() ?? "createdAt";
  const dir = searchParams.get("dir")?.trim() ?? "desc";

  const where = buildAdminUserWhere({ q, role, status, createdFrom, createdTo });
  const orderBy = buildAdminUserOrderBy(sort, dir).orderBy;

  const users = await db.user.findMany({
    where,
    orderBy,
    select: {
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
      _count: { select: { registrations: true, orders: true } },
    },
  });

  const header = ["Nome", "Email", "Perfil", "Status", "Inscrições", "Pedidos", "Cadastro"].map(escapeCsvValue).join(",") + "\n";
  const rows = users
    .map((user) =>
      [
        user.name,
        user.email,
        user.role,
        user.active ? "Ativo" : "Bloqueado",
        user._count.registrations,
        user._count.orders,
        user.createdAt.toISOString(),
      ]
        .map(escapeCsvValue)
        .join(","),
    )
    .join("\n");

  return new NextResponse(header + rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="usuarios.csv"',
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase();
    const exists = await db.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json({ error: "E-mail já cadastrado" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    const user = await db.user.create({
      data: {
        name: parsed.data.name.trim(),
        email,
        passwordHash,
        role: parsed.data.role,
        active: parsed.data.active,
      },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "USER_CREATED",
        entityType: "User",
        entityId: user.id,
        metadata: { role: user.role, active: user.active },
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    console.error("[admin/users] create error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
