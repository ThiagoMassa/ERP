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

A documentação oficial confirma que [Supabase/Supavisor aceita bancos distintos e usuários próprios](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI#what-is-the-userdbmode-combination). Auth, Storage e a API REST continuam no banco central; as consultas operacionais usam PostgreSQL pelo servidor da aplicação.

Use uma conexão de manutenção com `CREATEDB`, `CREATEROLE` e capacidade de assumir o proprietário do banco. Use sessão direta ou pooler de sessão para provisionar; `CREATE DATABASE` não pode executar dentro de transação. Essa conexão **não deve existir no serviço web**. O usuário operacional não recebe criação de banco/perfis, superusuário, replicação, `BYPASSRLS`, associação a outros perfis ou acesso direto às tabelas.

Antes de instalar em um servidor compartilhado, inventarie os privilégios `CONNECT` das outras bases. O PostgreSQL concede `CONNECT` a `PUBLIC` por padrão; conceder acesso exclusivo na base A não retira automaticamente o acesso concedido por `PUBLIC` na base central. O diagnóstico recusa uma credencial que possa conectar a outra base. Não retire privilégios de bases Supabase automaticamente: preserve os perfis internos necessários e valide o inventário, ou use um servidor operacional separado. Os testes revogam os defaults somente no cluster local descartável.

TLS com validação de certificado é obrigatório. Para uma autoridade privada, configure `ERP_TENANT_CA` com o certificado da autoridade confiável. Nunca use `rejectUnauthorized=false`. O desvio de TLS existe apenas como argumento explícito dos testes e aceita somente loopback literal; nenhuma rota web o utiliza.

## Provisionamento pelo operador

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

O importador legado, a conciliação e o worker de corte estão implementados e testados. Ainda faltam o registro/migração autorizada de arquivos, backup/restauração e a integração dos cadastros empresariais/vínculos e do cliente operacional à nova API. **Não aplique o esquema operacional compartilhado na produção como substituto dessa migração.**

### Corte e conciliação (código em validação, sem execução em produção)

`db/tenant-cutover.sql` ainda não foi aplicado no controle central. A solicitação exige ADM com MFA recente, versão atual da empresa e justificativa. Ela muda a localização para `migrating`; os gatilhos esperam gravações em andamento e passam a negar alterações em empresas/produtos/lançamentos/movimentos legados. Outra empresa continua operando. A leitura direta dos dados operacionais legados também é bloqueada durante/depois do corte.

`importLegacyCompany` usa snapshot repetível na origem e uma transação no destino. Copia IDs, autores e datas sem conversão monetária para `Number`, importa somente o saldo atual como abertura e mantém movimentos anteriores como histórico. Compara contagens, saldos, títulos, pagamentos e SHA-256 dos registros. Uma falha reverte a cópia inteira; repetição verifica o estado anterior e recusa sobrescrever registros modificados.

`runTenantCutover` é um worker do operador, não uma rota web. Revalida autorização administrativa a cada etapa, incluindo sessão revogada, limite de duração e MFA removido; verifica credencial restrita, identidade e checksums antes da cópia. O despacho operacional permanece bloqueado até `operational_state=active`. A ativação central exige conciliação e é auditada. Uma resposta perdida depois do commit não desfaz a ativação; uma falha anterior mantém a origem bloqueada e permite repetição com nova autorização.

Limites explícitos: dados operacionais v2 já existentes na base compartilhada são recusados, pois exigem migrador próprio; produtos com fotos sem manifesto verificado também impedem a conciliação. Arquivos não são copiados por este worker. Não há botão/CLI de corte liberado nesta etapa. Não execute corte real antes de concluir arquivos, recuperação, interface e configuração de produção.

## Testes locais

`tests/tenant-identity.test.mjs` não precisa de banco. `tests/tenant-database.test.mjs` usa um cluster PostgreSQL descartável em `127.0.0.1:55439`, usuário `erp_test_admin`, com senha lida de `work/pg-test-password`. Não aceita URL de produção e limpa apenas os bancos/perfis de UUIDs criados pela própria execução. Não aponta para um cluster de trabalho: ele altera os defaults de conexão de `postgres` e `template1` no cluster de testes.

```powershell
node --experimental-strip-types tests/tenant-identity.test.mjs
node --experimental-strip-types tests/tenant-database.test.mjs
node --experimental-strip-types tests/tenant-import.test.mjs
node --experimental-strip-types tests/tenant-cutover.test.mjs
```

`tests/tenant-routing.sql` executa com `BEGIN/ROLLBACK` no controle central para verificar vínculo, políticas atualizadas, troca de ID e sessão revogada. O teste não substitui autenticação completa no navegador.

`tests/tenant-import.test.mjs` verifica concorrência no congelamento, precisão decimal além de `Number`, datas/autores preservados, histórico sem reaplicação, arquivados sem receita e rollback. `tests/tenant-cutover.test.mjs` carrega o controle SQL real em um cluster descartável e executa o worker completo, incluindo consulta no banco ativado, revogação/MFA, falhas de transporte antes/depois do commit e isolamento da segunda empresa. As tabelas Auth desse ensaio são fixtures; assinatura JWT/login são verificados separadamente nas rotas e ainda precisam de teste autenticado no navegador.

## Backup e restauração

Ainda não há mecanismo implementado de backup, retenção ou restauração por empresa. A tabela administrativa registra estados, mas não é um backup. Não efetuar o corte dos dados reais até implementar e testar cópia consistente, checksum, recuperação em banco isolado, cópia de segurança anterior à restauração, bloqueio de operações e reautenticação administrativa. A restauração deverá ser comprovada com duas empresas, sem alterar a segunda.
