# Requisitos do Sistema

## Perfis de usuário
- Visitante
- Atleta
- Organizador
- Administrador
- Operador de suporte
- Cronometragem/parceiro externo

## Requisitos funcionais

### Eventos
- Criar, editar, duplicar e arquivar eventos.
- Definir modalidade: corrida de rua, caminhada, trail, MTB, ciclismo, outros.
- Configurar data, local, largada, retirada de kit, regulamento, imagens, mapas e contatos.
- Controlar status: rascunho, em análise, publicado, inscrições abertas, esgotado, encerrado, realizado, cancelado.

### Inscrições
- Cadastro individual de atleta.
- Inscrição com categoria, percurso, lote, tamanho de camiseta, equipe/assessoria, dados médicos e contato de emergência.
- Inscrições para terceiros.
- Campo para documentos do atleta quando necessário.
- Termo de responsabilidade por evento.
- Número de peito gerado automaticamente ou importado.

### Pagamentos
- Pix, cartão e boleto quando disponível pelo provedor.
- Webhook de pagamento.
- Status: pendente, pago, expirado, cancelado, estornado, chargeback.
- Cálculo de taxa da plataforma e taxa do PSP.
- Relatório financeiro por evento.
- Repasse ao organizador com controle administrativo.

### Organizador
- Dashboard de vendas.
- Lista de inscritos com filtros.
- Exportação CSV/XLSX.
- Gestão de lotes e cupons.
- Comunicação básica com inscritos.
- Upload de regulamento.
- Solicitação de publicação.

### Administração
- Aprovação de eventos.
- Gestão de usuários e permissões.
- Gestão de taxas.
- Moderação de conteúdo.
- Auditoria de pagamentos.
- Controle de repasses.
- Relatórios globais.

### Resultados
- Importação CSV.
- Consulta por nome, número, categoria, sexo, faixa etária e percurso.
- Página pública de resultados.

## Requisitos não funcionais
- Segurança por autenticação robusta e RBAC.
- Observabilidade: logs, métricas, tracing e alertas.
- Performance: páginas públicas cacheáveis.
- LGPD: consentimento, minimização, finalidade e exclusão/anomização.
- Backup diário.
- Testes automatizados.
- Auditoria de eventos financeiros.
