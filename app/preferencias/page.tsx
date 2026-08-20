import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import PreferenciasForm from "./PreferenciasForm";

export default async function PreferenciasPage() {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?callbackUrl=/preferencias");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { receivePromotionalMessages: true, receiveEventMessages: true },
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-lg">
        <div className="card space-y-4">
          <h1 className="text-xl font-bold">Preferências de comunicação</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Escolha quais mensagens você quer receber por e-mail e WhatsApp. A alteração vale
            imediatamente.
          </p>
          <PreferenciasForm
            initialReceiveEventMessages={user?.receiveEventMessages ?? true}
            initialReceivePromotionalMessages={user?.receivePromotionalMessages ?? true}
          />
        </div>
      </div>
    </div>
  );
}
