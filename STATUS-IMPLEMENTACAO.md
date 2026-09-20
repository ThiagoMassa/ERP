# Estado da implementação — 20/09/2026

Esta revisão está em desenvolvimento. Não confundir a compilação local com a versão publicada na Railway.

## Aplicado no Supabase central

- Migração `erp_admin_control_plane`, correspondente a `db/admin-control.sql`.
- Correção incremental `admin_policy_input_validation`: módulos/ações nulos também são negados explicitamente.
- Migração `tenant_request_authorization`, correspondente a `db/tenant-routing.sql`: contexto empresarial atual por sessão/vínculo/políticas, sem credenciais e com expiração de 25 segundos. Testes com rollback e consulta posterior confirmaram a instalação.
- Migração `admin_permission_matrix`, correspondente a `db/admin-permission-matrix.sql`: 80 decisões por usuário/empresa calculadas no servidor, versões das regras individuais e consulta auditada. Testes com rollback passaram antes e depois da aplicação.
- Migração `tenant_backup_control`, correspondente a `db/tenant-backup-control.sql`: solicitações com MFA recente, idempotência, suspensão/geração de acesso, etapas privadas, listagem paginada e auditoria. Testes no Supabase com rollback aprovados; consulta posterior confirmou zero jobs, backups ou empresas prontas.
- Identidade do primeiro ADM global vinculada à conta confirmada indicada pelo titular, por operação administrativa de bootstrap. Não há promoção pelo navegador, e-mail informado no login ou metadados editáveis.
- Cadastro privado de administradores, empresas, vínculos, políticas, estados de provisionamento, auditoria e registros de backup.
- RPCs administrativas verificam sessão existente, expiração, bloqueios, autorização global e AAL2. Alterações exigem TOTP recente e justificativa; versões protegem alterações concorrentes.
- Nenhum banco foi declarado pronto, nenhum backup foi declarado realizado e nenhum dado operacional foi migrado nesta etapa.
- O segundo fator da conta inicial ainda precisa ser cadastrado pelo titular pelo fluxo `/admin`.

## Código local e testes

- Painel ADM com identidade visual vermelha, login separado, matrícula/verificação de MFA, dashboard real, empresas, usuários, vínculos, regras e auditoria paginadas. A troca de contexto remonta a consulta, descartando resultados anteriores.
- Matriz interativa de permissões com busca paginada de usuários vinculados, rótulos em português, origem da decisão por célula e preparação de regras individuais com versão. A consulta não altera acesso. O salvamento continua exigindo MFA recente e justificativa.
- Nova interface operacional: navegação agrupada, descrições, períodos, estados de carregamento, formulários, tabelas paginadas, documentos comerciais, liquidações parciais e produção 3D.
- `db/erp-operations.sql`: rotinas transacionais de pedidos, atendimento, títulos, pagamentos, estoque, bobinas e impressão. Testado com rollback; ainda não aplicado.
- `db/admin-legacy-guards.sql`: políticas adicionais de bloqueio e permissões na API legada. Testado com rollback; ainda não aplicado.
- `db/operations-access.sql`: integração das rotinas operacionais com vínculos e permissões centrais, negação de operações sem política, verificação por ação, retirada de acesso direto às tabelas, proteção de fotos/3MF, expurgo de dados restritos em consultas agregadas e exportação auditada. Testado com rollback; ainda não aplicado. Não é substituto do isolamento físico/lógico de bancos.
- A interface consulta as permissões efetivas para menus, ações e exportação; recarrega ao navegar, mudar filtros/contexto ou voltar à janela. Marketplace exige empresa autorizada. Resumo por e-mail usa o financeiro transacional e exige permissão de exportação, mantendo o envio desativado sem credenciais.
- `tests/operations-access.sql`: usuários da mesma empresa veem o mesmo registro; troca de ID da empresa é negada; vínculo inativo perde acesso; bloqueio global afeta outras empresas; módulo desativado bloqueia API, upload e cache de idempotência; UUID fornecido não contorna autorização de criação; agregados não vazam financeiro; exportação verifica permissão e registra auditoria; funções internas e tabelas não são acessíveis diretamente.
- TypeScript, lint dos componentes alterados e build Next.js aprovados. Testes de domínio e geometria aprovados.
- Testes SQL administrativos: AAL1 negado, MFA antigo negado, sessão revogada negada, metadados de usuário sem elevação, precedência de bloqueio, função desconhecida negada, prontidão de banco não forjável e privilégios privados fechados. Dados de teste revertidos.
- Testes SQL operacionais: compra/venda, estoque, atendimento idempotente, pagamentos parciais/estorno, isolamento entre empresas, reserva e consumo real de bobina e produto final. Dados de teste revertidos.
- Tela de login ADM inspecionada no navegador local. Painel autenticado e cadastro de MFA ainda não exercitados ponta a ponta com usuário real.

