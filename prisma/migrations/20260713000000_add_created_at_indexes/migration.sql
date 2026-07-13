-- Índices ausentes em createdAt: usados por Atividade recente/auditoria (audit_logs) e pelos
-- gráficos de dashboard (users/registrations/orders), sem nenhum índice de suporte até aqui
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");
CREATE INDEX "registrations_createdAt_idx" ON "registrations"("createdAt");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");
