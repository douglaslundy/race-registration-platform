import type { UserRole } from "@prisma/client";
import { auth } from "./index";
import { redirect } from "next/navigation";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login");
  return session;
}

export async function requireRole(roles: UserRole[]) {
  const session = await requireAuth();
  if (!roles.includes(session.user.role as UserRole)) {
    redirect("/acesso-negado");
  }
  return session;
}

export async function requireAdmin() {
  return requireRole(["ADMIN"]);
}

export async function requireOrganizer() {
  return requireRole(["ORGANIZER", "ADMIN"]);
}
