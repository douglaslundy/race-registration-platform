-- CPF do usuário (organizador/admin) - opcional, sem unicidade
ALTER TABLE "users" ADD COLUMN "cpf" TEXT;
