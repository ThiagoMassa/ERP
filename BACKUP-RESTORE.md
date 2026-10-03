# Backup e recuperação por empresa

## Estado atual

O controle central `db/tenant-backup-control.sql` está aplicado no Supabase. A interface, API, operador e restauração estão implementados nesta revisão local/PR; ainda não publicados na Railway. Não existem backups de produção nem bancos empresariais de produção liberados.

O painel **Bancos e backups** exige empresa selecionada e sessão ADM com MFA. Mostra cópias, tamanho, datas, retenção, verificação e solicitações, com filtros e paginação. Para solicitar backup ou restauração, exige justificativa e confirmação recente da identidade. A restauração apresenta o impacto e exige confirmação explícita da empresa e do backup.

Uma solicitação não é um backup concluído. O painel registra uma fila autorizada; a execução ocorre em processo privado com ferramentas PostgreSQL. Não há execução nativa nem credenciais de manutenção nas rotas web. A autorização do solicitante é revalidada durante a execução e expira após dez minutos; o solicitante pode renová-la no painel com MFA recente.

## Garantias do mecanismo

- `createTenantBackup`: valida banco, proprietário, identidade e migrações. Usa um snapshot PostgreSQL comum ao inventário e ao `pg_dump` custom. Criptografa o stream com AES-256-GCM, sem gravar SQL em claro. O manifesto é autenticado por HMAC e contém contagens, hashes, versão da chave e retenção.
- `verifyTenantRecovery`: cria um banco temporário privado, executa `pg_restore` real e compara tabelas, contagens, conteúdo e rotinas. Só depois registra a verificação. Remove o banco temporário ao concluir, inclusive em falhas.
- `restoreTenantBackup`: verifica o backup selecionado, bloqueia o despacho operacional e aguarda transações em andamento. Cria e verifica uma cópia do estado atual, com retenção de 30 dias. A substituição dos esquemas e a comparação dos dados ocorrem em uma única transação, usando `psql` e `pg_restore`. Falhas antes do commit preservam os dados anteriores. A empresa permanece em manutenção até a liberação pelo controle central.
- `runTenantMaintenance`: revalida autorização, registra a cópia de segurança, acompanha etapas e auditoria e confere o banco usando sua credencial restrita antes de liberar. O marcador de restauração e a chave da solicitação permitem retomar uma resposta perdida sem restaurar novamente. O bloqueio por solicitação impede dois operadores simultâneos.
- A restauração muda a geração de autorização (`access_epoch`): contextos de requisições anteriores são recusados pelo banco. Autorizações e usuários permanecem no controle central, fora da cópia empresarial.

A autoria original dos registros é preservada. O evento de restauração identifica o ADM real, a justificativa, o backup selecionado, a cópia de segurança e a correlação central. Uma restauração não modifica outra empresa.

## Instalação e configuração do operador

### Execução no servidor Linux, sem instalar pg_dump no computador

