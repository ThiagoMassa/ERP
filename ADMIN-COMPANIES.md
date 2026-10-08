# Lista administrativa de empresas

A lista apresenta nome, UUID, situação, razão social, documento, criação, vínculos totais e ativos, identificação lógica do banco e data de validação registrada. O acompanhamento de backup distingue a última solicitação (inclusive falhas) do último backup verificado. Campos ausentes indicam ausência de registro; não são tratados como sucesso ou zero vínculos sem evidência.

A data de validação do banco é histórica. **Verificar banco** executa a consulta atual de conexão, identidade, isolamento e migrações; a lista não afirma disponibilidade em tempo real. A situação de provisionamento permanece separada da suspensão da empresa.

`db/admin-company-directory.sql` adiciona o complemento privado `erp_control.company_directory`, chamado pela RPC existente `erp_admin_read` para a seção de empresas. As demais seções continuam delegadas ao leitor anterior. A autorização ADM, sessão e AAL2 do leitor central ocorre antes de obter os dados. A paginação e a contagem originais são preservadas. Referências de credenciais, caminhos de artefatos, checksums, chaves e notas privadas de backup não são retornados.

O índice por empresa/data/ID permite localizar a tentativa mais recente sem misturar uma falha atual com uma verificação anterior. A lista não cria backups, ativa bancos ou altera vínculos. Os botões de edição, verificação e registro de etapas continuam sujeitos às autorizações existentes.

Verificação: teste SQL em banco descartável cobre ausência de backup, tentativa falha posterior a uma verificação, ausência de dados privados, vínculos inativos incluídos somente no total, página vazia mantendo contagem, empresa inexistente e recusa de AAL1/anon. A [execução Linux 37196189481](https://github.com/ThiagoMassa/ERP/actions/runs/37196189481), commit `f7e9caa02501de18baa10ae900f880830f25b751`, passou esses cenários e as regressões de provisionamento, correções e backup/restauração. Build, TypeScript e lint locais passaram.

Instalado no Supabase central em 04/10/2026 pela migração `20261004104327_admin_company_directory`. Privilégios, índice e recusa sem sessão foram conferidos após instalação; advisor sem novos avisos. Preservar o módulo SQL instalado e usar novas migrações para alterações. A publicação do frontend e a validação autenticada no navegador continuam pendentes.
