# Análise de todas as ações do sistema (admin + organizador)

> Documento de referência, não uma spec de feature. Levantamento exaustivo de toda ação
> mutável e toda exportação/leitura relevante disponível para admin e organizador, feito como
> pré-requisito explícito pedido pelo usuário antes de desenhar o sistema de usuários
> assistentes (permissões granulares). Servirá de base para a spec de permissões.

Legenda: **[W]** = ação de escrita/mutação, **[R]** = leitura/exportação.

---

## 1. Eventos (Events)

### Admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Aprovar evento (publica e abre inscrições) | `app/api/admin/events/[id]/approve/route.ts` | POST | W |
| Rejeitar evento (volta para rascunho) | `app/api/admin/events/[id]/reject/route.ts` | POST | W |
| Definir taxa de plataforma do evento | `app/api/admin/events/[id]/fee/route.ts` | PATCH | W |
| Pré-visualizar repasse elegível de um evento | `app/api/admin/events/[id]/payouts/preview/route.ts` | GET | R |
| Gerar repasse (payout) de um evento | `app/api/admin/events/[id]/payouts/route.ts` | POST | W |
| Exportar CSV de todos os eventos (qualquer organizador) | `app/api/admin/events/export/route.ts` | GET | R |
| Editar evento (qualquer evento, sem checar dono) | `app/api/events/[id]/route.ts` | PATCH | W |
| Excluir evento (qualquer evento, sem checar dono; só DRAFT/CANCELLED sem vínculos) | `app/api/events/[id]/route.ts` | DELETE | W |
| Arquivar/cancelar evento (bypass de dono via `role === ADMIN`) | `app/api/events/[id]/archive/route.ts` | POST | W |

### Organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Criar evento | `app/api/events/route.ts` | POST | W |
| Editar evento próprio (título, datas, banners, política de cancelamento etc.) | `app/api/events/[id]/route.ts` | PATCH | W |
| Excluir evento próprio (só DRAFT/CANCELLED sem inscrições/pedidos/repasses/imports) | `app/api/events/[id]/route.ts` | DELETE | W |
| Arquivar/cancelar evento próprio | `app/api/events/[id]/archive/route.ts` | POST | W |
| Duplicar evento próprio (clona rotas, categorias, lotes) | `app/api/events/[id]/duplicate/route.ts` | POST | W |
| Publicar evento (submeter para análise — via PATCH status `UNDER_REVIEW`) | `app/api/events/[id]/route.ts` | PATCH | W |
| Exportar CSV "meus eventos" | `app/api/organizer/events/export/route.ts` | GET | R |
| Upload de arquivo (banner, banner de lista, regulamento, info do kit) | `app/api/upload/route.ts` | POST | W |

