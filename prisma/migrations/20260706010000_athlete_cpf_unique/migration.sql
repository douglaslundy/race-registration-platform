-- Garante que cada CPF de atleta seja usado por no máximo uma conta.
-- Postgres permite múltiplos valores NULL num índice único, então contas
-- com cadastro ainda incompleto (cpf = NULL) não são afetadas.
CREATE UNIQUE INDEX "athlete_profiles_cpf_key" ON "athlete_profiles"("cpf");
