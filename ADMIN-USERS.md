# Diretório e cadastro administrativo de usuários

O diretório usa `erp_admin_users` para listar nome cadastral, identificador, e-mail da identidade, situação, criação, último acesso e vínculos com empresas. A confirmação do e-mail é independente do bloqueio global. O filtro de empresa inclui vínculos suspensos para permitir sua gestão. Nomes são mantidos em `erp_control.user_profiles`; identidades sem cadastro exibem nome vazio, sem inferi-lo do e-mail.

Busca literal por trecho do nome/e-mail ou ID completo, filtros de situação e confirmação e paginação fixa de 20 registros são executados no servidor. A ordenação usa criação e ID. Paginação não é um snapshot entre requisições e pode mudar se forem criadas novas identidades. A consulta exige ADM ativo e AAL2 e registra filtros/contagem na auditoria central.

## Editar nome

Na lista, **Ações do usuário** abre a auditoria com o responsável preenchido; **Histórico da conta** preenche o usuário afetado. Ambos abrem o contexto global e os últimos 30 dias para incluir alterações cadastrais sem empresa associada. Os filtros permanecem visíveis e editáveis, e é possível selecionar outra empresa ou período. Entrar novamente pelo menu Auditoria limpa o atalho individual. O alcance continua sendo o histórico central existente, sem presumir cobertura de todos os eventos operacionais ou de autenticação.

O botão **Editar nome** abre o formulário administrativo com justificativa. A função `erp_admin_user_profile` exige MFA recente e a versão lida. Bloqueia a identidade durante a operação, inclusive na criação do primeiro perfil: duas edições com a mesma versão não podem ambas sobrescrever o cadastro. Conflitos retornam HTTP 409; atualize a lista e revise a alteração.

Nome, versão e autor da atualização ficam no cadastro privado. O evento registra o ADM real, usuário afetado, ID do registro, antes/depois, justificativa e correlação. Esta operação não altera senha, e-mail de autenticação, situação global, vínculos nem o cadastro de administradores. Essas decisões não são derivadas do nome cadastral.

## Instalação e pendências

`db/admin-account-audit.sql` foi aplicado no Supabase em 03/10/2026 pela migração `20261003160232_admin_directory_audit_records`. Normaliza novos eventos `user.status` e `user.revoke` como ações globais, com empresa nula e ID do usuário no registro. Isso vale também para chamadas diretas à RPC, independentemente do contexto enviado. O formulário e a API também usam contexto global; a API valida situação, versão e justificativa. Eventos antigos permanecem imutáveis. Não confundir bloqueio global da identidade com suspensão de um vínculo empresarial.

`db/admin-users.sql` depende de `db/admin-control.sql` e foi aplicado no Supabase em 03/10/2026 pela migração `20261003160232_admin_directory_audit_records`. A tabela privada mantém RLS e não concede acesso direto aos papéis anon/authenticated. Fontes e checksums em `CENTRAL-DEPLOYMENT.md`. Não reaplicar nem editar os módulos instalados; usar novas migrações incrementais. A publicação do frontend permanece pendente.

Continuam pendentes criação de identidades, convites, recuperação de senha, alteração verificada do e-mail, ampliação dos demais dados cadastrais e revisão autenticada no navegador. O envio de e-mails continua adiado pelo titular. O histórico operacional completo continua sendo tratado separadamente.

## Verificação

`npm run test:admin-users` executa testes de handler com Auth/RPC simulados e SQL real em banco descartável local na porta 55439, usando o ambiente privado de testes existente. Inclui busca, confirmação, estados, vínculos suspensos, paginação sem duplicação no conjunto estático, concorrência com duas conexões, auditoria antes/depois, negação de escrita direta, AAL1/MFA antigo e revogação de sessão. Não substitui testes com autenticação real nem ativa dados de produção.
