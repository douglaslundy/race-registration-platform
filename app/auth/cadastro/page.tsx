import type { Metadata } from "next";
import RegisterForm from "@/components/auth/RegisterForm";
import { getAppName } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Criar Conta" };

export default async function CadastroPage() {
  const appName = await getAppName();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary-900 dark:text-primary-400">{appName}</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Crie sua conta gratuitamente</p>
        </div>
        <div className="card">
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
