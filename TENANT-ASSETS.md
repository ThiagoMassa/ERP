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

O dump nativo inclui todo o esquema `tenant`, portanto inclui metadados e conteúdo de `tenant.assets`. A verificação compara conteúdo e rotinas. O teste de backup foi ampliado para conferir os bytes restaurados e a preservação de arquivos de outra empresa, mas **essa ampliação ainda não passou**: em 21/09 o Windows Smart App Control bloqueou `libpq.dll` para `pg_dump`, `pg_restore` e `psql`, antes da execução do dump (evento CodeIntegrity 3077; saída `0xc0e90002`). Não desativar proteção para contornar o bloqueio. Executar o ensaio em ambiente de homologação aprovado com utilitários PostgreSQL suportados antes da publicação.

Fotos existentes no Supabase Storage ainda precisam de cópia autorizada, preservação de referências, reconciliação de bytes e bloqueio de escrita durante o corte. O importador continua recusando referências sem arquivo verificado. Nenhum arquivo de produção foi movido nesta etapa; não ativar empresas com fotos legadas até concluir esse migrador.

## Evidências e limites

`npm run test:assets` passa com quatro testes: conteúdo/limites; handlers HTTP reais com serviço de despacho simulado; transporte do cliente com rede simulada; armazenamento/permissões com dois bancos PostgreSQL reais descartáveis. O teste PostgreSQL verifica autoria, bloqueios, manutenção, referência, tamanho, repetição, leitura entre colegas e negação entre empresas. O teste HTTP não substitui sessão real Supabase.

Também passaram os testes de motor operacional, importação sem arquivos e cadastro central após a nova migração, além de TypeScript, lint direcionado e build. A foto foi carregada no componente real e descartada na troca de empresa em uma prévia com respostas fictícias; não houve acesso a arquivos de produção. Recuperação com bytes, migração legada, expurgo/retensão de envios órfãos e fluxo autenticado completo continuam pendentes.
