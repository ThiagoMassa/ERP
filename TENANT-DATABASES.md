# Bancos exclusivos por empresa — em implantação

O banco Supabase central mantém autenticação, empresas, vínculos, permissões e auditoria administrativa. Cada banco operacional tem nome `erp_<UUID sem hífens>`, proprietário sem login e usuário de execução exclusivo. Este código ainda não está conectado à interface operacional publicada.

## O que está implementado e verificado

- `db/tenant-routing.sql`: autorização central a cada requisição, sessão real, vínculo e políticas atuais. O contexto dura no máximo 25 segundos; o navegador não fornece contexto nem conexão à API.
- `app/api/erp/route.ts`: valida entrada, resolve o segredo pelo UUID autorizado e exige identidade, credencial restrita, migrações e conciliação verificadas. Não existe fallback silencioso à base compartilhada.
- `db/tenant/`: identidade, migrações com checksum e motor operacional, sem cópia de senhas, tokens ou tabelas de autenticação. `tenant.actors` preserva somente IDs históricos de autores.
- `lib/server/tenant-database.ts`: criação repetível, bloqueio de provisionamento concorrente, propriedade verificada, recusa de banco ocupado sem identidade, migrações transacionais e usuário com execução apenas nas funções de saúde e despacho. Não troca a senha de um perfil existente durante uma repetição.
- Diagnóstico em ADM → Empresas → Verificar banco: conexão, identidade, isolamento, migrações e conciliação. Somente ADM com MFA; consulta auditada e sem exposição de credenciais.
- Testes com PostgreSQL 17 real: dois bancos e dois usuários de banco, acesso cruzado negado pelo PostgreSQL, dois autores no mesmo banco, estoque, vendas, pagamentos parciais, estornos e produção 3D; falha de migração/estoque revertida e repetição sem duplicação.

## Preparação da infraestrutura

### Situação do projeto atual em 03/10/2026

O titular escolheu reutilizar o Supabase atual, projeto `kbqzwdttqptttoceygkd`, organização Phaxe Solutions. Nenhum PostgreSQL adicional foi criado na Railway. A Railway tem somente o frontend; não há operador de backup nem volume persistente configurado.

O inventário remoto confirmou que `postgres` possui CREATEDB/CREATEROLE, mas não SUPERUSER. `postgres` e `template1` permitem conexão por `PUBLIC`; `template1` pertence a `supabase_admin`, cujo papel não pode ser assumido pela conexão disponível. Por isso, criar bancos e usuários novos não basta para passar a regra de isolamento atual: as credenciais ainda herdariam conexão a outras bases. Não foram alterados os privilégios dos serviços internos, e a verificação de isolamento continua obrigatória.

Antes de provisionar, obter do suporte Supabase um procedimento suportado para restringir essas conexões preservando Auth, Storage, pooler, manutenção e atualizações. Texto preparado para o titular enviar (não enviado automaticamente):

> No projeto kbqzwdttqptttoceygkd, precisamos de bancos lógicos separados por empresa, com usuários próprios que só possam conectar ao respectivo banco. O inventário mostra CONNECT para PUBLIC em postgres e template1. Template1 pertence a supabase_admin, e postgres não é superusuário nem pode assumir esse proprietário. Existe procedimento suportado para remover esse acesso herdado, mantendo os privilégios explícitos necessários aos serviços internos e garantindo persistência após upgrades? Precisamos também confirmar suporte a pg_dump/pg_restore dos bancos adicionais via conexão direta ou pooler de sessão com TLS validado. Não autorizamos mudanças antes de revisar o procedimento e a janela de aplicação.

A resposta do suporte precisa ser validada no diagnóstico real com cada credencial empresarial. Ainda faltam segredos privados do operador, hospedagem Linux/armazenamento persistente, primeiro provisionamento, ensaio de recuperação e corte. Não colocar credenciais de manutenção no frontend. A imagem Linux e os testes do GitHub dispensam instalação de pg_dump no computador do titular, mas não constituem um serviço de backup de produção ativo.

