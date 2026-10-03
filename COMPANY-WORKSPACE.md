# Cadastro empresarial e API exclusiva

Código no branch de revisão; ainda não publicado. O cadastro de empresas, os vínculos e as permissões permanecem no Supabase central. Produtos, pedidos, finanças, estoque e produção são consultados no banco exclusivo da empresa pelo servidor.

## Comportamento

- Cada requisição usa o token atual; o servidor verifica usuário e sessão central. A conexão é resolvida pelo UUID autorizado, sem aceitar URL de banco fornecida pelo cliente.
- Criar negócio registra uma empresa pendente e seu proprietário. Nenhuma base vazia é declarada pronta. A preparação, migração e conciliação são etapas separadas.
- Adicionar pessoa exige conta já cadastrada, administrador da empresa e permissão central de criação/edição. A pessoa compartilha o banco existente. A alteração do próprio perfil ou do proprietário é reservada ao ADM global.
- Mudanças de cadastro exigem versão atual e chave de idempotência. Uma repetição revalida sessão/permissão; reutilizar a chave com outro conteúdo é recusado. Antes/depois e autor ficam na auditoria central.
- Arquivar preserva os dados e impede operação; restaurar reabre o contexto autorizado. Suspensão global continua prevalecendo.
- Alterar nome/contato/nicho após migração modifica somente o cadastro central. O registro operacional original permanece preservado, e as tabelas operacionais legadas continuam congeladas.
- A interface limpa os dados ao trocar empresa ou conta, ignora respostas de detalhes antigas e informa quando o banco está em preparação. Havendo várias empresas, exige seleção explícita.

## Instalação coordenada

**Não aplicar isoladamente na versão pública atual.** `company-workspace.sql` retira os grants de gravação/leitura direta de `public.business_units`; o cliente legado depende deles. O cliente novo também depende das novas RPCs centrais e dos bancos exclusivos prontos para operar.

1. Concluir as pendências de arquivos/recuperação e preparar ambiente privado, credenciais e procedimento de corte conforme `TENANT-DATABASES.md`, `BACKUP-RESTORE.md` e `STATUS-IMPLEMENTACAO.md`.
2. Em ambiente de homologação, partir das migrações centrais já aplicadas (`admin-control`, validação de políticas, `tenant-routing`, matriz de permissões e `tenant-backup-control`). Aplicar `tenant-cutover.sql` antes de `company-workspace.sql`.
3. Publicar a revisão correspondente e verificar login, permissões, cadastro/vínculos e todos os fluxos com bancos exclusivos provisionados, conciliados e liberados pelo worker autorizado. A interface não usa o banco compartilhado como alternativa em caso de erro.
4. Planejar uma janela para a mudança de banco/cliente em produção. Não promover este branch enquanto houver pendências impeditivas no documento de estado. O SQL operacional compartilhado não substitui essa migração.
5. Verificar que clientes antigos e chamadas diretas às tabelas não contornam políticas. Em incidente, manter dados protegidos e corrigir o serviço; voltar ao cliente antigo sem rever a migração não é um rollback válido.

Nenhuma dessas migrações novas de cadastro/corte foi executada em produção nesta etapa. Nenhuma empresa de produção foi declarada pronta.

## Validação

`npm run test:workspace` executa o teste do transporte e o ensaio PostgreSQL nativo. O segundo exige o cluster descartável local descrito em `TENANT-DATABASES.md`; nunca aponta para produção. Cobre criação/repetição, negações atuais, membros em duas empresas, conflitos de versão, corte real, edição de metadados após corte, arquivo/restauração e preservação do estoque da outra empresa.

A interface real foi exercitada com API simulada e três empresas fictícias. A validação de sessão real pela API HTTP, MFA do titular e publicação continua pendente. Uploads/fotos/3MF ainda dependem da conclusão do registro/migração de arquivos; não liberar a arquitetura exclusiva com esses fluxos incompletos.
