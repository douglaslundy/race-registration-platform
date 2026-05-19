import type { Metadata } from "next";
import LoginForm from "@/components/auth/LoginForm";
import { getAppName } from "@/lib/settings";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  const appName = await getAppName();
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary-900 dark:text-primary-400">{appName}</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Entre na sua conta</p>
        </div>
        <div className="card">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