**Nota (multi-responsabilidade):** `app/api/events/[id]/route.ts` PATCH é um único handler que pode
mudar qualquer combinação de título/datas/local/banners/**status** (DRAFT→UNDER_REVIEW)/política
de cancelamento numa única chamada — "publicar evento" e "editar metadados do evento" são o mesmo
endpoint sem semântica distinta. Um modelo de permissão granular precisa decidir se separa isso
conceitualmente (ex.: "pode editar dados do evento" vs. "pode submeter para análise") ou aceita
que é tudo-ou-nada nessa rota.

**Nota:** a rota `archive` é nominalmente compartilhada (dono organizador OU bypass admin), por
isso aparece nas duas listas. `duplicate` **não tem** bypass de admin (`organizer: { userId }`
apenas) — um admin sem `OrganizerProfile` próprio não consegue usá-la.

---

## 2. Lotes, Categorias, Percursos (Batches / Categories / Routes)

Existem só na árvore compartilhada `app/api/events/**` e **não têm bypass de admin** nenhum
(checam `organizer: { userId: session.user.id }` apenas) — só organizadores conseguem usá-las
para os próprios eventos; admin não consegue via API a menos que tenha `OrganizerProfile`
próprio. Não existe página admin para isso.

### Somente organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Listar lotes de um evento | `app/api/events/[id]/batches/route.ts` | GET | R |
| Criar lote de ingresso | `app/api/events/[id]/batches/route.ts` | POST | W |
| Editar lote (preço, capacidade, ativação, datas, ativo/inativo) | `app/api/events/[id]/batches/[batchId]/route.ts` | PATCH | W |
| Excluir lote | `app/api/events/[id]/batches/[batchId]/route.ts` | DELETE | W |
| Listar categorias | `app/api/events/[id]/categories/route.ts` | GET | R |
| Criar categoria | `app/api/events/[id]/categories/route.ts` | POST | W |
| Editar categoria | `app/api/events/[id]/categories/[categoryId]/route.ts` | PATCH | W |
| Excluir categoria | `app/api/events/[id]/categories/[categoryId]/route.ts` | DELETE | W |
| Listar percursos | `app/api/events/[id]/routes/route.ts` | GET | R |
| Criar percurso | `app/api/events/[id]/routes/route.ts` | POST | W |
| Editar percurso | `app/api/events/[id]/routes/[routeId]/route.ts` | PATCH | W |
| Excluir percurso | `app/api/events/[id]/routes/[routeId]/route.ts` | DELETE | W |

**Achado estrutural:** admin editando lotes/categorias/percursos de um organizador hoje só
funciona se o admin também possuir `OrganizerProfile` casando com o evento — efetivamente
quebrado/não suportado para admins normais. Qualquer permissão de "assistente admin" sobre essas
ações estaria checando uma capacidade que a conta admin principal nem exerce hoje.

---

## 3. Cupons (Coupons)

### Admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Criar cupom (evento específico OU global — `eventId: null`) | `app/api/admin/coupons/route.ts` | POST | W |
| Editar cupom (ativo/inativo, máx. usos, expiração) | `app/api/admin/coupons/[id]/route.ts` | PATCH | W |
| Excluir cupom (bloqueado se já usado em pedido) | `app/api/admin/coupons/[id]/route.ts` | DELETE | W |
| Exportar CSV de todos os cupons (com uso agregado) | `app/api/admin/coupons/export/route.ts` | GET | R |

### Organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Listar cupons de um evento próprio | `app/api/events/[id]/coupons/route.ts` | GET | R |
| Criar cupom de evento (não pode criar cupom global) | `app/api/events/[id]/coupons/route.ts` | POST | W |
| Editar cupom (máx. usos, expiração) | `app/api/events/[id]/coupons/[couponId]/route.ts` | PATCH | W |
| Excluir cupom | `app/api/events/[id]/coupons/[couponId]/route.ts` | DELETE | W |
| Pré-visualizar desconto de cupom no checkout | `app/api/events/[id]/coupons/preview/route.ts` | GET | R |
| Exportar CSV de uso de cupons de um evento | `app/api/events/[id]/coupons/report-export/route.ts` | GET | R |

**Nota:** cupom de admin (`app/api/admin/coupons/**`) e cupom de organizador
(`app/api/events/[id]/coupons/**`) são famílias de rota completamente separadas (não é a mesma
ação reusada) — tratar como nós de permissão distintos mesmo sendo o mesmo recurso conceitual.

---

## 4. Inscrições e Pedidos (Registrations & Orders)

### Admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Decidir solicitação de cancelamento (aprovar/rejeitar) | `app/api/admin/registrations/[id]/cancellation-decision/route.ts` | POST | W |
| Reenviar e-mail de confirmação de inscrição | `app/api/admin/registrations/[id]/resend-confirmation-email/route.ts` | POST | W |
| Reenviar notificação de erro de pagamento/pedido cancelado | `app/api/admin/registrations/[id]/resend-payment-notification/route.ts` | POST | W |
| Expirar pagamentos pendentes/pedidos abandonados manualmente (plataforma inteira) | `app/api/admin/expire-payments/route.ts` | POST | W |
| Ver/exportar inscritos de qualquer evento (CSV ou JSON) | `app/api/events/[id]/registrations/route.ts` | GET | R |

### Organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Decidir solicitação de cancelamento (evento próprio) | `app/api/organizer/registrations/[id]/cancellation-decision/route.ts` | POST | W |
| Confirmar inscrição manualmente (marca pagamento como pago sem gateway) | `app/api/organizer/registrations/[id]/manual-confirm/route.ts` | POST | W |
| Editar dados do atleta de uma inscrição | `app/api/organizer/registrations/[id]/athlete/route.ts` | PATCH | W |
| Reenviar e-mail de confirmação | `app/api/organizer/registrations/[id]/resend-confirmation-email/route.ts` | POST | W |
| Reenviar notificação de erro de pagamento | `app/api/organizer/registrations/[id]/resend-payment-notification/route.ts` | POST | W |
| Expirar pagamentos pendentes/pedidos abandonados (escopo do próprio organizador) | `app/api/organizer/expire-payments/route.ts` | POST | W |
| Ver/exportar inscritos de evento próprio (CSV ou JSON) | `app/api/events/[id]/registrations/route.ts` | GET | R |

---

## 5. Pagamentos e Estornos (Payments & Refunds)

### Admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Estornar pagamento (qualquer pagamento) | `app/api/admin/payments/[id]/refund/route.ts` | POST | W |
| Resolver estorno manualmente (quando gateway falha) | `app/api/admin/refunds/[paymentId]/manual-resolve/route.ts` | POST | W |
| Conciliar pagamentos com o gateway (toda a plataforma) | `app/api/admin/reconciliation/route.ts` | POST | W |
| Exportar CSV de um pagamento específico (detalhado) | `app/api/admin/payments/[id]/export/route.ts` | GET | R |
| Exportar CSV de todos os pagamentos (com filtros) | `app/api/admin/payments/export/route.ts` | GET | R |

### Organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Estornar pagamento de inscrição (evento próprio) | `app/api/organizer/registrations/[id]/refund/route.ts` | POST | W |
| Resolver estorno manualmente (evento próprio) | `app/api/organizer/refunds/[paymentId]/manual-resolve/route.ts` | POST | W |
| Conciliar pagamentos com o gateway (escopo do organizador) | `app/api/organizer/reconciliation/route.ts` | POST | W |

**Nota:** rota de estorno do admin recebe `paymentId` bruto; a do organizador recebe
`registrationId` e busca o último pagamento pago — mesmo serviço `refundPayment()` por trás,
contratos de API diferentes. Tratar como a mesma permissão conceitual ("Estornar pagamento").

---

## 6. Repasses (Payouts) — só admin, sem mutação pelo organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Gerar repasse | `app/api/admin/events/[id]/payouts/route.ts` | POST | W |
| Pré-visualizar totais elegíveis | `app/api/admin/events/[id]/payouts/preview/route.ts` | GET | R |
| Atualizar status de repasse (Processing/Completed/Failed + nota) | `app/api/admin/payouts/[id]/route.ts` | PATCH | W |
| Exportar CSV de todos os repasses | `app/api/admin/payouts/export/route.ts` | GET | R |

Organizador não tem rota de mutação de repasse — só vê totais refletidos no próprio relatório
(§7). Geração/status de repasse é controle financeiro de plataforma, faz sentido continuar
admin-only.

---

## 7. Relatórios / Conciliação (Reports & Reconciliation)

### Admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Exportar relatório financeiro da plataforma (CSV, por período/evento) | `app/api/admin/report/export/route.ts` | GET | R |
| Conciliar pagamentos (ver §5) | `app/api/admin/reconciliation/route.ts` | POST | W |

### Organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Exportar relatório financeiro do organizador (CSV, escopo próprio) | `app/api/organizer/report/export/route.ts` | GET | R |
| Conciliar pagamentos (escopo próprio) | `app/api/organizer/reconciliation/route.ts` | POST | W |

---

## 8. Carrinhos Abandonados (Abandoned Carts)

### Admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Reenviar alerta (um pedido ou todos que casam com filtro) | `app/api/admin/abandoned-carts/notify/route.ts` | POST | W |

### Organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Reenviar alerta (escopo do organizador) | `app/api/organizer/abandoned-carts/notify/route.ts` | POST | W |

**Nota (multi-responsabilidade):** ambas as rotas aceitam `{ orderId }` (individual) OU
`{ all, q, event, dateFrom, dateTo }` (em massa) no mesmo corpo — envio único e envio em massa são
o mesmo endpoint com semânticas diferentes. Tratar como o mesmo nó de permissão ("enviar alerta de
carrinho abandonado"), mas o envio em massa pode atingir muitos destinatários sob um único check.

---

## 9. Usuários (Users) — só admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Listar/exportar CSV de usuários (com filtros) | `app/api/admin/users/route.ts` | GET (`?format=csv`) | R |
| Criar usuário (qualquer role) | `app/api/admin/users/route.ts` | POST | W |
| Editar usuário — nome/e-mail/**role**/ativo-bloqueado/senha/CPF/perfil de atleta, tudo numa chamada | `app/api/admin/users/[id]/route.ts` | PATCH | W |
| Excluir usuário (bloqueado se tiver pedidos/inscrições) | `app/api/admin/users/[id]/route.ts` | DELETE | W |
| Exportar CSV de inscrições de um usuário específico | `app/api/admin/users/[id]/export/route.ts` | GET | R |