A documentação oficial confirma que [Supabase/Supavisor aceita bancos distintos e usuários próprios](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI#what-is-the-userdbmode-combination). Auth, Storage e a API REST continuam no banco central; as consultas operacionais usam PostgreSQL pelo servidor da aplicação.

Use uma conexão de manutenção com `CREATEDB`, `CREATEROLE` e capacidade de assumir o proprietário do banco. Use sessão direta ou pooler de sessão para provisionar; `CREATE DATABASE` não pode executar dentro de transação. Essa conexão **não deve existir no serviço web**. O usuário operacional não recebe criação de banco/perfis, superusuário, replicação, `BYPASSRLS`, associação a outros perfis ou acesso direto às tabelas.

Antes de instalar em um servidor compartilhado, inventarie os privilégios `CONNECT` das outras bases. O PostgreSQL concede `CONNECT` a `PUBLIC` por padrão; conceder acesso exclusivo na base A não retira automaticamente o acesso concedido por `PUBLIC` na base central. O diagnóstico recusa uma credencial que possa conectar a outra base. Não retire privilégios de bases Supabase automaticamente: preserve os perfis internos necessários e valide o inventário, ou use um servidor operacional separado. Os testes revogam os defaults somente no cluster local descartável.

TLS com validação de certificado é obrigatório. Para uma autoridade privada, configure `ERP_TENANT_CA` com o certificado da autoridade confiável. Nunca use `rejectUnauthorized=false`. O desvio de TLS existe apenas como argumento explícito dos testes e aceita somente loopback literal; nenhuma rota web o utiliza.

## Provisionamento pelo operador

Execute primeiro no ambiente privado Linux, com `ERP_PROVISIONER_URL` e o certificado configurados:

```sh
node --experimental-strip-types scripts/preflight-tenant.mjs <UUID-da-empresa>
```

O relatório consulta catálogos: capacidade de criar bancos/perfis, acesso a outras bases via PUBLIC ou credencial empresarial existente e capacidade do operador de administrar cada base conflitante. Não exibe URL/senha nem altera bancos ou privilégios. Código de saída 2 indica impedimentos conhecidos; 1 indica erro de entrada/conexão; 0 permite tentar o provisionamento, mas **não declara a empresa pronta**. Ainda serão obrigatórios identidade, migrações, isolamento efetivo, conciliação e ativação. A verificação é pontual; os diagnósticos posteriores continuam necessários se os privilégios mudarem.

`scripts/provision-tenant.mjs` executa essa mesma verificação antes da criação de qualquer banco/perfil. Falta de CREATEDB/CREATEROLE orienta o provisionamento manual; CONNECT externo interrompe a execução para revisão com o provedor. O comando está incluído na imagem Linux do operador e pode ser executado substituindo o entrypoint por `node`.

### Infraestrutura criada manualmente

Em **Empresas → Registrar etapa**, confira nome/UUID, registre a preparação ou o impedimento com justificativa e confirmação recente de identidade. As notas são auditadas e não declaram que um banco existe. O responsável pelo servidor precisa criar recursos reais com os nomes derivados do UUID descritos acima:

1. Proprietário NOLOGIN, sem SUPERUSER, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS.
2. Credencial LOGIN/NOINHERIT exclusiva, sem os privilégios elevados acima e sem associação a outros papéis. Configure a senha aleatória no armazenamento privado, nunca na anotação do painel.
3. Banco vazio UTF-8 criado a partir de template0, pertencente ao proprietário esperado. Retire todos os privilégios de PUBLIC nesse banco; conceda somente CONNECT à credencial empresarial, sem CREATE/TEMP. Resolva também o CONNECT a outras bases com o provedor.
4. Operador de migração com conexão ao banco e capacidade de SET ROLE para esse proprietário. Esse operador não precisa de CREATEDB/CREATEROLE e não é a credencial usada pelo ERP.

No ambiente privado Linux, configure `ERP_PROVISIONER_URL` e `ERP_TENANT_<UUID compacto maiúsculo>_URL`; execute:

```sh
node --experimental-strip-types scripts/provision-tenant.mjs <UUID-da-empresa> --existing
```

O modo `--existing` não cria bancos/perfis, não troca senhas e não corrige os privilégios do banco silenciosamente. Recusa recursos ausentes, proprietário incorreto, privilégios inseguros e banco ocupado sem identidade reconhecida. Usa trava de provisionamento e a mesma transação de migrações/checksums; falhas revertem a instalação, e a repetição preserva o que já foi instalado. A identidade e o isolamento são conferidos novamente com a credencial empresarial. O resultado permanece aguardando conciliação: nenhuma anotação ou retorno deste comando ativa a empresa.

Registre a etapa no painel e abra **Verificar banco**. Siga o fluxo existente de preparação/corte, conciliação e ativação pelo servidor. A execução com sessão real e infraestrutura de produção permanece pendente; o modo manual não contorna a restrição CONNECT encontrada no Supabase atual.

1. Obtenha o UUID da empresa já cadastrada no controle central.
2. Gere uma senha aleatória de 32 bytes ou mais, codificada em base64url. Preserve-a em um gerenciador de segredos. Não coloque a senha na linha de comando ou no Git.
3. No ambiente privado do operador, configure `ERP_PROVISIONER_URL` e `ERP_TENANT_<UUID SEM HÍFENS, MAIÚSCULO>_URL`. Esta última aponta para o banco `erp_<uuid sem hífens>` usando `erp_app_<uuid sem hífens>`. Para Supavisor, acrescente `.PROJECT_REF` ao usuário. URLs não aceitam parâmetros que alterem TLS. O proprietário sem login será `erp_owner_<uuid sem hífens>`.
4. Execute, com Node compatível com type stripping:

```powershell
node --experimental-strip-types scripts/provision-tenant.mjs UUID_DA_EMPRESA
```

O comando aplica o pacote de migrações, verifica a credencial restrita e informa as etapas pendentes. Não ativa a empresa, não copia dados automaticamente, não modifica a senha de uma credencial existente e não declara um banco vazio como ERP pronto. Guarde as mesmas credenciais para repetir após uma falha; rotação exige procedimento próprio.

Somente a URL restrita da empresa deve ir para os segredos do serviço web. Não use prefixo `NEXT_PUBLIC_` e não coloque `ERP_PROVISIONER_URL` no frontend ou no ambiente web. Valores de ambiente não são cadastrados pelo formulário administrativo.

## Migrações

O arquivo `002-operations.sql` foi derivado do núcleo transacional e dos controles de ação já revisados usando `node scripts/build-tenant-engine.mjs`. O gerador recusa dependências centrais residuais. Antes da primeira publicação é possível regenerá-lo; depois de aplicado, não altere uma migração existente: adicione migração incremental e atualize a lista do carregador. O checksum impede a alteração silenciosa de uma versão já aplicada.

O importador legado, a conciliação e o worker de corte estão implementados e testados. O cadastro central e o cliente operacional estão integrados à nova API no branch em revisão, e o backup/restauração foi testado localmente. A integração dos arquivos e a importação por pacote foram acrescentadas posteriormente. Ainda faltam janela de exportação, configuração privada e validação autenticada/implantação de produção. **Não aplique o esquema operacional compartilhado na produção como substituto dessa migração.**

### Corte e conciliação (código em validação, sem execução em produção)

`db/tenant-cutover.sql` ainda não foi aplicado no controle central. A solicitação exige ADM com MFA recente, versão atual da empresa e justificativa. Ela muda a localização para `migrating`; os gatilhos esperam gravações em andamento e passam a negar alterações em empresas/produtos/lançamentos/movimentos legados. Outra empresa continua operando. A leitura direta dos dados operacionais legados também é bloqueada durante/depois do corte.

`importLegacyCompany` usa snapshot repetível na origem e uma transação no destino. Copia IDs, autores e datas sem conversão monetária para `Number`, importa somente o saldo atual como abertura e mantém movimentos anteriores como histórico. Compara contagens, saldos, títulos, pagamentos e SHA-256 dos registros. Uma falha reverte a cópia inteira; repetição verifica o estado anterior e recusa sobrescrever registros modificados.

`runTenantCutover` é um worker do operador, não uma rota web. Revalida autorização administrativa a cada etapa, incluindo sessão revogada, limite de duração e MFA removido; verifica credencial restrita, identidade e checksums antes da cópia. O despacho operacional permanece bloqueado até `operational_state=active`. A ativação central exige conciliação e é auditada. Uma resposta perdida depois do commit não desfaz a ativação; uma falha anterior mantém a origem bloqueada e permite repetição com nova autorização.

Limites explícitos: dados operacionais v2 já existentes na base compartilhada são recusados, pois exigem migrador próprio; produtos com fotos sem pacote verificado também impedem a conciliação. O worker copia fotos de uma exportação local revisada conforme `TENANT-ASSETS.md`. Não execute corte real antes de validar a interrupção de gravações/exportação do Storage, recuperação com bytes e configuração de produção.

### Acompanhamento e execução manual

Em **Empresas → Verificar banco**, o ADM vê a empresa/UUID, o diagnóstico e a solicitação de migração. A autorização exige confirmação explícita da interrupção de alterações, justificativa, versão atual e MFA recente. A consulta de andamento exige ADM/AAL2 e gera auditoria; nunca retorna sessão, token ou credenciais do operador. **Atualizar acompanhamento** consulta o estado real: aguardando operador, copiando/conferindo, conferido, ativo ou falha. Não existe marcação manual de banco pronto.

O operador executa o comando abaixo em ambiente privado após configurar `ERP_CONTROL_OPERATOR_URL`, `ERP_CONTROL_CA` quando necessário, `ERP_PROVISIONER_URL`, `ERP_TENANT_CA` quando necessário e a URL restrita `ERP_TENANT_<UUID SEM HÍFENS, MAIÚSCULO>_URL`. A conexão de manutenção usa o banco derivado da empresa da solicitação central, nunca um nome passado pelo navegador. Todas as conexões validam TLS. Fotos exigem `ERP_LEGACY_PHOTO_MANIFEST`.

```powershell
node --experimental-strip-types scripts/cutover-tenant.mjs UUID_DA_SOLICITACAO
```

O comando copia, concilia e ativa apenas quando as verificações passam. Uma falha mantém a origem congelada; confira a causa, renove a autorização com MFA se necessário e repita o mesmo UUID. A UI acompanha as contagens e o estado do job. Esses comandos e o novo acompanhamento foram validados localmente; `tenant-cutover.sql` ainda não está instalado no Supabase central.

## Testes locais

`tests/tenant-identity.test.mjs` não precisa de banco. `tests/tenant-database.test.mjs` usa um cluster PostgreSQL descartável em `127.0.0.1:55439`, usuário `erp_test_admin`, com senha lida de `work/pg-test-password`. Não aceita URL de produção e limpa apenas os bancos/perfis de UUIDs criados pela própria execução. Não aponta para um cluster de trabalho: ele altera os defaults de conexão de `postgres` e `template1` no cluster de testes.

```powershell
node --experimental-strip-types tests/tenant-identity.test.mjs
node --experimental-strip-types tests/tenant-database.test.mjs
node --experimental-strip-types tests/tenant-import.test.mjs
node --experimental-strip-types tests/tenant-import.test.mjs --photos
node --experimental-strip-types tests/tenant-cutover.test.mjs
node --experimental-strip-types tests/legacy-photo-bundle.test.mjs
node --experimental-strip-types tests/operator-connection.test.mjs
node --experimental-strip-types tests/cutover-routes.test.mjs
```

`tests/tenant-routing.sql` executa com `BEGIN/ROLLBACK` no controle central para verificar vínculo, políticas atualizadas, troca de ID e sessão revogada. O teste não substitui autenticação completa no navegador.

`tests/tenant-import.test.mjs` verifica concorrência no congelamento, precisão decimal além de `Number`, datas/autores preservados, histórico sem reaplicação, arquivados sem receita e rollback. `tests/tenant-cutover.test.mjs` carrega o controle SQL real em um cluster descartável e executa o worker completo, incluindo consulta no banco ativado, revogação/MFA, falhas de transporte antes/depois do commit e isolamento da segunda empresa. As tabelas Auth desse ensaio são fixtures; assinatura JWT/login são verificados separadamente nas rotas e ainda precisam de teste autenticado no navegador.

## Backup e restauração

O núcleo em `lib/server/tenant-backup.ts` cria dumps reais criptografados, verifica integridade e ensaia recuperação em banco temporário isolado. `tests/tenant-backup.test.mjs` comprovou a recuperação dos dados e rotinas, preservação da segunda empresa, recusa de adulterações e repetição por ID sem duplicar o artefato.

A tabela administrativa está ligada ao mecanismo pelo worker privado e pelo painel de solicitações. Restauração sobre banco existente, cópia anterior, bloqueio operacional, MFA e auditoria central foram testados localmente. Agendamento, aplicação da retenção, arquivos externos e execução de produção permanecem pendentes. Não efetuar corte real até concluir esse fluxo. Consulte `BACKUP-RESTORE.md` para configuração, garantias e limites atuais.

## Cadastro empresarial e equipe

Consulte `COMPANY-WORKSPACE.md` para autorização, versão/idempotência, testes e ordem de implantação das RPCs centrais. O navegador não grava diretamente em `business_units` após essa migração.

## Arquivos empresariais

A migração `006-assets` adiciona conteúdo binário limitado ao banco exclusivo. A API e a interface já usam esse armazenamento no branch. O importador aceita uma exportação local revisada de fotos antigas; a janela real do Storage permanece pendente. O ensaio nativo de recuperação de PNG/3MF passou em 26/09. Consulte `TENANT-ASSETS.md` antes do corte.
