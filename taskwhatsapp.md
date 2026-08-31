Ajustei a especificação para seguir exatamente o fluxo que você definiu: `receive_promotional_messages = true` desde a criação do atleta, considerando a aceitação dos Termos de Uso como origem do consentimento; a preferência não aparece durante o cadastro e só poderá ser revogada posteriormente. Acrescentei também confirmação de entrega quando suportada pela versão/provider da Evolution API, tratamento de números inválidos/inexistentes, classificação da validade do WhatsApp e o bloco obrigatório de endereço com bloqueio da navegação para cadastros incompletos.

# INSTRUÇÃO PRINCIPAL — LEIA ANTES DE QUALQUER ALTERAÇÃO

ANTES DE CRIAR, ALTERAR OU EXCLUIR QUALQUER ARQUIVO, ANALISE PROFUNDAMENTE O PROJETO EXISTENTE.

NÃO comece implementando imediatamente.

Sua primeira responsabilidade é compreender como o sistema atual funciona para que todas as funcionalidades descritas neste documento sejam incorporadas à arquitetura já existente, respeitando:

* linguagem;
* framework;
* arquitetura;
* padrões;
* banco de dados;
* ORM;
* autenticação;
* autorização;
* filas;
* jobs;
* workers;
* sistema de alertas;
* sistema de e-mails;
* sistema de WhatsApp;
* Evolution API;
* componentes de frontend;
* design system;
* models;
* migrations;
* sistema de logs;
* sistema de auditoria;
* mecanismos de configuração;
* convenções do repositório.

O objetivo NÃO é criar uma aplicação paralela.

O objetivo é EVOLUIR O SISTEMA EXISTENTE.

Primeiro descubra como o projeto funciona.

Depois identifique os melhores pontos de extensão.

Somente depois desenvolva.

---

# PAPEL

Atue simultaneamente como:

* Principal Software Engineer;
* Software Architect;
* Backend Engineer;
* Frontend Engineer;
* Database Engineer;
* DevOps/SRE Engineer;
* Security Engineer;
* Data Engineer;
* especialista em sistemas distribuídos;
* especialista em processamento assíncrono;
* especialista em filas e workers;
* especialista em WhatsApp;
* especialista em Evolution API;
* especialista em integrações HTTP;
* especialista em modelagem de dados;
* especialista em performance;
* especialista em concorrência;
* Prompt Engineer;
* Context Engineer;
* especialista em manutenção de sistemas legados.

Implemente como faria um desenvolvedor profissional especialista responsável por um sistema real em produção.

---

# OBJETIVO GERAL

O projeto é uma plataforma de corridas de rua.

O sistema já possui:

* atletas;
* usuários;
* eventos;
* inscrições;
* pagamentos;
* cancelamentos;
* alertas;
* envio de e-mails;
* envio de WhatsApp;
* integração com Evolution API;
* regras existentes de notificações;
* templates existentes;
* variáveis utilizadas nos templates.

Sua tarefa é analisar tudo isso e incorporar um ecossistema profissional de:

`CAMPANHAS DE WHATSAPP EM MASSA`

integrado ao projeto existente.

Além disso, deverão ser implementadas:

1. preferências de comunicação do atleta;
2. controle de mensagens promocionais;
3. controle de mensagens relacionadas às inscrições/eventos;
4. central de preferências via link;
5. confirmação de entrega quando tecnicamente disponível;
6. tratamento de telefones inválidos;
7. identificação de números que não possuem WhatsApp, quando tecnicamente possível;
8. auditoria de envio;
9. agendamento;
10. filas;
11. retries;
12. idempotência;
13. controle de concorrência;
14. observabilidade;
15. dados obrigatórios de endereço do atleta.

---

# GERENCIAMENTO INTELIGENTE DE CONTEXTO

Faça uso econômico e estratégico do contexto.

Não leia o repositório inteiro indiscriminadamente.

Utilize investigação progressiva.

## CAMADA 1 — DESCOBERTA

Primeiro leia:

* README;
* manifests;
* package files;
* configuração principal;
* estrutura de diretórios;
* arquivos de rotas;
* configuração do banco;
* configuração de filas;
* configuração de workers;
* referências à Evolution API;
* referências ao WhatsApp;
* referências ao sistema de alertas.

Faça buscas por termos como:

`evolution`
`whatsapp`
`alert`
`notification`
`template`
`message`
`email`
`athlete`
`participant`
`runner`
`event`
`registration`
`campaign`
`queue`
`worker`
`job`
`schedule`
`cron`
`sendText`
`sendMessage`
`webhook`

Adapte os termos conforme os nomes encontrados no projeto.

## CAMADA 2 — FLUXOS RELEVANTES

Depois leia apenas os arquivos envolvidos nos fluxos encontrados.

## CAMADA 3 — DEPENDÊNCIAS

Expanda para arquivos adjacentes somente quando necessário.

Não mantenha arquivos irrelevantes no contexto.

Faça resumos internos curtos das descobertas relevantes para evitar releitura.

---

# PRIMEIRA FASE OBRIGATÓRIA — AUDITORIA DO PROJETO

Antes da implementação descubra:

## STACK

* linguagem;
* versão;
* framework;
* frontend;
* backend;
* ORM;
* banco;
* migrations;
* cache;
* Redis;
* queues;
* workers;
* cron/scheduler;
* Docker;
* infraestrutura.

## AUTENTICAÇÃO

Descubra:

* model de usuário;
* model de atleta;
* login;
* sessão;
* JWT ou mecanismo equivalente;
* guards;
* middleware;
* redirect pós-login;
* RBAC;
* administradores;
* atletas.

## EVENTOS

Descubra:

* model de evento;
* inscrições;
* associação atleta/evento;
* status;
* pagamentos;
* cancelamentos.

## ALERTAS

Trace completamente:

evento do domínio
→ regra de alerta
→ template
→ substituição de variáveis
→ criação da mensagem
→ provider
→ Evolution API.

Descubra todas as variáveis atualmente disponíveis.

## WHATSAPP

Descubra:

