# Registro de implantação central — 03/10/2026

## Atualização em 08/10/2026

Migração **20261008192234_admin_document_cancellation_context**, aplicada e conferida no histórico remoto. Fonte `db/admin-cancellations.sql`; SHA-256 `dee4e53f7c63cc4f67be2205dac648630f81bc62a40a109839305fe9524d01d7`. Amplia a autorização existente para cancelamento administrativo de pedidos e títulos avulsos, com ADM/MFA recente, justificativa e somente as permissões necessárias. Preservar esta fonte instalada; futuras mudanças exigem nova migração.

Depois da aplicação, as duas operações foram recusadas sem sessão em transação revertida. RPC pública permanece SECURITY INVOKER, EXECUTE negado a anon, permitido a authenticated com autorização interna; função privada também nega anon. Advisor não apresentou novos avisos: continuam nove informativos de RLS sem política nas tabelas privadas e o aviso de proteção contra senhas vazadas desativada. Nenhum documento de produção foi cancelado. A migração empresarial 012, bancos exclusivos e frontend ainda aguardam implantação; testes positivos usaram o cluster Linux descartável, sem simular MFA na conta real.

## Atualização em 04/10/2026

Migração **20261004104831_admin_overview_metrics_alerts**, aplicada e conferida no histórico remoto. Fonte `db/admin-overview.sql`; SHA-256 `d61770a025de285637858d3c1f2c61f27b428097292edcafaf828e33d0affe5b`. Completa a classificação de contas e os resumos de falhas registradas. RPC pública permanece SECURITY INVOKER; função privada nega EXECUTE a anon e exige ADM/AAL2 por meio do leitor existente. Chamadas sem sessão foram recusadas após instalação. Advisor mantém os avisos anteriores. Nenhuma conta, vínculo, empresa ou solicitação foi alterada pela implantação. Preservar a fonte instalada.

Migração **20261004104327_admin_company_directory**, aplicada e conferida no histórico remoto. Fonte `db/admin-company-directory.sql`; SHA-256 `912c612d93f7df3acd2e569c3a029baa3d799bdd939733e0ce89d08648f37fdd`. Amplia a lista com cadastro, banco, vínculos e tentativa mais recente de backup, preservando a data do último verificado. Não retorna credenciais, artefatos, checksums ou notas privadas. RPC pública permanece SECURITY INVOKER; função privada nega EXECUTE a anon e valida ADM/AAL2 pelo leitor existente. Índice por empresa/data presente e chamadas sem sessão recusadas. Advisor sem novos avisos. A interface ainda não foi publicada; preservar esta fonte instalada.

Migração **20261004103750_admin_product_status_context**, aplicada e conferida no histórico remoto. Fonte: `db/admin-product-status.sql`; SHA-256 dos bytes: `c37e6a765a618c1eae9bb300fd99d99d6b87637f2c6951471336e155e0298d79`. Preservar esta fonte instalada; alterações futuras exigem nova migração incremental.

Amplia o contexto de alteração administrativa para inativar/reativar produtos, exigindo ADM/MFA recente e somente a ação necessária. A função pública continua SECURITY INVOKER, com EXECUTE negado a anon; as duas novas operações foram recusadas sem sessão autenticada. Nenhum produto real foi alterado. A migração empresarial 009 e o frontend não foram publicados em produção. Testes positivos de autorização/transação usam identidades de ensaio no Linux, não a conta ADM real. Advisor mantém os avisos anteriores de tabelas privadas sem políticas e proteção contra senhas vazadas desativada.

## Migração de 03/10/2026

Projeto: kbqzwdttqptttoceygkd (Phaxe Solutions). Migração aplicada via conector Supabase: **20261003160232_admin_directory_audit_records**. Versão conferida no histórico remoto após a aplicação.

Fontes concatenadas nesta ordem, separadas por uma quebra de linha. SHA-256 dos bytes locais de cada fonte; preservar os arquivos instalados e usar migrações incrementais para mudanças futuras. Este registro não é um comando de reaplicação.

| Fonte | SHA-256 |
| --- | --- |
| db/admin-audit.sql | 732357346134bfafb6bb8687ad20d0473e39a21978dba91e5b7a0ccdf5d18916 |
| db/admin-users.sql | 2f2175592baa95dbb3ceb410eb2684dc176a52f44dbba694ea86a4f5bf5cd229 |
| db/admin-account-audit.sql | 843f8b36fe46b5a117cdca8d9dc9ca8909e7c66859ec01cec73f44507454d3b8 |
| db/admin-records.sql | 34d768b4a09a00e336a1d5a194fb36eaa0287885f180026852d6ffebc3094d61 |
| db/admin-corrections.sql | 632ef61a3020d81b7994bdf499d357d4df524ec6c0f29da551d32a526110f1c3 |

Verificação posterior: cinco RPCs públicas presentes, SECURITY INVOKER, execução negada a anon e permitida a authenticated sob autorização interna. Tabela erp_control.user_profiles com RLS e sem leitura/escrita direta para authenticated. Chamadas sem sessão às RPCs de usuários, auditoria, registros e correções foram recusadas em transação revertida. Isso não comprova o login real do ADM nem os fluxos positivos com MFA.

Estado: uma empresa pendente, zero bancos empresariais prontos. Nenhum backup, corte ou migração de dados empresariais realizado nesta implantação. Corte/cadastro empresarial, frontend e operador ainda pendentes. Avisos do advisor: nove informativos de RLS sem política em tabelas privadas e proteção contra senhas vazadas desativada.

O titular escolheu o Supabase atual para os bancos exclusivos. O inventário encontrou CONNECT concedido a PUBLIC em postgres e template1; template1 pertence a supabase_admin e não pode ser administrado pela conexão disponível. O diagnóstico do ERP exige impedir conexão a todas as outras bases e permanece bloqueante. Consultar TENANT-DATABASES.md antes de provisionar.