O computador do usuário precisa apenas acessar o painel. `deploy/backup-operator.Dockerfile` empacota Node e as ferramentas oficiais PostgreSQL 17 para executar o operador no servidor Linux. A imagem inicia somente o comando de manutenção, não inicia um servidor PostgreSQL e não precisa de domínio nem porta pública. As imagens-base oficiais são [Node](https://hub.docker.com/_/node) e [PostgreSQL](https://hub.docker.com/_/postgres).

No ambiente Linux do operador, construa com `docker build --target production -f deploy/backup-operator.Dockerfile -t erp-backup-operator .`. Monte um volume persistente em `/backups`, gravável pelo usuário `postgres` da imagem, e forneça as variáveis privadas abaixo pelo gerenciador de segredos da hospedagem. Inicie a imagem passando o UUID de uma solicitação já autorizada no painel. Sem UUID, ela mostra ajuda e encerra. É um processo de execução única; não configure reinício infinito nem trate isso como agendamento já implementado. Em Railway, use um serviço separado do frontend com este Dockerfile e volume privado; a configuração e ativação desse serviço ainda estão pendentes.

A imagem define os caminhos de `pg_dump`, `pg_restore`, `psql` e `/backups`. Não coloque credenciais no Dockerfile, argumentos de build ou repositório. O arquivo de exclusões do Dockerfile limita o contexto a código, dependências e migrações. A chave de criptografia e a cópia independente dos artefatos continuam necessárias.

O workflow `Backup and recovery on Linux` constrói uma imagem de verificação e executa testes com dois bancos descartáveis dentro do contêiner, com rede externa desativada. Não recebe segredos nem acessa produção. Isso transfere a validação nativa para Linux; não é backup dos dados reais. O bloqueio de `libpq.dll` voltou a ocorrer no Windows em 01/10/2026; não é necessário instalar novamente os utilitários nem alterar as proteções locais.

Aplique o controle central depois de `admin-control.sql` e `tenant-routing.sql`. Os bancos empresariais precisam de todo o pacote atual listado em `tenantMigrations()`; atualize o roteador em conjunto. O corte e a conciliação devem estar concluídos antes de o banco ser marcado como pronto. Não altere esse estado manualmente para habilitar botões.

Execute `scripts/run-maintenance.mjs` em um ambiente privado separado do serviço web. Configure os seguintes valores pelo gerenciador de segredos, sem incluí-los em argumentos do processo, Git ou logs:

| Variável | Uso |
| --- | --- |
| `ERP_CONTROL_OPERATOR_URL` | Conexão PostgreSQL privada ao controle central, autorizada para as etapas de manutenção. |
| `ERP_CONTROL_CA` | Certificado CA em PEM para a conexão central, quando necessário. |
| `ERP_PROVISIONER_URL` | Conexão privada ao cluster empresarial com capacidade de criar bancos temporários e assumir os proprietários empresariais. |
| `ERP_TENANT_<UUID_SEM_HIFENS_EM_MAIUSCULAS>_URL` | Credencial operacional restrita da empresa, usada para conferir isolamento e saúde. |
| `ERP_PG_ROOT_CERT` | Caminho absoluto de certificado raiz confiável, quando necessário. Usado pelo driver e pelas ferramentas nativas. |
| `ERP_PG_DUMP`, `ERP_PG_RESTORE`, `ERP_PSQL` | Caminhos absolutos para os executáveis oficiais compatíveis com o servidor. |
| `ERP_BACKUP_DIRECTORY` | Diretório absoluto privado e persistente, fora da pasta pública da aplicação. |
| `ERP_BACKUP_KEY_ID` | Identificador da chave atual (letras, números, `_` ou `-`, até 64 caracteres). |
| `ERP_BACKUP_KEYS` | Objeto JSON privado que associa cada identificador a uma chave de 32 bytes em hexadecimal (64 caracteres). |

As URLs PostgreSQL devem conter banco, usuário e senha, sem parâmetros adicionais. TLS é obrigatório na CLI, com validação de certificado. O desvio de TLS existe somente nas funções de teste explícitas em loopback, não no comando de produção.

Preserve as chaves antigas durante a retenção dos artefatos e durante solicitações pendentes. Não rotacione a chave atual no meio de uma solicitação incompleta. Configure ACLs no Windows ou permissões restritas no Linux. Mantenha cópia dos arquivos criptografados em armazenamento independente; um disco efêmero não é proteção adequada.

## Procedimento

1. No painel ADM, selecione a empresa. Confirme identidade com MFA, informe a justificativa e solicite o backup. Para restaurar, escolha um backup verificado dentro da retenção, revise o impacto e marque a confirmação.
2. Copie o UUID da solicitação e execute no ambiente privado:

   ```text
   node --experimental-strip-types scripts/run-maintenance.mjs <UUID-da-solicitacao>
   ```

3. Atualize o painel. `Solicitado` indica que o operador ainda não concluiu o trabalho; `Verificado` exige recuperação real bem-sucedida. Durante restauração, acompanhe a cópia de segurança, a conferência e a liberação.
4. Em falha, mantenha a empresa suspensa. Corrija a causa, renove a autorização da mesma solicitação com MFA e execute novamente o mesmo UUID. Não crie outro job nem libere o banco manualmente. Se houver perda de resposta após o commit, a repetição consulta o marcador e conclui as etapas restantes.

O limite padrão é 2 GiB de arquivo criptografado. Uma pasta incompleta não é adotada nem sobrescrita automaticamente. Backups usados para restauração devem corresponder ao pacote de migrações instalado; não há conversão automática entre versões de esquema.

## Limites ainda pendentes

- Agendamento de backups e ensaios periódicos de recuperação.
- Exclusão auditada por retenção e proteção dos artefatos usados por solicitações em andamento. O prazo já é registrado e verificado; não há exclusão automática.
- Janela/exportação das fotos antigas do Storage em produção. A importação por pacote local está implementada; novos arquivos ficam em `tenant.assets` e entram no dump. Em 26/09 passou a recuperação nativa de PNG e 3MF byte a byte, após alteração controlada, preservando referências e outra empresa. O bloqueio dos executáveis observado em 21/09 não se repetiu. Consulte `TENANT-ASSETS.md`.
- Configuração da infraestrutura privada de produção, execução pelo operador e teste autenticado pelo painel com MFA real. O primeiro ADM precisa matricular seu segundo fator.

## Verificação reproduzível

Os testes nativos aceitam somente o cluster local descartável `127.0.0.1:55439`, usuário `erp_test_admin`, com senha em `work/pg-test-password`. Usam executáveis oficiais em `work/postgresql/pgsql/bin` e removem apenas seus bancos e arquivos temporários.

```text
node --experimental-strip-types tests/tenant-backup.test.mjs
node --experimental-strip-types tests/tenant-maintenance.test.mjs
```

Cobrem corrupção de arquivo/manifesto, chave errada, empresa errada, recuperação integral, cópia anterior, falha após DROP SCHEMA com rollback, revogação de autorização, resposta perdida antes/depois da conclusão, repetição sem sobrescrita, epoch antiga recusada, autoria e segunda empresa preservadas. `tests/tenant-backup-control.sql` testa as regras centrais dentro de BEGIN/ROLLBACK, sem produzir artefatos reais. A prévia visual usa respostas fictícias e não comprova autenticação ou execução em produção.

Referências dos utilitários: [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html) e [psql](https://www.postgresql.org/docs/17/app-psql.html).
