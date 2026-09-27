# Histórico administrativo

O painel ADM consulta o histórico central por empresa, responsável, usuário afetado, ID exato de registro, trecho da operação, resultado e intervalo de até 366 dias. Datas inicial e final são inclusivas em UTC. A lista apresenta horários locais do dispositivo e 50 eventos por página. O resumo mostra os filtros efetivamente aplicados, inclusive quando o formulário contém mudanças ainda não aplicadas.

IDs de auditoria são strings decimais em SQL, JSON e cursores; não devem ser convertidos em números JavaScript. A paginação limita os resultados ao maior ID observado na primeira consulta. Isso evita incorporar IDs superiores entre páginas, mas não equivale a um snapshot transacional entre requisições: transações com IDs menores que confirmem posteriormente podem aparecer.

## Autorização e exportação

`POST /api/admin/audit` aceita somente sessão autenticada e filtros validados. A RPC `public.erp_admin_audit` verifica ADM ativo, sessão e AAL2 no banco. Exportar exige também TOTP recente. O navegador não recebe credenciais privilegiadas. Respostas não são armazenáveis em cache, e erros internos são sanitizados.

A exportação JSON usa os filtros aplicados e o limite superior atual, sem cursor de página. Uma única consulta captura todos os resultados visíveis naquele instante, até 5000 eventos. Acima disso, a operação falha e solicita filtros mais específicos; não entrega um arquivo incompleto silenciosamente. Consultas e exportações bem-sucedidas são registradas com ator, filtros, quantidade e correlação. O registro da própria exportação ocorre depois da seleção dos dados e não integra aquele arquivo.

O JSON contém informações administrativas sensíveis, incluindo os detalhes antes/depois já registrados no histórico. Guarde-o em local com acesso restrito. Não há alteração ou exclusão de auditoria por essa interface.

## Instalação e alcance

`db/admin-audit.sql` depende de `db/admin-control.sql` e é um módulo novo em desenvolvimento. Em 27/09/2026 não foi registrado nem aplicado como migração no Supabase. Deve receber migração incremental própria, com revisão dos privilégios e validação em homologação antes da ativação junto ao frontend. Não reescreva migrações já instaladas. Sem a RPC, a API retorna indisponibilidade explícita.

Esta tela pesquisa o histórico central existente. A coleta completa de eventos operacionais dos bancos exclusivos, tentativas negadas e eventos de autenticação ainda exige integração adicional. Não interpretar uma consulta vazia como prova de ausência de toda atividade no sistema.

## Verificação

`npm run test:audit` executa o handler HTTP com Auth/RPC simulados e testes SQL reais em banco descartável local na porta 55439. O segundo teste utiliza o ambiente privado de testes já preparado em `work/pg-test-password`; não executá-lo contra produção.

Cobertura: filtros combinados, limites de datas, IDs superiores ao limite seguro JavaScript, duas páginas sem duplicação, exportação completa, recusa acima de 5000, sessão revogada, ADM desativado, AAL1, MFA antigo, chamada pelo papel authenticated e ausência de acesso direto de atualização à auditoria.

O componente foi revisado no navegador com dados fictícios: filtros, paginação, detalhes e limpeza ao trocar empresa. O fluxo exibiu confirmação de exportação, mas a ferramenta de navegador não retornou o arquivo baixado; o conteúdo e os cabeçalhos foram verificados no teste HTTP. A validação autenticada completa com MFA real continua pendente.
