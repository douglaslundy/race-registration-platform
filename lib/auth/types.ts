import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      /** Espelha `User.active`. Recarregado do banco a cada refresh do JWT. */
      active: boolean;
      /**
       * `true` quando o token foi emitido ANTES da última troca de senha (M9/C-1) —
       * é um token revogado, não uma conta bloqueada. O `proxy.ts` manda esse caso
       * pro login (401 / `/auth/login`), não pra `/acesso-negado`.
       */
      revoked: boolean;
    };
  }

  interface User {
    role: UserRole;
    /** Época (`Date`) da última troca de senha, carregada no login pra semear `token.pwdEpoch`. */
    passwordChangedAt?: Date | null;
  }
}


export type { UserRole };