**Nota (multi-responsabilidade — a mais relevante para o desenho de permissões):**
`app/api/admin/users/[id]/route.ts` PATCH atende pelo menos três componentes de UI diferentes que
deveriam quase certamente ser permissões separadas:
- `ChangeUserRoleButton.tsx` → envia só `{ role }` (**promover/rebaixar usuário, inclusive
  conceder ADMIN**)
- `ToggleUserActiveButton.tsx` → envia só `{ active }` (**bloquear/desbloquear conta**)
- `UserForm.tsx` → envia o formulário completo (nome/e-mail/CPF/data nasc./telefone/gênero/
  cidade/estado/equipe/tamanho de camisa, e opcionalmente `{ password }` para **redefinir a
  senha**)

As quatro ações (trocar papel, bloquear/desbloquear, editar perfil, redefinir senha) batem na
mesma rota/método sem forma de distinguir intenção no servidor além de quais campos vieram no
corpo. Se o modelo de permissão quiser "assistente pode editar perfil mas NÃO promover a admin
nem redefinir senha," essa rota única não consegue impor essa distinção hoje — precisaria de
checagem de permissão baseada no formato do payload, ou de dividir a rota.

Não existe equivalente organizador para gestão de usuários da plataforma (organizador só edita o
registro de *atleta* vinculado a uma inscrição própria — ver §4).

