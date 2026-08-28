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
    };
  }

  interface User {
    role: UserRole;
  }
}


export type { UserRole };
