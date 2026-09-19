# Estado da implementação — 19/09/2026

Esta revisão está em desenvolvimento. Não confundir a compilação local com a versão publicada na Railway.

## Aplicado no Supabase central

- Migração `erp_admin_control_plane`, correspondente a `db/admin-control.sql`.
- Correção incremental `admin_policy_input_validation`: módulos/ações nulos também são negados explicitamente.
- Migração `tenant_request_authorization`, correspondente a `db/tenant-routing.sql`: contexto empresarial atual por sessão/vínculo/políticas, sem credenciais e com expiração de 25 segundos. Testes com rollback e consulta posterior confirmaram a instalação.
- Identidade do primeiro ADM global vinculada à conta confirmada indicada pelo titular, por operação administrativa de bootstrap. Não há promoção pelo navegador, e-mail informado no login ou metadados editáveis.
- Cadastro privado de administradores, empresas, vínculos, políticas, estados de provisionamento, auditoria e registros de backup.
- RPCs administrativas verificam sessão existente, expiração, bloqueios, autorização global e AAL2. Alterações exigem TOTP recente e justificativa; versões protegem alterações concorrentes.
- Nenhum banco foi declarado pronto, nenhum backup foi declarado realizado e nenhum dado operacional foi migrado nesta etapa.
- O segundo fator da conta inicial ainda precisa ser cadastrado pelo titular pelo fluxo `/admin`.

## Código local e testes

- Painel ADM com identidade visual vermelha, login separado, matrícula/verificação de MFA, dashboard real, empresas, usuários, vínculos, regras e auditoria paginadas. A troca de contexto remonta a consulta, descartando resultados anteriores.
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
- `app/api/erp`: revalida sessão e políticas centrais a cada requisição, resolve a conexão pelo UUID autorizado e recusa banco sem isolamento, migrações ou conciliação. Ainda não é usado pelo cliente operacional.
- ADM → Empresas → Verificar banco: diagnóstico real, acesso AAL2 auditado, sem senhas ou ativação pelo navegador. Código local; fluxo autenticado no navegador ainda não exercitado.
- PostgreSQL 17.11 portátil no diretório ignorado `work/`: testes reais com duas bases, bloqueio de conexão entre empresas, repetição sem duplicação, rollback de migração, venda/estoque/pagamentos/estornos/produção 3D e dois autores compartilhando os mesmos registros. Bases de teste removidas ao final.
- Nenhuma base operacional de produção foi criada ou ativada nesta etapa; a consulta do controle central confirmou zero empresas prontas. A conta ADM inicial segue sem fator MFA verificado.
- Configuração e limites documentados em `TENANT-DATABASES.md`. O provisionador verifica estrutura, mas não importa nem libera dados por conta própria.

## Pendências obrigatórias antes de promover esta revisão

1. Concluir validação ponta a ponta da autorização integrada. A migração `operations-access.sql` já centraliza a autorização das RPCs e revoga acesso aos núcleos e tabelas, mas ainda não foi aplicada. Publicar `erp-operations.sql` sem essa integração reintroduziria o modelo anterior. Revalidar todas as permissões após a migração para bancos exclusivos e testar os endpoints externos com credenciais de teste antes de ativá-los.
2. Concluir a implantação da arquitetura exclusiva: o provisionador, motor transacional, API e diagnóstico existem e passaram em PostgreSQL real, mas faltam importação/contagem/conciliação dos dados legados, registro seguro de arquivos, corte com bloqueio de escrita e ativação central auditada. Adaptar cadastros empresariais/vínculos e o cliente para a nova API. Configurar credenciais de produção e verificar CONNECT em outras bases, sem retirar privilégios internos do Supabase às cegas. Não aplicar a migração operacional compartilhada como substituto.
3. Implementar backup e restauração por banco, retenção, verificação, cópia anterior à restauração, bloqueio operacional e ensaio de recuperação. A tabela de estado não é um mecanismo de backup.
4. Concluir correções administrativas de registros operacionais com empresa explícita, motivo, concorrência, identidade original preservada e auditoria antes/depois. Não existe editor genérico de SQL.
5. Concluir consulta/simulação visual de permissões efetivas, filtros por status/data, exportação auditada, convites/reenvios e detalhes de erros/provisionamento. O servidor já calcula precedência de regras, mas a UX completa ainda está pendente.
6. Completar devoluções comerciais e efeito financeiro correspondente. `fulfillment.reverse` atualmente desfaz o atendimento e reabre entrega; não deve ser tratado como devolução financeira definitiva. Verificar limites de números finitos, paginação de lookups e auditoria operacional antes/depois.
7. Testar os fluxos autenticados no navegador, perfis distintos e acesso direto às APIs; testar concorrência de estoque/pagamentos e arredondamento de parcelas. Verificar responsividade de todos os módulos.
8. Aplicar apenas as migrações compatíveis com a arquitetura final, atualizar a documentação de implantação e publicar/validar na Railway. A existência de um branch ou PR não significa implantação.

Resend, OAuth Google e SerpApi permanecem aguardando credenciais, conforme decisão do titular. Os arquivos 3MF foram validados estruturalmente e em geometria, mas ainda precisam de abertura real no Bambu Studio. O modelo A2 permanece manual/não verificado.

## Observações do advisor

As sete tabelas de `erp_control` têm RLS sem políticas de acesso direto, intencionalmente: não há grants de tabela para usuários, e o acesso ocorre por funções privadas com autorização explícita. Não adicionar políticas permissivas para eliminar esses avisos informativos.

A proteção contra senhas vazadas permanece desativada no projeto, um aviso anterior a esta revisão. [Documentação do Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
