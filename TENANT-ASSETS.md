# Fotos e 3MF por empresa

## Armazenamento

A migração incremental `db/tenant/006-assets.sql` guarda o conteúdo binário em `tenant.assets`, no próprio banco exclusivo. O registro contém tamanho e SHA-256 gerados pelo PostgreSQL, nome original, formato, autor e data. `tenant.uploads` preserva a compatibilidade dos vínculos operacionais. As tabelas têm RLS e não recebem acesso direto pelo usuário de execução.

Essa escolha mantém arquivos pequenos e seus registros no mesmo snapshot e na mesma transação de restauração. Fotos aceitam PNG/JPEG/WebP até 5 MiB e modelos aceitam 3MF até 25 MiB. Os limites evitam tratar o banco como repositório de arquivos arbitrariamente grandes. Planejar capacidade/WAL/backup conforme o volume de anexos; o backup segue limitado a 2 GiB por padrão. A comparação do backup lê uma linha de arquivo por vez para não acumular centenas de conteúdos grandes na aplicação.

## API e interface

- `POST /api/erp/files`: token Bearer; UUID explícito da empresa; tipo de arquivo; nome; chave de repetição; produto opcional para troca de foto. O corpo é binário e limitado durante a leitura. A API verifica sessão/política antes de receber os bytes e revalida o contexto empresarial antes de gravar.
- `GET /api/erp/files`: mesma autorização, empresa, tipo e caminho. Exige vínculo com produto/registro 3MF da empresa. Modelos exigem também permissão de exportar. A resposta é privada, sem cache, com `nosniff`, disposição de anexo e integridade conferida antes da entrega.
- A API JSON genérica recusa operações `asset.*`, para impedir desvio da validação de tamanho/formato do endpoint dedicado.
- Fotos usam assinatura de formato; a interface também decodifica a imagem antes de enviar. O servidor valida o pacote ZIP/XML do 3MF, limita expansão a 80 MiB/2.000 entradas e recusa caminhos inválidos, duplicados, XML malformado e entidades. Isso não certifica a geometria ou o resultado de impressão: essa validação pertence ao estúdio/fatiador.
- Produto e arquivo 3MF só podem referenciar bytes existentes no banco correto. Tamanho divergente e referência forjada são rejeitados por gatilhos.
- Conteúdos são imutáveis pela API. Trocar/remover a foto altera a referência do produto; não apaga versões históricas. Uma falha na gravação do produto pode deixar um envio sem referência; esse conteúdo não pode ser baixado pela API. Não remover automaticamente após resposta incerta, pois a gravação pode ter sido confirmada.
- Reenviar o mesmo objeto de arquivo, na mesma conta/empresa/produto, reutiliza a chave de envio. Outra conta ou empresa recebe outra chave. O servidor verifica a permissão atual mesmo nas repetições.
- A interface descarta respostas após mudança de contexto e revoga URLs temporárias de fotos ao desmontar o componente.

## Migração e backup

Não aplicar esta migração no Supabase central. O provisionador carrega `006-assets` depois de `005-access-epoch` em cada banco exclusivo. Não altere versões já instaladas para aplicar a mudança.

O dump nativo inclui todo o esquema `tenant`, portanto inclui metadados e conteúdo de `tenant.assets`. Em 26/09 passou o ensaio com PNG e pacote 3MF: os bytes foram alterados no banco de teste após o backup e restaurados exatamente, com referências/tamanhos corretos e arquivos da outra empresa preservados. O teste também comprovou rollback após falha dentro da restauração, cópia anterior verificada, comparação antes do commit e repetição sem sobrescrita. O bloqueio de `libpq.dll` observado no Windows em 21/09 não se repetiu em 26/09; os executáveis oficiais funcionaram sem alteração das proteções pelo agente. O ensaio foi local, sem restauração de produção.

Fotos antigas podem ser importadas de uma exportação local revisada pelo operador. A cópia preserva `image_path` e o autor original do produto; o arquivo recebe o ADM importador como autor da importação, sem inventar a autoria original do upload. O manifesto e os hashes entram na conciliação. Bytes, referências, saldos e auditoria são gravados na mesma transação. Repetições conferem novamente os arquivos locais e os dados no banco; renovar a autorização com outro ADM preserva o primeiro importador.

