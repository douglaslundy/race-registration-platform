import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-4">Erro de autenticação</h1>
        <p className="text-gray-600 mb-6">Ocorreu um erro ao tentar acessar sua conta.</p>
        <Link href="/auth/login" className="btn-primary">Voltar ao login</Link>
      </div>
    </div>
  );
}