## Bancos exclusivos — avanço em 19/09

- Driver PostgreSQL instalado; criação de bancos e usuários restritos, identidade permanente e migrações com checksum implementadas. Execução pelo operador em `scripts/provision-tenant.mjs`, com credenciais somente em segredos do servidor.
- Motor operacional portado para bancos independentes em `db/tenant/`, sem tabelas de autenticação locais. A autoria usa apenas IDs históricos.
- `app/api/erp`: revalida sessão e políticas centrais a cada requisição, resolve a conexão pelo UUID autorizado e recusa banco sem isolamento, migrações ou conciliação. O cliente operacional agora usa esta API exclusivamente no branch em revisão; a versão pública ainda usa o cliente anterior.
- ADM → Empresas → Verificar banco: diagnóstico real, acesso AAL2 auditado, sem senhas ou ativação pelo navegador. Código local; fluxo autenticado no navegador ainda não exercitado.
- PostgreSQL 17.11 portátil no diretório ignorado `work/`: testes reais com duas bases, bloqueio de conexão entre empresas, repetição sem duplicação, rollback de migração, venda/estoque/pagamentos/estornos/produção 3D e dois autores compartilhando os mesmos registros. Bases de teste removidas ao final.
- Nenhuma base operacional de produção foi criada ou ativada nesta etapa; a consulta do controle central confirmou zero empresas prontas. A conta ADM inicial segue sem fator MFA verificado.
- Configuração e limites documentados em `TENANT-DATABASES.md`. O provisionador verifica estrutura, mas não importa nem libera dados por conta própria.
- `db/tenant-cutover.sql`: solicitação com MFA recente, justificativa e versão; bloqueio de gravações legadas que espera transações em andamento; etapas privadas de cópia/conciliação/ativação; falhas mantêm a origem bloqueada. Testado localmente e com rollback no Supabase, **ainda não aplicado**.
- `lib/server/tenant-import.ts`: cópia por empresa com IDs/autores/datas originais, decimais exatos, contagens e SHA-256; conciliação de saldos, títulos e pagamentos; movimentos antigos não são reaplicados e receitas arquivadas não viram pagamentos. Importação é transacional e repetível sem sobrescrita.
- `lib/server/tenant-cutover.ts` e `004-maintenance.sql`: ativação somente após estrutura e conciliação verificadas; despacho bloqueado em preparação/manutenção. O worker revê autorização, revogação e MFA durante o corte. Testes reais cobrem falhas antes/depois do commit, repetição e consulta operacional com contexto central. Não há CLI/botão de corte liberado nem uso em produção.
- O importador recusa origem operacional v2 já utilizada e fotos sem registro de arquivo verificado. A migração de arquivos ainda não foi implementada; essa recusa impede liberação incompleta.
- `lib/server/tenant-backup.ts`: dump nativo por empresa com snapshot consistente, criptografia AES-256-GCM, manifesto autenticado, checksum e prazo de retenção. Repetição pelo mesmo ID reutiliza o artefato íntegro. A verificação restaura de verdade em banco temporário privado e compara tabelas, contagens, conteúdo e rotinas. Teste local com duas empresas aprovado; nenhum backup de produção realizado.

- Restauração real sobre banco existente: cópia anterior verificada, substituição transacional, comparação antes do commit, bloqueio operacional, geração de contexto, autoria e auditoria. Teste de falha após DROP SCHEMA comprovou rollback integral.
- `lib/server/tenant-maintenance.ts` e `scripts/run-maintenance.mjs`: execução privada de solicitações autorizadas, retomada sem sobrescrita e liberação após diagnóstico. Testes locais cobrem controle central real, duas empresas, MFA/revogação, confirmação, idempotência, falhas antes/depois da conclusão e rejeição de contextos antigos.
- Tela de backups com filtro, paginação, retenção, revisão de impacto, confirmação, MFA e acompanhamento. Componente real inspecionado com dados fictícios em desktop e 390 px. Nenhuma operação de produção disparada pela prévia.

## Cadastro central e interface empresarial — avanço em 20/09