* client;
* service;
* adapter;
* endpoints;
* autenticação;
* instance;
* API key;
* payloads;
* timeouts;
* retries;
* webhooks;
* provider utilizado;
* versão da Evolution API;
* mecanismo efetivo de conexão ao WhatsApp.

## FRONTEND

Descubra:

* painel administrativo;
* menu;
* layout;
* tabelas;
* selects;
* modais;
* formulários;
* design system;
* API client;
* área do atleta;
* cadastro;
* edição de perfil.

## MODAL OBRIGATÓRIO EXISTENTE

Existe no sistema um modal/fluxo já utilizado para obrigar o atleta a completar informações cadastrais.

LOCALIZE-O.

Compreenda exatamente:

* quando abre;
* quem controla;
* quais campos verifica;
* como impede a navegação;
* como salva;
* como fecha;
* como se comporta após login.

Esse mesmo mecanismo deverá ser reutilizado para obrigar o preenchimento do endereço posteriormente descrito.

Não crie outro modal paralelo se o atual puder ser corretamente estendido.

---

# REGRA DE ALTERAÇÃO MÍNIMA

Priorize:

* extensão;
* reutilização;
* composição;
* extração de lógica compartilhada;
* alterações incrementais.

Evite:

* duplicação;
* reescrita;
* novos frameworks;
* microserviços desnecessários;
* bibliotecas desnecessárias;
* refactors não relacionados.

Não altere contratos existentes sem necessidade.

---

# PESQUISA TÉCNICA

Depois de descobrir a versão real da Evolution API utilizada pelo projeto, consulte a documentação correspondente.

Não presuma endpoints.

Verifique:

* envio de texto;
* identificação da mensagem;
* status da mensagem;
* webhooks;
* confirmação de envio;
* confirmação de entrega;
* confirmação de leitura;
* erros;
* verificação da existência do WhatsApp;
* status da instância;
* códigos de resposta;
* tratamento de telefone inexistente;
* recursos disponíveis na versão instalada.

Utilize prioritariamente:

1. documentação atual da Evolution API;
2. repositório oficial;
3. documentação do WhatsApp aplicável;
4. documentação das bibliotecas realmente utilizadas.

---

# REGRA SOBRE EVOLUTION API

A Evolution API pode possuir diferentes modos/providers.

NÃO presuma que o projeto usa:

* Baileys;
* WhatsApp Cloud API;
* Evolution Baileys;
* outro provider.

Descubra no código.

Somente então implemente conforme o provider real.

---

# SEGURANÇA DA INTEGRAÇÃO

Não implemente mecanismos destinados a enganar sistemas de proteção do WhatsApp.

Não:

* simule digitação para tentar parecer humano;
* altere fingerprints;
* faça rotação de identidade para burlar bloqueios;
* implemente evasão de enforcement;
* continue enviando deliberadamente após bloqueio;
* implemente spam indiscriminado.

Utilize:

* filas;
* processamento gradual;
* rate limiting configurável;
* backpressure;
* circuit breaker;
* consentimento;
* preferências;
* supressão;
* opt-out;
* retries controlados;
* monitoramento.

Não prometa impossibilidade de bloqueio.

---

# PREFERÊNCIAS DO ATLETA

O atleta deverá possuir pelo menos duas preferências independentes:

`receive_promotional_messages`

e

`receive_event_messages`

ou nomes equivalentes seguindo o padrão do projeto.

AMBOS DEVEM POSSUIR VALOR DEFAULT:

`true`

Isso é requisito obrigatório.

---

# CONSENTIMENTO PROMOCIONAL — REGRA DE NEGÓCIO DESTE SISTEMA

Neste sistema, ao criar a conta/cadastro, o usuário aceita os Termos de Uso da plataforma.

Os Termos de Uso estabelecem a autorização inicial para recebimento das comunicações aplicáveis.

Portanto:

`receive_promotional_messages = true`

deve ser automaticamente definido na criação do atleta.

E:

`receive_event_messages = true`

também deverá ser definido automaticamente.

Esses campos NÃO deverão aparecer como opções durante o primeiro cadastro.

O usuário não precisará marcar um checkbox adicional nesse momento.

A origem inicial dessa configuração será a aceitação dos Termos de Uso.

Quando o sistema já possuir registro de:

* terms_accepted_at;
* terms_version;
* acceptance_ip;
* acceptance_source;

ou equivalente, reutilize-o.

Se houver mecanismo existente de versionamento/aceitação de termos, preserve-o.

Não crie duplicação desnecessária.

---

# USUÁRIOS EXISTENTES

Na migration, para atletas existentes:

`receive_promotional_messages = true`

e

`receive_event_messages = true`

salvo se já existir informação anterior explícita indicando opt-out.

Se já houver algum mecanismo equivalente de preferência, preserve o estado existente.

Nunca sobrescreva uma recusa já registrada.

---

# REVOGAÇÃO POSTERIOR

Após criação da conta, o atleta deverá poder alterar essas preferências.

Criar ou ampliar na área do atleta uma seção denominada:

`Preferências de comunicação`

ou nomenclatura equivalente.

Deverá possuir controles independentes para:

* receber mensagens relacionadas aos eventos e inscrições;
* receber mensagens promocionais.

Inicialmente:

`true`

O atleta poderá desmarcar qualquer uma delas.

A alteração deverá produzir efeito imediatamente.

---

# REVALIDAÇÃO IMEDIATA ANTES DO ENVIO

Mesmo que uma campanha tenha sido criada ou agendada anteriormente, imediatamente antes de enviar cada mensagem o worker deverá verificar novamente:

* atleta ainda existe;
* telefone ainda é válido;
* campanha ainda está ativa;
* campanha não está pausada;
* campanha não está cancelada;
* preferência aplicável continua habilitada;
* número não está marcado como inválido;
* número não está marcado como inexistente no WhatsApp, quando esse status for confiável;
* recipient ainda não foi enviado.

Se o atleta tiver revogado o recebimento depois do agendamento, NÃO enviar.

---

# LINK DE PREFERÊNCIAS NAS MENSAGENS