---

## 10. Configurações da Plataforma (Platform Settings) — só admin
| Ação (conforme cada formulário de UI) | Rota | Método | Tipo |
|---|---|---|---|
| Nome do app / branding | `app/api/admin/settings/route.ts` | POST | W |
| Intervalo do banner rotativo | `app/api/admin/settings/route.ts` | POST | W |
| Toggle de política de cancelamento | `app/api/admin/settings/route.ts` | POST | W |
| Taxa de plataforma padrão | `app/api/admin/settings/route.ts` | POST | W |
| Configuração do gateway de pagamento (credenciais) | `app/api/admin/settings/route.ts` | POST | W |
| Métodos de pagamento habilitados | `app/api/admin/settings/route.ts` | POST | W |
| Taxa de serviço | `app/api/admin/settings/route.ts` | POST | W |
| Configurações de SMTP | `app/api/admin/settings/route.ts` | POST | W |
| Configurações de storage | `app/api/admin/settings/route.ts` | POST | W |
| Credenciais do WhatsApp (Evolution API) | `app/api/admin/settings/route.ts` | POST | W |
| Configuração de alertas | `app/api/admin/settings/route.ts` | POST | W |
| Testar envio de e-mail (SMTP) | `app/api/admin/smtp/test/route.ts` | POST | W |
| Conteúdo legal — Termos/Privacidade (ver/editar) | `app/api/admin/legal/route.ts` | GET / PUT | R / W |