- `db/company-workspace.sql` mantém empresas/vínculos no controle central e aplica permissão atual, versão e idempotência. Criar um negócio gera cadastro pendente; vincular um usuário reutiliza a base da empresa. Alterar metadados após o corte preserva os registros operacionais e mantém o legado congelado. Arquivamento é reversível e bloqueia o contexto operacional.
- `lib/operations.ts` usa exclusivamente `/api/erp` com token atual da sessão, empresa explícita e chave de repetição. Cadastros/permissões seguem RPCs centrais; operações seguem o banco exclusivo. Não existe fallback para RPC operacional legada.
- Interface exige escolha quando há várias empresas, descarta consultas/detalhes/formulários ao trocar contexto, desmonta o estúdio 3D entre empresas e mostra preparação/suspensão do banco. Ações nos cartões respeitam a permissão de cada empresa.
- Resumo por e-mail consulta o financeiro no banco exclusivo e exige exportação; marketplace verifica as permissões centrais antes de consultar o provedor. As integrações continuam sem credenciais e nenhum envio/busca externo foi disparado.
- `tests/company-workspace.test.mjs` aprovado com PostgreSQL real e três bases descartáveis: vínculos reutilizam bases, bloqueio é por empresa, versões rejeitam edição concorrente, repetição não contorna nova negação, metadados evoluem após corte, arquivo/restauração não apagam operações e acesso direto é negado.
- `tests/erp-transport.test.mjs` aprovado: token atualizado, empresa/chave corretos, propagação de erros e ausência de chamadas RPC legadas. A rede é simulada nesse teste; não representa login HTTP completo.
- Componente real exercitado no navegador com três empresas fictícias e API simulada: seleção, catálogos distintos, perfil de leitura e estado pendente. Layout de preparação conferido em 390 px; dimensões/ações de desktop inspecionadas via DOM. Não substitui validação com MFA e dados reais.
- A migração de cadastro central **não foi aplicada no Supabase**. Ela revoga CRUD direto sobre `business_units` e depende de `tenant-cutover.sql`; instalá-la com o cliente público antigo interromperia o cadastro legado. A publicação deve seguir a sequência em `COMPANY-WORKSPACE.md`.

## Pendências obrigatórias antes de promover esta revisão

1. Concluir validação ponta a ponta da autorização integrada. A migração `operations-access.sql` já centraliza a autorização das RPCs e revoga acesso aos núcleos e tabelas, mas ainda não foi aplicada. Publicar `erp-operations.sql` sem essa integração reintroduziria o modelo anterior. Revalidar todas as permissões após a migração para bancos exclusivos e testar os endpoints externos com credenciais de teste antes de ativá-los.
2. Concluir a implantação da arquitetura exclusiva: provisionador, motor, API, importador legado, conciliação e worker de corte passaram em PostgreSQL real; faltam migração/registro seguro de arquivos, execução operacional acompanhada pelo painel e origem v2 quando aplicável. Cadastros empresariais/vínculos e o cliente já foram adaptados no branch; falta instalar a migração central em conjunto com a publicação e testar uma sessão real. Configurar credenciais de produção e verificar CONNECT em outras bases, sem retirar privilégios internos do Supabase às cegas. Não aplicar a migração operacional compartilhada como substituto.
3. Concluir agendamento de backup/ensaios periódicos, aplicação auditada da retenção e inclusão dos arquivos externos. A integração controle/API/painel/operador e a restauração sobre banco existente estão implementadas e testadas localmente; faltam configuração privada, fluxo autenticado MFA no navegador e execução de produção.
4. Concluir correções administrativas de registros operacionais com empresa explícita, motivo, concorrência, identidade original preservada e auditoria antes/depois. Não existe editor genérico de SQL.
5. Concluir filtros por status/data, exportação auditada, convites/reenvios e acompanhamento de provisionamento. A consulta visual de permissões efetivas está implementada e testada com dados fictícios no navegador; ainda falta exercitar o salvamento pelo painel com uma sessão real MFA.
6. Completar devoluções comerciais e efeito financeiro correspondente. `fulfillment.reverse` atualmente desfaz o atendimento e reabre entrega; não deve ser tratado como devolução financeira definitiva. Verificar limites de números finitos, paginação de lookups e auditoria operacional antes/depois.
7. Testar os fluxos autenticados no navegador, perfis distintos e acesso direto às APIs; testar concorrência de estoque/pagamentos e arredondamento de parcelas. Verificar responsividade de todos os módulos.
8. Aplicar apenas as migrações compatíveis com a arquitetura final, atualizar a documentação de implantação e publicar/validar na Railway. A existência de um branch ou PR não significa implantação.

Resend, OAuth Google e SerpApi permanecem aguardando credenciais, conforme decisão do titular. Os arquivos 3MF foram validados estruturalmente e em geometria, mas ainda precisam de abertura real no Bambu Studio. O modelo A2 permanece manual/não verificado.

## Observações do advisor

As oito tabelas de `erp_control` têm RLS sem políticas de acesso direto, intencionalmente: não há grants de tabela para usuários, e o acesso ocorre por funções privadas com autorização explícita. Não adicionar políticas permissivas para eliminar esses avisos informativos.

A proteção contra senhas vazadas permanece desativada no projeto, um aviso anterior a esta revisão. [Documentação do Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
