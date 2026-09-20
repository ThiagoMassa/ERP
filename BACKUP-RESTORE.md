# Backup e recuperação por empresa — integração em andamento

## Implementação atual

`lib/server/tenant-backup.ts` é um módulo exclusivo do operador de infraestrutura. Não é importado por rotas web. O painel ainda não dispara suas funções nem apresenta seus resultados; a tabela central de backups não está ligada a ele.

- `createTenantBackup`: valida banco, proprietário, identidade e migrações; exporta um snapshot PostgreSQL e usa esse mesmo snapshot para os registros de conferência e para o `pg_dump` em formato custom. O dump é criptografado durante o streaming com AES-256-GCM, sem arquivo SQL em claro no disco.
- `inspectBackup`: verifica empresa, ID, chave, assinatura HMAC do manifesto, tamanho e SHA-256 do arquivo criptografado. Não aceita substituição do manifesto para trocar empresa ou retenção.
- `verifyTenantRecovery`: cria um banco temporário privado, executa `pg_restore` real e compara contagens, SHA-256 de todos os registros das tabelas e definições das funções. O manifesto só recebe `verified_at` após a comparação. O banco temporário é removido ao concluir, inclusive em falhas.

Uma repetição de criação com o mesmo ID de solicitação reutiliza apenas um artefato completo e autenticado. Ela não sobrescreve o backup anterior nem renova sua data de retenção. Uma pasta incompleta não é adotada automaticamente.

O banco temporário nasce sem conexões permitidas; o acesso público é revogado antes de habilitar a conexão do operador. A credencial operacional da empresa não recebe acesso a ele. Nome, proprietário e ausência de dados são conferidos antes da recuperação. As bases operacionais existentes não são modificadas nesse ensaio.

## Configuração necessária para o operador

1. Executáveis oficiais `pg_dump` e `pg_restore`, em caminhos absolutos, compatíveis com a versão do servidor. Não instalar utilitários de origem desconhecida.
2. Conexão de manutenção PostgreSQL com acesso ao banco empresarial, criação de banco temporário e capacidade de assumir seu proprietário. Nunca colocar essa conexão no navegador ou no serviço web.
3. TLS com validação completa para conexões remotas; opcionalmente, caminho do certificado raiz confiável. O desvio de TLS existe somente para testes explicitamente configurados em loopback literal.
4. Diretório privado absoluto e persistente, fora da pasta pública da aplicação. Configure ACLs apropriadas no Windows ou permissões do usuário do operador no Linux. Copie os artefatos criptografados para armazenamento independente do servidor; um disco efêmero não é destino de proteção adequado.
5. Chave de 32 bytes em gerenciador de segredos e identificador de versão/rotação. Preserve as chaves antigas enquanto houver backups que dependam delas. Não coloque a chave junto aos arquivos de backup, em parâmetros de comandos, no Git ou nos logs.
6. Retenção desejada entre 1 e 3650 dias e limite de tamanho adequado. O limite padrão é 2 GiB de arquivo criptografado; ultrapassá-lo cancela a criação e remove o arquivo parcial.

O módulo recebe essas configurações de um chamador privado. Não há CLI liberada para uso em produção antes de integrar a autorização administrativa e a auditoria das solicitações.

## Artefatos

Cada ID tem sua pasta privada com `archive.enc` e `manifest.json`. O manifesto contém identidade, datas, versão da chave, contagens e hashes, sem senhas, tokens ou conteúdo dos registros. Ele é autenticado; alterações invalidam a conferência. O prazo de retenção está registrado, mas **não há exclusão automática implementada**.

Esquemas adicionais ou objetos binários PostgreSQL fora do modelo atual são recusados para não produzir uma cópia incompleta. Fotos e arquivos 3MF estão no Storage e não entram no dump PostgreSQL; a proteção de seus bytes/manifestos precisa ser integrada separadamente.

## Teste local reproduzível

O teste aceita somente o cluster descartável `127.0.0.1:55439`, usuário `erp_test_admin`, com senha lida de `work/pg-test-password`, e usa os executáveis oficiais em `work/postgresql/pgsql/bin`. Não aceita URL de produção. Cria e remove somente seus bancos, credenciais e arquivos temporários.

```powershell
node --experimental-strip-types tests/tenant-backup.test.mjs
```

O teste cria dados em duas empresas, faz backup da primeira, muda seus dados atuais e recupera a cópia em banco temporário. Compara integralmente os registros e funções restaurados e confirma que ambas as empresas originais continuam com seus dados atuais. Também testa ID repetido, chave incorreta, backup de outra empresa, corrupção de bytes/manifesto e limpeza depois de exceder o limite de tamanho.

## Antes de restaurar sobre uma empresa existente

Esse procedimento **ainda não está implementado**. A integração deve exigir seleção de empresa e backup, confirmação do impacto, justificativa e MFA recente; validar o artefato, criar uma cópia de segurança do estado atual, suspender as operações, restaurar transacionalmente, verificar os dados e registrar a ação no controle central antes de liberar o acesso.

Também faltam acompanhamento pelo painel, execução periódica dos ensaios, tratamento auditado de retenção, proteção de cópias usadas por restaurações em andamento e migração dos arquivos externos. A função de ensaio isolado não deve ser apresentada como restauração concluída sobre a empresa.

As ferramentas seguem os formatos e garantias descritos na documentação oficial de [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html) e [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