**Nota (multi-responsabilidade mais severa do app):** `app/api/admin/settings/route.ts` (POST) é
um upsert genérico `{ key: string, value: string }` em `PlatformSetting`, atendendo **pelo menos
11 domínios de configuração completamente não relacionados** (branding, credenciais de gateway de
pagamento, credenciais SMTP, credenciais de storage, credenciais WhatsApp, taxas, toggles,
limiares de alerta) — tudo por um único endpoint sem validar quais `key`s o chamador pode tocar.
Prioridade máxima pra redesenhar antes de expor a assistentes: "assistente pode ligar a política
de cancelamento" não pode implicitamente conceder "assistente pode reescrever a chave da API do
gateway de pagamento", mas hoje os dois passam pelo mesmo endpoint/checagem de permissão.
Recomendação: mapear o namespace real de `key` (`lib/settings.ts`, `lib/smtp-settings.ts`,
`lib/storage-settings.ts`, `lib/payment-settings.ts`, `lib/whatsapp-settings.ts`) e construir um
esquema de sub-permissão por prefixo de chave antes de expor isso a assistentes.

Organizador não tem acesso a configurações de plataforma (nenhuma rota
`app/api/organizer/settings` existe).

---

## 11. WhatsApp (Integração de Plataforma) — só admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Consultar status da conexão | `app/api/admin/whatsapp/status/route.ts` | GET | R |
| Criar instância / gerar QR code | `app/api/admin/whatsapp/instance/route.ts` | POST | W |
| Desconectar instância | `app/api/admin/whatsapp/disconnect/route.ts` | POST | W |
| Excluir instância | `app/api/admin/whatsapp/delete/route.ts` | POST | W |
| Enviar mensagem de teste | `app/api/admin/whatsapp/test/route.ts` | POST | W |

Sem equivalente organizador — integração de WhatsApp é infraestrutura de plataforma, não por
organizador.

---

## 12. Auditoria (Audit Log) — só admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Exportar CSV do log de auditoria (com filtros) | `app/api/admin/audit/export/route.ts` | GET | R |

Não há rota JSON separada de "visualizar" além da exportação — a página lê direto via server
component. Sem equivalente organizador.

---

## 13. Backup e Restauração (Backup/Restore) — só admin, RISCO ALTO
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Baixar backup completo do banco (JSON, todas as tabelas) | `app/api/admin/backup/route.ts` | GET | R (exporta todo PII/dado financeiro da plataforma) |
| Restaurar backup (**apaga TODAS as tabelas e reimporta do arquivo enviado**) | `app/api/admin/backup/import/route.ts` | POST | W — destrutivo, wipe+reload de banco inteiro |

**Risco extremo, provavelmente deve ficar fora de qualquer conjunto de permissão de assistente,
ou exigir um nível "super-admin" dedicado.** A rota de import apaga toda linha de 19 tabelas numa
transação antes de reimportar; não há como escopar por organizador, atua na plataforma inteira.

---

## 14. Resultados (Race Results)

### Compartilhado (organizador para evento próprio / admin para qualquer evento via bypass de dono)
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Importar resultados via CSV | `app/api/events/[id]/results/route.ts` | POST | W |
| Publicar um import de resultados | `app/api/events/[id]/results/route.ts` | PATCH | W |