As mensagens WhatsApp apropriadas deverão receber ao final um texto semelhante a:

`Para alterar ou cancelar o recebimento de mensagens, clique no link abaixo e acesse suas Preferências de comunicação: {preferences_url}`

Você poderá melhorar a redação mantendo o significado.

Centralize essa inclusão.

Não copie o texto manualmente em dezenas de templates.

---

# FUNCIONAMENTO DO LINK

Ao clicar:

## USUÁRIO AUTENTICADO

Abrir diretamente:

`Preferências de comunicação`

## USUÁRIO NÃO AUTENTICADO

1. direcionar ao login;
2. preservar corretamente a URL de destino;
3. autenticar;
4. retornar automaticamente para a página de preferências.

Proteja contra open redirect.

Não exponha dados sensíveis na URL.

---

# TIPOS DE COMUNICAÇÃO

## MENSAGENS DE EVENTOS

Correspondem aos alertas existentes relacionados, por exemplo:

* inscrição realizada;
* pagamento pendente;
* pagamento realizado;
* confirmação;
* cancelamento;
* demais alertas operacionais já cadastrados.

São controladas por:

`receive_event_messages`

## MENSAGENS PROMOCIONAIS

Correspondem principalmente às campanhas criadas manualmente na funcionalidade de disparo em massa.

São controladas por:

`receive_promotional_messages`

---

# NOVO MÓDULO — CAMPANHAS DE WHATSAPP

Criar uma nova área administrativa, seguindo os padrões atuais do painel.

Nome conceitual:

`Campanhas de WhatsApp`

Deve permitir:

* listar;
* criar;
* visualizar;
* editar enquanto permitido;
* duplicar;
* agendar;
* iniciar;
* pausar;
* retomar;
* cancelar;
* acompanhar;
* visualizar métricas;
* visualizar destinatários;
* visualizar falhas.

Respeite o sistema de autorização existente.

Atletas não podem acessar essa área.

---

# CRIAÇÃO DA CAMPANHA

Deve permitir configurar:

## IDENTIFICAÇÃO

* nome da campanha;
* descrição opcional.

## EVENTO

Selecionar um evento já cadastrado na plataforma.

Evite carregar milhares de eventos em um select simples.

Utilize autocomplete/paginação se necessário.

---

# POPULAÇÃO DA CAMPANHA

Depois de selecionar o evento, os possíveis destinatários deverão ser obtidos a partir das inscrições e atletas correspondentes.

Use consultas eficientes.

Não carregue toda a tabela de atletas na memória.

Não gere N+1.

Use:

* paginação;
* cursor;
* chunk;
* batch;
* streaming;

conforme o stack existente.

---

# FILTRO DE RECEBIMENTO PROMOCIONAL

Na tela da campanha deve existir opção para considerar as preferências promocionais.

Entretanto, atletas que explicitamente possuem:

`receive_promotional_messages = false`

não deverão receber campanhas promocionais.

O sistema deve apresentar quantos foram excluídos por esse motivo.

---

# COMPOSIÇÃO DA MENSAGEM

Existirão duas alternativas.

## ALTERNATIVA 1 — ALERTA EXISTENTE

O administrador poderá selecionar um dos alertas/templates já cadastrados.

Depois de selecionar:

1. carregar conteúdo;
2. mostrar no editor;
3. permitir editar;
4. NÃO modificar o alerta original;
5. salvar cópia/snapshot dentro da campanha.

O conteúdo da campanha se torna independente do template original.

---

# ALTERNATIVA 2 — NOVA MENSAGEM

Permitir escrever uma mensagem totalmente nova.

O editor deverá apresentar todas as variáveis permitidas pelo sistema de alertas existente.

Exemplos apenas ilustrativos:

* nome do atleta;
* primeiro nome;
* nome do evento;
* data do evento;
* cidade;
* modalidade;
* distância;
* inscrição;
* pagamento;
* link;
* demais variáveis reais existentes.

NÃO invente variáveis.

Descubra as variáveis existentes.

---

# CATÁLOGO DE VARIÁVEIS

Deve existir uma única fonte de verdade.

Evite:

frontend com uma lista
e
backend com outra lista diferente.

Reutilize ou extraia o mecanismo atual do sistema de alertas.

---

# MOTOR DE TEMPLATES

Preview e envio DEVEM utilizar o mesmo renderer.

Nunca crie duas implementações diferentes.

O renderer deverá:

* detectar placeholders;
* substituir valores;
* informar placeholders inválidos;
* lidar com valor inexistente;
* impedir execução arbitrária;
* não usar `eval`;
* evitar template injection;
* preservar compatibilidade com templates existentes.

---

# EDITOR

Disponibilizar:

* campo de texto;
* contador;
* catálogo de variáveis;
* inserção de variável;
* validação;
* botão `Visualizar`.

Se o projeto já possuir editor/componente apropriado, reutilize.

---

# BOTÃO VISUALIZAR

Ao clicar:

NÃO enviar WhatsApp.

Mostrar um preview visual simulando como a mensagem chegará ao destinatário.

Incluir:

* texto;
* variáveis renderizadas;
* quebras de linha;
* formatação;
* links;
* footer de preferências.

Utilize o mesmo renderer do envio real.

---

# ENVIO DE TESTE

Se coerente com a arquitetura, adicione:

`Enviar teste`

para telefone autorizado pelo administrador.

Esse envio não deverá contar nas métricas reais da campanha.

Deve ser claramente identificado internamente como teste.

---

# AGENDAMENTO

Permitir:

* disparar agora;
* agendar data e horário.

Use timezone corretamente.

Para interface brasileira, quando não houver outra configuração existente, utilize:

`America/Sao_Paulo`

Internamente preserve o padrão já adotado pelo projeto.

O agendamento deve sobreviver a:

* restart;
* deploy;
* múltiplos processos;
* indisponibilidade temporária.

Não use apenas `setTimeout` ou timer em memória.

---

# ESTADOS DA CAMPANHA

Implemente state machine explícita.

Exemplo conceitual:

* DRAFT;
* SCHEDULED;
* PREPARING;
* RUNNING;
* PAUSED;
* COMPLETED;
* CANCELLED;
* FAILED.

Adapte nomenclatura ao padrão atual.

Não permita transições inválidas.

---

# CAMPAIGN RECIPIENTS

Cada destinatário deve possuir registro individual.

Modelo conceitual:

* id;
* campaign_id;
* athlete_id;
* registration_id;
* normalized_phone;
* status;
* attempts;
* provider_message_id;
* queued_at;
* processing_at;
* sent_at;
* delivered_at;
* read_at;
* failed_at;
* failure_reason;
* provider_error_code;
* created_at;
* updated_at.

Adapte às convenções existentes.

---

# ESTADOS DE DESTINATÁRIO

Conceitualmente:

* pending;
* queued;
* processing;
* sent;
* delivered;
* read;
* failed;
* skipped;
* invalid_phone;
* whatsapp_not_found;
* opted_out;
* cancelled.

Não crie status que não tenham utilidade.

---

# CONFIRMAÇÃO DE ENTREGA

É um requisito importante tentar determinar:

* mensagem aceita pelo provider;
* enviada;
* entregue;
* lida;
* falhou.

ANTES de implementar, investigue quais confirmações são realmente suportadas pela versão da Evolution API e pelo provider efetivamente utilizado.

Se houver:

* webhook;
* event callback;
* update de mensagem;
* ACK;
* delivery receipt;
* read receipt;

integre.

---

# NÃO CONFUNDIR ESTADOS

Não considere automaticamente:

`HTTP 200`

como:

`mensagem entregue`

Uma chamada HTTP bem-sucedida normalmente confirma apenas que a API aceitou/processou a solicitação.

Utilize os eventos reais do provider para determinar:

* sent;
* delivered;
* read;

quando disponíveis.

---

# WEBHOOKS DE STATUS

Se a Evolution API utilizada fornecer eventos de atualização das mensagens:

implemente processamento dos webhooks.

Correlacione pelo:

`provider_message_id`

ou identificador equivalente.

O webhook deverá ser:

* idempotente;
* validado;
* seguro;
* rápido;
* resistente a eventos repetidos;
* tolerante a eventos fora de ordem quando necessário.

---

# MÉTRICAS DE ENTREGA

No painel da campanha, quando suportado, exibir:

* total;
* pendentes;
* processando;
* enviados;
* entregues;
* lidos;
* falhas;
* números inválidos;
* sem WhatsApp;
* opt-outs;
* cancelados.

Se determinada informação não estiver disponível tecnicamente, não invente.

---

# VALIDAÇÃO DE TELEFONE

Antes do envio:

* normalizar;
* validar formato;
* identificar DDI;
* identificar DDD quando aplicável;
* remover caracteres inválidos;
* rejeitar telefone claramente inválido.

Utilize padrão adequado ao provider.

Quando apropriado, normalize para E.164.

---

# NÚMEROS ERRADOS OU INEXISTENTES

Se um número for inválido:

1. marcar recipient como falha apropriada;
2. registrar motivo;
3. NÃO interromper a campanha;
4. continuar para o próximo destinatário.

Nunca permita que um telefone incorreto faça o worker inteiro falhar.

---

# VERIFICAÇÃO SE O NÚMERO POSSUI WHATSAPP

Se a versão/provider da Evolution API possuir endpoint ou mecanismo confiável para verificar existência de WhatsApp, utilize-o de maneira eficiente.

NÃO realize verificações desnecessárias a cada campanha se puder armazenar um resultado confiável.

Caso seja detectado de forma inequívoca:

`número não possui WhatsApp`

registre essa informação no atleta/telefone ou em estrutura apropriada.

Exemplos conceituais:

* whatsapp_status;
* whatsapp_verified_at;
* whatsapp_check_source.

Estados possíveis:

* unknown;
* valid;
* invalid;
* not_on_whatsapp.

Adapte aos padrões do projeto.

---

# NÃO MARCAR INCORRETAMENTE

Somente marque definitivamente:

`not_on_whatsapp`

quando houver evidência confiável fornecida pelo provider.

Não marque alguém como inexistente por:

* timeout;
* 500;
* conexão caiu;
* instância desconectada;
* rate limit;
* erro temporário.

Esses casos devem permanecer desconhecidos ou transitórios.

---

# CACHE DA VERIFICAÇÃO

Se existir verificação de número via API, evite consultá-la desnecessariamente.

Considere armazenar:

* status;
* data da última verificação.

Utilize TTL/configuração razoável se o status puder mudar.

Não faça milhões de verificações repetidas.

---

# TELEFONE INVÁLIDO NO CADASTRO

Se um telefone ficar comprovadamente inválido, registre adequadamente para reduzir novos envios inúteis.

Entretanto, se o atleta posteriormente atualizar o telefone:

* limpar o status antigo;
* revalidar o novo número quando necessário.

---

# DEDUPLICAÇÃO

Se dois registros resultarem no mesmo telefone para a mesma campanha, não envie duas mensagens sem necessidade explícita.

Defina uma estratégia consistente.

Prefira constraints e regras determinísticas.

---

# IDEMPOTÊNCIA

O mesmo destinatário não pode receber duas vezes a mesma campanha devido a:

* retry;
* crash;
* worker duplicado;
* clique duplo;
* timeout;
* restart;
* job duplicado;
* scheduler duplicado.

Utilize proteção também no banco.

Não dependa apenas de:

`if alreadySent`.

Utilize:

* unique constraints;
* transactions;
* locking;
* atomic updates;

conforme o banco existente.

---

# PROCESSAMENTO ASSÍNCRONO

NÃO faça envio em massa dentro da request HTTP.

Utilize a infraestrutura existente.

Fluxo conceitual:

Admin
→ Campaign API
→ Campaign Service
→ Preparation
→ Queue
→ Worker
→ WhatsApp Provider
→ Evolution API.

---

# PREPARAÇÃO DA CAMPANHA

Para eventos grandes, a criação da lista de recipients também deverá poder acontecer em background.

Não faça uma request esperar dezenas de milhares de linhas.

Estado:

`PREPARING`

quando necessário.

---

# BATCH PROCESSING

Processe destinatários em lotes.

Nunca faça:

* SELECT gigantesco;
* milhares de promises simultâneas;
* milhares de threads;
* milhares de requests paralelas.

Utilize batch/chunk adequado.

---

# RATE LIMITING

Criar controle de throughput configurável.

Se houver múltiplos workers e Redis, considere rate limiter distribuído.

Algoritmos adequados:

* token bucket;
* leaky bucket;
* sliding window.

Escolha o mais apropriado ao projeto.

Objetivo:

* estabilidade;
* evitar rajadas;
* controlar throughput;
* respeitar limites conhecidos;
* não sobrecarregar a Evolution API.

Não use valores arbitrários vendidos como garantia contra bloqueio.

Torne parâmetros configuráveis.

---

# BACKPRESSURE

Se o provider estiver lento:

* reduza consumo;
* não deixe filas crescerem descontroladamente;
* não sobrecarregue conexões;
* preserve consistência.

---

# RETRIES

Classifique erros.

## TRANSITÓRIOS

Podem incluir:

* timeout;
* conexão;
* 429;
* 5xx;
* indisponibilidade temporária.

Use:

* retry limitado;
* exponential backoff;
* jitter técnico para evitar thundering herd.

## DEFINITIVOS

Exemplos:

* telefone inválido;
* número sem WhatsApp confirmado;
* opt-out;
* payload inválido;
* destinatário inelegível.

Não fazer retry inútil.

---

# CIRCUIT BREAKER

Implemente mecanismo apropriado.

Se houver sequência relevante de:

* instância desconectada;
* autenticação inválida;
* muitos 429;
* 5xx;
* falhas sistêmicas;

interrompa ou pause temporariamente os novos envios.

Não continue consumindo recipients indefinidamente.

---

# HEALTH CHECK

Verifique o estado da Evolution API/instância de acordo com a versão real utilizada.

Se desconectada:

* pausar/deferir;
* informar painel;
* registrar erro;
* não marcar destinatários indevidamente como telefone inválido.

---

# PROVIDER ADAPTER

Se já existir abstração de WhatsApp, reutilize.

Se não existir e a arquitetura justificar, criar interface equivalente a:

`WhatsAppProvider`

Responsabilidades:

* enviar;
* consultar status quando possível;
* verificar número quando possível;
* normalizar response;
* classificar erro;
* health check.

Implementação atual:

`EvolutionApiProvider`

Isso deve reduzir o acoplamento das regras de campanha à Evolution API.

Não faça overengineering.

---

# PAUSAR

Uma campanha em execução poderá ser pausada.

Ao pausar:

* nenhum novo envio deverá começar;
* jobs já iniciados terminam de maneira consistente;
* não perder recipients.

---

# RETOMAR

Ao retomar:

* continuar pendências;
* não recriar recipients;
* não duplicar mensagens.

---

# CANCELAR

Ao cancelar:

* nenhum novo envio;
* recipients pendentes devem ser ignorados/cancelados;
* mensagens já enviadas não podem ser desfeitas;
* estado deve ser auditável.

Workers devem verificar `campaign status` imediatamente antes de cada envio.

---

# SNAPSHOT

Ao agendar/iniciar, mantenha snapshot de:

* evento;
* template original;
* mensagem;
* filtros;
* criador;
* data;
* classificação;
* configurações relevantes.

Alterações posteriores no template original não podem modificar silenciosamente uma campanha já criada.

---

# PREVIEW/DRY RUN

Antes do disparo definitivo, mostrar:

* quantidade total;
* elegíveis;
* opt-outs;
* telefones inválidos;
* sem WhatsApp conhecido;
* duplicados;
* preview da mensagem.

Não enviar nada nesse estágio.

---

# CONFIRMAÇÃO ADMINISTRATIVA

Antes de iniciar/agendar, mostrar resumo:

* campanha;
* evento;
* total;
* elegíveis;
* excluídos;
* horário;
* mensagem final.

Evite submissão dupla.

---

# AUDITORIA

Registrar:

* criação;
* edição;
* agendamento;
* início;
* pausa;
* retomada;
* cancelamento;
* duplicação;
* teste;
* alterações de preferências.

Registrar:

* ator;
* timestamp;
* entidade;
* ação;
* metadados essenciais.

---

# LOGGING

Use logs estruturados.

Exemplos de campos:

* campaign_id;
* campaign_recipient_id;
* athlete_id;
* provider_message_id;
* attempt;
* job_id;
* status.

NÃO grave:

* senhas;
* API keys;
* tokens;
* cookies;
* secrets.

---

# PAINEL DA CAMPANHA

Mostrar:

* nome;
* evento;
* status;
* responsável;
* criação;
* agendamento;
* início;
* conclusão;
* mensagem;
* total;
* elegíveis;
* processados;
* enviados;
* entregues;
* lidos;
* falhas;
* inválidos;
* sem WhatsApp;
* opt-outs;
* progresso.

Quando o provider não fornecer alguma informação, não apresentar uma estimativa como fato.

---

# LISTA DE DESTINATÁRIOS

Criar tabela server-side paginada.

Permitir filtros por:

* status;
* nome;
* telefone;
* inscrição;
* erro.

Não carregar todos os recipients no frontend.

---

# ERROS

Mostrar erros claros como:

* telefone inválido;
* WhatsApp não encontrado;
* opt-out;
* instância desconectada;
* timeout;
* provider unavailable;
* rate limit;
* payload inválido.

Nunca mostrar stack trace para usuário final.

---

# BANCO DE DADOS

Primeiro analise os models existentes.

Provavelmente serão necessárias estruturas equivalentes a:

* campaigns;
* campaign_recipients;
* campos de preferências;
* metadados de telefone/WhatsApp;
* auditoria.

Não crie tabelas redundantes.

---

# ÍNDICES

Adicione somente índices necessários para consultas reais.

Analise:

* campaign_id/status;
* athlete_id;
* normalized_phone;
* provider_message_id;
* scheduled_at;
* status;
* combinações utilizadas pelos workers.

