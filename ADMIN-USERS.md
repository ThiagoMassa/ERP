# Diretório e cadastro administrativo de usuários

O diretório usa `erp_admin_users` para listar nome cadastral, identificador, e-mail da identidade, situação, criação, último acesso e vínculos com empresas. A confirmação do e-mail é independente do bloqueio global. O filtro de empresa inclui vínculos suspensos para permitir sua gestão. Nomes são mantidos em `erp_control.user_profiles`; identidades sem cadastro exibem nome vazio, sem inferi-lo do e-mail.

Busca literal por trecho do nome/e-mail ou ID completo, filtros de situação e confirmação e paginação fixa de 20 registros são executados no servidor. A ordenação usa criação e ID. Paginação não é um snapshot entre requisições e pode mudar se forem criadas novas identidades. A consulta exige ADM ativo e AAL2 e registra filtros/contagem na auditoria central.

## Editar nome

O botão **Editar nome** abre o formulário administrativo com justificativa. A função `erp_admin_user_profile` exige MFA recente e a versão lida. Bloqueia a identidade durante a operação, inclusive na criação do primeiro perfil: duas edições com a mesma versão não podem ambas sobrescrever o cadastro. Conflitos retornam HTTP 409; atualize a lista e revise a alteração.

Nome, versão e autor da atualização ficam no cadastro privado. O evento registra o ADM real, usuário afetado, ID do registro, antes/depois, justificativa e correlação. Esta operação não altera senha, e-mail de autenticação, situação global, vínculos nem o cadastro de administradores. Essas decisões não são derivadas do nome cadastral.

## Instalação e pendências

`db/admin-users.sql` depende de `db/admin-control.sql`. É um módulo novo ainda não registrado/aplicado no Supabase em 27/09/2026; requer migração incremental própria antes da publicação do frontend. Não reaplicar ou editar migrações anteriores instaladas. Até instalar, a API responde com indisponibilidade explícita; não cai silenciosamente na consulta antiga.

Continuam pendentes criação de identidades, convites, recuperação de senha, alteração verificada do e-mail, ampliação dos demais dados cadastrais e revisão autenticada no navegador. O envio de e-mails continua adiado pelo titular. O histórico operacional completo continua sendo tratado separadamente.

## Verificação

`npm run test:admin-users` executa testes de handler com Auth/RPC simulados e SQL real em banco descartável local na porta 55439, usando o ambiente privado de testes existente. Inclui busca, confirmação, estados, vínculos suspensos, paginação sem duplicação no conjunto estático, concorrência com duas conexões, auditoria antes/depois, negação de escrita direta, AAL1/MFA antigo e revogação de sessão. Não substitui testes com autenticação real nem ativa dados de produção.
