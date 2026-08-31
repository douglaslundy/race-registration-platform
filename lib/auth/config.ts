import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { z } from "zod";
import { checkRateLimit, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

// Hash bcrypt fixo (cost 12) de uma senha que não corresponde a nenhuma conta. Usado pra
// rodar um `bcrypt.compare` no caminho de usuário inexistente/inativo, eliminando o oráculo
// de timing que permitia enumerar quais e-mails existem (o compare real leva ~250ms; sem
// esse dummy, o "não existe" retornava instantâneo). Ver M3 da auditoria 2026-08-31.
const DUMMY_PASSWORD_HASH = "$2a$12$SK3ctLIHQVTU1PrEFptwA.IqqFy6/ELsbmSy9aaicKtUvyeAEa1KK";

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/login",
    error: "/auth/erro",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // Duas chaves: por IP (evita força bruta distribuída contra várias contas) e por e-mail
        // (evita alguém martelando uma conta específica a partir de vários IPs).
        const ip = getClientIp(request);
        const ipCheck = checkRateLimit(`login:ip:${ip}`, RATE_LIMITS.LOGIN);
        // Chave por e-mail normalizada (lowercase) — sem isso, variar a caixa do e-mail
        // multiplicava o orçamento de tentativas por conta. (O lookup no banco continua
        // com o e-mail original: contas antigas podem ter caixa mista.)
        const emailCheck = checkRateLimit(
          `login:email:${parsed.data.email.toLowerCase()}`,
          RATE_LIMITS.LOGIN,
        );
        if (!ipCheck.allowed || !emailCheck.allowed) return null;

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
        });

        if (!user || !user.passwordHash || !user.active) {
          // Roda um compare falso pra igualar o tempo de resposta do caminho de usuário
          // válido (defesa contra enumeração por timing).
          await bcrypt.compare(parsed.data.password, DUMMY_PASSWORD_HASH);
          return null;
        }

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: string }).role;
        token.active = true; // `authorize` só devolve usuário ativo
        return token;
      }

      // Sessão JWT: sem re-leitura, `role`/`active` ficam congelados no token até ele expirar.
      // Isso quebrava o fluxo excluir → re-cadastrar: o assistente rebaixado para ATHLETE (ou
      // re-promovido) continuava com o papel antigo no token e era jogado pro /acesso-negado
      // pelo proxy, ou perdia o acesso que acabara de recuperar. Recarregamos a cada request —
      // é um lookup por PK (barato) e a área logada já consulta o banco a cada render mesmo.
      if (token.id) {
        try {
          const fresh = await db.user.findUnique({
            where: { id: token.id as string },
            select: { role: true, active: true, passwordChangedAt: true },
          });
          if (fresh) {
            token.role = fresh.role;
            token.active = fresh.active;
            // M9: token emitido ANTES da última troca de senha é considerado revogado —
            // um token roubado não sobrevive à troca. `iat` está em segundos.
            if (
              fresh.passwordChangedAt &&
              typeof token.iat === "number" &&
              token.iat * 1000 < fresh.passwordChangedAt.getTime()
            ) {
              token.active = false;
            }
          } else {
            // Usuário sumiu (exclusão física): invalida o papel — o proxy/guards barram.
            token.active = false;
          }
        } catch (err) {
          // Blip no banco não pode deslogar todo mundo — mantém o token como está.
          console.error("[auth] jwt refresh falhou, mantendo token atual:", err);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as import("@prisma/client").UserRole;
        session.user.active = token.active !== false;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      // Best-effort — nunca deve impedir o login se a gravação falhar.
      if (!user?.id) return;
      try {
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      } catch (err) {
        console.error("[auth] failed to update lastLoginAt:", err);
      }
    },
  },
};