---

# TRANSAÇÕES E CONCORRÊNCIA

Proteja:

* início duplicado;
* scheduler duplicado;
* recipient duplicado;
* pause concorrente;
* cancel concorrente;
* retry concorrente.

Utilize mecanismos suportados pelo banco real:

* transaction;
* row lock;
* compare-and-set;
* atomic update;
* unique constraint;
* `SKIP LOCKED` quando disponível e adequado.

---

# TESTES DO MÓDULO DE CAMPANHAS

Cobrir no mínimo:

## UNITÁRIOS

* renderer;
* placeholders;
* normalização;
* preferência;
* elegibilidade;
* state machine;
* error classifier;
* retry;
* telefone inválido;
* deduplicação;
* identificação de opt-out.

## INTEGRAÇÃO

* criar campanha;
* editar;
* agendar;
* preparar recipients;
* iniciar;
* pausar;
* retomar;
* cancelar;
* revalidar opt-out;
* status de entrega;
* webhook;
* telefone inexistente;
* provider temporariamente indisponível;
* idempotência.

## CONCORRÊNCIA

Teste, quando suportado:

* dois workers disputando mesmo recipient;
* duas ativações simultâneas;
* cancelamento concorrente;
* opt-out durante processamento.

---

# TESTES NÃO PODEM ENVIAR WHATSAPP REAL

Utilize:

* mocks;
* fakes;
* fixtures;
* provider fake.

---

# BLOCO OBRIGATÓRIO ADICIONAL — ENDEREÇO DO ATLETA

Depois de concluir a análise das funcionalidades anteriores, verifique se o cadastro do atleta já possui todos os dados de endereço necessários.

Os campos obrigatórios devem existir na seguinte ordem lógica, seguindo o padrão mais comum de formulários brasileiros:

1. CEP;
2. Rua/Logradouro;
3. Número;
4. Complemento;
5. Bairro;
6. Cidade;
7. Estado/UF.

Se o sistema também operar internacionalmente e já possuir estrutura de país/endereço internacional, respeite o modelo existente e adapte corretamente.

---

# CAMPOS DE ENDEREÇO

Conceitualmente:

* postal_code / cep;
* street / logradouro;
* number;
* complement;
* neighborhood / bairro;
* city;
* state / uf.

Se esses campos já existirem, NÃO crie duplicados.

Localize os equivalentes e reutilize-os.

---

# COMPLEMENTO

O campo:

`Complemento`

normalmente deverá ser opcional.

Os demais:

* CEP;
* Rua;
* Número;
* Bairro;
* Cidade;
* Estado;

deverão ser obrigatórios.

Se houver regra atual que permita endereço sem número, verifique o modelo de negócio antes de quebrar compatibilidade.

Se necessário, considere opção equivalente a:

`Sem número`

mantendo integridade dos dados.

---

# OBRIGATORIEDADE DE ENDEREÇO

Depois da implementação, todo atleta deverá possuir endereço cadastral completo.

Para novos cadastros, integre os campos ao fluxo apropriado conforme arquitetura existente.

Para usuários existentes que ainda não possuem todos os campos:

AO ACESSAREM A PLATAFORMA, ELES NÃO PODERÃO CONTINUAR NAVEGANDO ENQUANTO NÃO COMPLETAREM OS DADOS OBRIGATÓRIOS.

---

# REUTILIZAR MODAL EXISTENTE

Existe um modal/fluxo atual utilizado para impedir a navegação de usuários com cadastro incompleto.

LOCALIZE esse mecanismo durante a auditoria inicial.

Amplie-o.

Não crie uma segunda experiência independente se o componente existente puder ser reutilizado.

---

# COMPORTAMENTO DO MODAL DE CADASTRO INCOMPLETO

Depois do login:

1. verificar dados obrigatórios;
2. se endereço incompleto, abrir o modal existente;
3. preencher automaticamente os valores já conhecidos;
4. destacar somente dados faltantes/inválidos;
5. impedir fechamento que permita continuar navegando;
6. impedir navegação normal enquanto cadastro estiver incompleto;
7. salvar;
8. validar backend;
9. somente após sucesso liberar navegação.

Não confie apenas no frontend para impor a regra.

---

# EVITAR LOOP DE REDIRECT

Implemente cuidadosamente para não criar:

login
→ modal
→ request
→ redirect
→ modal infinito.

Rotas necessárias para:

* login;
* logout;
* salvar perfil;
* completar cadastro;

devem continuar acessíveis.

---

# VALIDAÇÃO DE CEP

Se o projeto já possuir integração para CEP, reutilize.

Se não possuir, NÃO introduza automaticamente uma dependência externa sem avaliar necessidade.

O CEP deverá ao menos:

* aceitar o formato correto;
* ser normalizado;
* ser validado no backend.

Se houver preenchimento automático confiável existente, mantenha.

---

# NORMALIZAÇÃO DO ENDEREÇO

Salvar dados de forma consistente.

Exemplos:

CEP:

`01310-100`

ou formato normalizado utilizado pelo sistema.

UF:

`SP`

Evite estados duplicados em formatos diferentes.

---

# MIGRATION DOS DADOS DE ENDEREÇO

A migration não deve quebrar imediatamente usuários existentes sem endereço.

Se a tabela for grande:

1. adicionar campos de forma segura;
2. preservar dados existentes;
3. aplicar obrigatoriedade lógica na aplicação;
4. realizar backfill quando possível;
5. somente tornar NOT NULL diretamente no banco quando isso for seguro e compatível com dados existentes.

Não executar migration destrutiva.

---

# RELAÇÃO ENTRE ENDEREÇO E CADASTRO INCOMPLETO

Centralize a regra que determina:

`profile_complete`

ou equivalente.

Não implemente uma regra no frontend e outra diferente no backend.

Crie uma fonte de verdade clara.

---

# FRONTEND DO ENDEREÇO

A ordem visual deverá ser:

CEP
Rua/Logradouro
Número
Complemento
Bairro
Cidade
Estado/UF

Use componentes existentes.

Responsivo para mobile.