**Nota:** diferente de `admin/settings` e `admin/users/[id]`, aqui "importar" (POST) e "publicar"
(PATCH) já são separados por método HTTP, então podem ser controlados independentemente se o
modelo de permissão usar método+caminho como chave.

---

## 15. Notificações / Resumo Diário (Daily Summary Recipients)

### Compartilhado (admin e organizador, cada um gerencia sua própria lista)
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Listar destinatários próprios | `app/api/daily-summary-recipients/route.ts` | GET | R |
| Adicionar destinatário | `app/api/daily-summary-recipients/route.ts` | POST | W |
| Remover destinatário | `app/api/daily-summary-recipients/[id]/route.ts` | DELETE | W |

Sempre escopado a `userId: session.user.id`, sem risco cross-tenant, mas ainda é uma ação de
mutação que precisaria de nó de permissão num modelo de assistente.

---

## 16. Perfil / Conta Pessoal

### Admin
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Ver perfil pessoal | `app/api/admin/profile/route.ts` | GET | R |
| Editar perfil pessoal / preferências de notificação | `app/api/admin/profile/route.ts` | PUT | W |

### Organizador
| Ação | Rota | Método | Tipo |
|---|---|---|---|
| Ver conta pessoal | `app/api/organizer/account/route.ts` | GET | R |
| Editar conta pessoal / preferências de notificação | `app/api/organizer/account/route.ts` | PUT | W |
| Ver perfil de organizador (razão social, CNPJ, site, bio) | `app/api/organizer/profile/route.ts` | GET | R |
| Editar/criar perfil de organizador (upsert) | `app/api/organizer/profile/route.ts` | PUT | W |

Inerentemente "só eu mesmo" (`session.user.id`) — provavelmente fora de escopo pra um assistente
(um assistente age em nome da organização, não edita a conta pessoal do organizador), mas listado
por completude.

---

# Resumo dos achados que vão orientar o desenho de permissões

**A. Ações admin-only que poderiam fazer sentido pra um assistente escopado a organizador**
(anotado, não decidido): a maioria já tem equivalente organizador dedicado (cancelamento,
reenvio de e-mail, expirar pagamentos). O gap real é **cupom global** (organizador só cria cupom
por evento, nunca global) — se assistentes precisarem disso, hoje não é suportado nem pro
organizador titular.

**B. Rotas sem responsabilidade única (precisam de tratamento especial no modelo de permissão),
por severidade:**
1. **`app/api/admin/settings/route.ts` (POST)** — key/value genérico atendendo 11+ domínios não
   relacionados (branding, credenciais de gateway, SMTP, storage, WhatsApp, taxas, alertas).
   Prioridade máxima.
2. **`app/api/admin/users/[id]/route.ts` (PATCH)** — trocar papel (escalação de privilégio),
   bloquear/desbloquear, redefinir senha, e editar perfil, tudo na mesma rota.
3. **`abandoned-carts/notify`** (admin e organizador) — envio único vs. envio em massa no mesmo
   corpo.
4. **`app/api/events/[id]/route.ts` (PATCH)** — "editar evento" e "submeter pra análise"
   compartilham endpoint sem semântica distinta.
5. `app/api/events/[id]/results/route.ts` — severidade menor, POST/PATCH já separados por
   método.

**C. Achado estrutural relevante:** várias rotas "compartilhadas" sob `app/api/events/**`
(lotes, categorias, cupons de evento, percursos) **não têm bypass de admin** — checam só
`organizer: { userId: session.user.id }`. Um admin sem `OrganizerProfile` próprio não consegue
usá-las hoje. Qualquer permissão de "assistente admin" sobre essas ações estaria checando uma
capacidade que a própria conta admin titular não exerce.

**D. Ação de risco extremo a isolar explicitamente:** backup/restauração completa do banco
(`app/api/admin/backup/**`) — apaga e reimporta a plataforma inteira. Recomendação: nunca incluir
no conjunto de permissões disponível para um assistente, independente de quão "confiável" o
assistente seja configurado.