O pacote não comprova sozinho que uma exportação do Storage é atual. **A interrupção e drenagem das gravações do Storage ainda são uma etapa operacional externa**, incluindo integrações com chaves privilegiadas. O comando bloqueia as referências no banco central, mas não interrompe o serviço Storage nem downloads/uploads em andamento. Nenhum arquivo de produção foi movido; não executar corte real sem essa janela e um backup da empresa verificado no ambiente de implantação.

### Preparação do pacote pelo operador

1. Prepare o banco exclusivo e um backup verificado. No painel ADM, selecione a empresa, abra **Verificar banco**, confirme a identidade e autorize a migração com justificativa. A solicitação congela alterações no ERP antigo; copie o UUID mostrado no acompanhamento.
2. Interrompa todas as gravações dos arquivos legados durante a janela, aguarde operações em andamento e exporte o bucket `product-photos` para uma pasta privada. Preserve as chaves originais como caminhos relativos: `PASTA_EXPORTADA/UUID_ORIGINAL/foto.png`. A exportação deve corresponder às referências congeladas da empresa. Não compartilhe a pasta nem a publique no Git.
3. Configure no ambiente privado `ERP_CONTROL_OPERATOR_URL`, opcionalmente `ERP_CONTROL_CA`, `ERP_LEGACY_PHOTO_EXPORT` (pasta exportada) e `ERP_LEGACY_PHOTO_BUNDLE` (nova pasta, fora da exportação e ainda inexistente). Execute:

```powershell
node --experimental-strip-types scripts/prepare-legacy-photos.mjs UUID_DA_SOLICITACAO
```

O comando lê somente fotos referenciadas pela empresa autorizada no job, limita cada arquivo a 5 MiB, verifica formato, recusa caminhos inadequados e links simbólicos, e escreve arquivos `SHA256.bin`. O `manifest.json` é escrito por último. Um diretório incompleto não pode ser importado; não é sobrescrito em uma repetição. Use outra pasta nova após corrigir o problema. A pasta deve ter acesso restrito ao operador: não há criptografia automática desse pacote temporário.

4. Revise o inventário gerado e a exportação antes do corte. O manifesto versão 1 contém `company` e `photos`, com `name`, `filename`, `mime`, `size_bytes` e `sha256`. Aceita até 10.000 referências e 4 MiB de manifesto. Nomes nunca são usados como caminhos no leitor do pacote: os bytes são resolvidos pelo hash na mesma pasta.
5. Configure `ERP_LEGACY_PHOTO_MANIFEST` com o caminho absoluto do manifesto e execute o comando de corte descrito em `TENANT-DATABASES.md`. Se a autorização expirar, renove-a pelo painel com MFA; a solicitação conserva seu UUID. Não remova o pacote antes de verificar a ativação e preservar uma cópia conforme a política de backup.

O importador recusa fotos ausentes, excedentes, de outra empresa, adulteradas ou com formato/tamanho divergente. Fotos compartilhadas por vários produtos mantêm uma única referência. Destinos já ocupados são recusados. Dados operacionais v2 legados ainda exigem um migrador próprio.

## Evidências e limites

`npm run test:assets` passa com quatro testes: conteúdo/limites; handlers HTTP reais com serviço de despacho simulado; transporte do cliente com rede simulada; armazenamento/permissões com dois bancos PostgreSQL reais descartáveis. O teste PostgreSQL verifica autoria, bloqueios, manutenção, referência, tamanho, repetição, leitura entre colegas e negação entre empresas. O teste HTTP não substitui sessão real Supabase.

Em 26/09 também passaram preparação de pacote, importação com fotos em três bancos reais descartáveis, falha após inserir bytes com rollback integral, adulteração local/no destino, renovação por outro ADM e leitura da foto pela credencial restrita após ativação. Os testes HTTP usam Auth/RPC simulados; os testes SQL usam tabelas Auth de teste. TypeScript, lint direcionado e build passaram. O acompanhamento foi exercitado no navegador com dados fictícios e troca de empresa; a largura de 390 px não apresentou transbordamento horizontal pelo DOM.

Também passou o teste de manutenção com controle central real, MFA/revogação, recuperação de resposta perdida e geração de contexto. Janela/exportação do Storage real, expurgo/retenção de envios órfãos e fluxo autenticado completo continuam pendentes.