Utilize:

* máscaras existentes;
* validações;
* feedback;
* loading;
* erros de API.

---

# AUTORIZAÇÃO DE ALTERAÇÃO DO ENDEREÇO

O atleta somente pode alterar seu próprio endereço, salvo funcionalidades administrativas já autorizadas pelo sistema.

Validação deve ocorrer server-side.

---

# SEGURANÇA DOS DADOS PESSOAIS

Endereço é dado pessoal.

Portanto:

* não escrever endereço completo desnecessariamente em logs;
* não expor endereço em endpoints públicos;
* respeitar autorização;
* evitar PII desnecessária em eventos técnicos;
* não colocar endereço em URLs.

---

# ORDEM GLOBAL DE EXECUÇÃO

Execute exatamente nessa sequência.

## FASE 1 — ANALISAR O PROJETO

Nenhum desenvolvimento antes dessa fase.

Descubra:

* arquitetura;
* models;
* services;
* alertas;
* Evolution API;
* frontend;
* autenticação;
* banco;
* filas;
* modal existente;
* endereço existente.

## FASE 2 — MAPEAR FLUXOS

Trace:

### ALERTAS

domínio
→ template
→ renderer
→ WhatsApp.

### CAMPANHAS

Determine os pontos corretos de integração.

### PERFIL

atleta
→ edição
→ persistência.

### LOGIN

login
→ redirect
→ página de destino.

### CADASTRO INCOMPLETO

login
→ verificação
→ modal existente
→ conclusão.

## FASE 3 — GAP ANALYSIS

Liste internamente:

* existente;
* reutilizável;
* precisa alterar;
* precisa criar;
* riscos.

## FASE 4 — ANALISAR EVOLUTION API

Descubra a versão.

Consulte documentação correspondente.

## FASE 5 — DESIGN

Defina:

* model;
* migrations;
* services;
* APIs;
* jobs;
* workers;
* provider adapter;
* state machine;
* filas;
* índices;
* frontend.

## FASE 6 — IMPLEMENTAR BACKEND

## FASE 7 — IMPLEMENTAR WORKERS/JOBS

## FASE 8 — IMPLEMENTAR FRONTEND

## FASE 9 — IMPLEMENTAR PREFERÊNCIAS

## FASE 10 — IMPLEMENTAR ENDEREÇO OBRIGATÓRIO

## FASE 11 — TESTAR

## FASE 12 — REVISÃO ADVERSARIAL

---

# REVISÃO ADVERSARIAL OBRIGATÓRIA

Antes de considerar concluído, procure deliberadamente por:

* mensagem duplicada;
* race condition;
* N+1;
* full table scan;
* retry infinito;
* scheduler duplicado;
* recipient duplicado;
* envio após cancelamento;
* envio após pause;
* envio após opt-out;
* status incorreto de entrega;
* telefone incorretamente marcado como inexistente;
* webhook duplicado;
* webhook fora de ordem;
* segredo em log;
* API key no frontend;
* bypass de autorização;
* template injection;
* divergência preview/envio;
* problema de timezone;
* migration destrutiva;
* cadastro incompleto burlável;
* loop de redirect;
* modal que pode ser fechado;
* endpoint que permite navegar sem endereço;
* campos duplicados;
* regressões no sistema de alertas.

Corrija tudo que encontrar.

---

# CRITÉRIOS DE ACEITAÇÃO — CAMPANHAS

O recurso somente estará completo se o administrador puder:

1. abrir Campanhas de WhatsApp;
2. criar campanha;
3. selecionar evento;
4. utilizar alerta existente;
5. editar sua cópia;
6. criar mensagem do zero;
7. utilizar variáveis;
8. visualizar;
9. ver quantidade de recipients;
10. identificar excluídos;
11. iniciar imediatamente;
12. agendar;
13. pausar;
14. retomar;
15. cancelar;
16. acompanhar progresso;
17. visualizar falhas;
18. visualizar enviados;
19. visualizar entregues quando tecnicamente disponível;
20. visualizar lidos quando tecnicamente disponível;
21. identificar telefones inválidos;
22. identificar números sem WhatsApp quando tecnicamente possível.

---

# CRITÉRIOS DE ACEITAÇÃO — PREFERÊNCIAS

1. todo novo atleta recebe:

   * `receive_promotional_messages = true`;
   * `receive_event_messages = true`;

2. esses campos não aparecem durante o primeiro cadastro;

3. posteriormente aparecem em Preferências de comunicação;

4. atleta pode alterar;

5. alterações valem imediatamente;

6. campanhas promocionais não enviam para `false`;

7. alertas correspondentes respeitam `receive_event_messages`;

8. link nas mensagens direciona às preferências;

9. se não autenticado, usuário faz login e retorna à página correta.

---

# CRITÉRIOS DE ACEITAÇÃO — TELEFONE

1. telefone é normalizado;
2. telefone claramente inválido não é enviado;
3. erro em um telefone não interrompe campanha;
4. número sem WhatsApp pode ser identificado quando provider suportar;
5. resultado confiável pode ser armazenado;
6. erro temporário não pode marcar número como inexistente;
7. alteração posterior do telefone invalida o status antigo;
8. status de envio/entrega/leitura é persistido quando provider permitir.

---

# CRITÉRIOS DE ACEITAÇÃO — ENDEREÇO

Todo atleta deverá possuir:

1. CEP;
2. Rua/Logradouro;
3. Número;
4. Bairro;
5. Cidade;
6. Estado/UF;

Complemento poderá ser opcional.

Para atleta existente com endereço incompleto:

1. fazer login;
2. sistema detectar incompletude;
3. abrir o modal já existente;
4. impedir navegação;
5. exigir preenchimento;
6. validar backend;
7. salvar;
8. liberar navegação somente após sucesso.

---

# CRITÉRIOS TÉCNICOS

São obrigatórios:

* integração ao projeto existente;
* zero aplicação paralela;
* processamento assíncrono;
* batch processing;
* idempotência;
* transactions;
* controle de concorrência;
* retry limitado;
* rate limiting;
* circuit breaker quando apropriado;
* health check;
* tratamento de telefone;
* status de entrega quando disponível;
* webhooks idempotentes;
* revalidação das preferências antes de cada envio;
* auditoria;
* logs estruturados;
* autorização server-side;
* indexes adequados;
* preview e envio usando mesmo renderer;
* tests;
* lint;
* typecheck;
* build.

---

# USO DE SUBAGENTES

Se disponíveis, utilize subagentes seletivamente para reduzir o contexto principal.

Exemplos:

## AGENTE 1

Arquitetura/backend.

## AGENTE 2

Sistema atual de alertas/templates.

## AGENTE 3

Evolution API.

## AGENTE 4

Models/migrations.

## AGENTE 5

Frontend.

## AGENTE 6

Autenticação/modal de cadastro incompleto.

## AGENTE 7

Testes/segurança/concorrência.

Cada subagente deve retornar apenas:

* descobertas;
* caminhos;
* funções/classes relevantes;
* riscos;
* recomendações.

Não despeje arquivos inteiros no contexto principal.

---

# REGRA DE AUTONOMIA

Não interrompa o trabalho para perguntar ao usuário coisas que podem ser descobertas no código.

Se uma decisão puder ser determinada por:

* padrões existentes;
* models;
* configuração;
* documentação;
* testes;

investigue e tome a decisão.

Quando houver mais de uma alternativa correta, escolha aquela mais consistente com o projeto.

---

# NÃO ENTREGAR IMPLEMENTAÇÃO INCOMPLETA

Não finalize apenas com:

* plano;
* relatório;
* TODO;
* pseudocódigo;
* migration isolada;
* frontend sem backend;
* backend sem UI;
* botão sem funcionalidade;
* worker sem fila;
* fila sem idempotência;
* status falso de entrega.

Implemente ponta a ponta.

---

# VALIDAÇÃO FINAL

Execute tudo que for aplicável:

* testes antigos;
* testes novos;
* lint;
* formatter check;
* typecheck;
* build backend;
* build frontend;
* migrations em ambiente de teste;
* testes de integração.

Não elimine testes para obter sucesso artificial.

Não esconda erros com:

* ignore;
* catch vazio;
* `any` desnecessário;
* `@ts-ignore`;
* disable de lint;

sem justificativa técnica legítima.

---

# DOCUMENTAÇÃO

Atualize a documentação necessária.

Descreva:

* arquitetura da campanha;
* estados;
* processamento;
* filas;
* provider;
* Evolution API utilizada;
* rate limiter;
* retries;
* confirmação de entrega;
* tratamento de números;
* preferências;
* link de opt-out;
* endereço obrigatório;
* modal de cadastro incompleto;
* variáveis de configuração.

Nunca documente valores secretos.

---

# RELATÓRIO FINAL

Depois que tudo estiver implementado e validado, entregue um relatório final conciso contendo:

## 1. ARQUITETURA ENCONTRADA

Stack e principais padrões identificados.

## 2. FLUXO DE WHATSAPP EXISTENTE

Como funcionava antes.

## 3. ARQUITETURA IMPLEMENTADA

Novo fluxo.

## 4. EVOLUTION API

Informe:

* versão detectada;
* provider detectado;
* endpoints utilizados;
* eventos/webhooks utilizados;
* recursos de confirmação de entrega disponíveis;
* recursos de verificação de existência de WhatsApp disponíveis.

## 5. ARQUIVOS CRIADOS

Caminho e responsabilidade.

## 6. ARQUIVOS ALTERADOS

Caminho e alteração.

## 7. BANCO

Informe:

* models;
* tabelas;
* campos;
* migrations;
* índices;
* constraints.

## 8. CAMPANHAS

Como:

* criar;
* agendar;
* disparar;
* pausar;
* retomar;
* cancelar.

## 9. STATUS DAS MENSAGENS

Explique como determina:

* enviado;
* entregue;
* lido;
* falha;
* inválido;
* sem WhatsApp.

## 10. PREFERÊNCIAS

Explique:

* defaults;
* revogação;
* link;
* revalidação antes de cada envio.

## 11. TELEFONES

Explique:

* normalização;
* validação;
* status de WhatsApp;
* cache;
* falhas transitórias.

## 12. IDEMPOTÊNCIA

Explique exatamente como duplicidade é impedida.

## 13. CONCORRÊNCIA

Explique locking/claims.

## 14. RETRIES

Explique política.

## 15. RATE LIMITER

Explique algoritmo e configuração.

## 16. ENDEREÇO

Informe:

* campos existentes;
* campos adicionados;
* migrations;
* validações;
* modal obrigatório.

## 17. SEGURANÇA

Principais controles implementados.

## 18. TESTES

Liste os comandos realmente executados e resultados.

## 19. BUILD

Informe lint, typecheck e build.

## 20. RISCOS RESIDUAIS

Somente riscos técnicos reais ainda existentes.

---

# INSTRUÇÃO FINAL

Trate esta implementação como uma evolução crítica de um sistema real em produção.

Primeiro:

ANALISE O PROJETO.

Depois:

COMPREENDA OS FLUXOS EXISTENTES.

Depois:

DESCUBRA EXATAMENTE COMO A EVOLUTION API É UTILIZADA.

Depois:

PROJETE A MENOR ARQUITETURA CORRETA E COMPATÍVEL COM O SISTEMA.

Depois:

IMPLEMENTE.

Depois:

TESTE.

Depois:

FAÇA UMA REVISÃO ADVERSARIAL.

Somente considere concluído quando:

* campanhas estiverem funcionando;
* preferências estiverem funcionando;
* defaults estiverem como `true`;
* opt-out posterior estiver funcionando;
* confirmação de entrega estiver implementada quando suportada;
* telefones inválidos forem tratados;
* números sem WhatsApp forem identificados quando possível;
* erros individuais não interromperem campanhas;
* endereço estiver completo;
* usuários antigos forem obrigados a completar endereço;
* modal existente tiver sido corretamente reutilizado;
* sistema legado continuar funcionando;
* testes estiverem passando;
* build estiver passando.
