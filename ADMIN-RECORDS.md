# Consulta administrativa de registros — base em desenvolvimento

## Correção cadastral de produtos — 01/10/2026

Na consulta de produtos, **Ver campos → Corrigir dados cadastrais** permite revisar nome, descrição, categoria, SKU, fornecedor descritivo e localização descritiva. A tela mostra antes/depois e justificativa antes da confirmação, mantém o nome da empresa e oferece reautenticação. Não altera valores, estoque, documentos, tipo/unidade nem autoria original.

`PATCH /api/admin/records` aceita somente esse comando, campos permitidos, versão e UUID de repetição. O servidor valida a sessão e solicita `erp_admin_correction_context`, que exige ADM ativo com MFA confirmado nos últimos cinco minutos. O endpoint comum não pode escolher o escopo administrativo. Ausência de migração, banco não pronto, identidade ou geração de acesso divergente bloqueiam a operação.

`007-admin-corrections.sql` adiciona versão de produto incrementada também pelas edições comuns, trava de registro, cache de repetição autorizado e transação única para cadastro e auditoria. Conflitos respondem 409. A repetição revalida a autorização antes de consultar o resultado anterior. A auditoria empresarial preserva antes/depois, justificativa, ADM real, autor original e correlação. O evento central `records.authorize.correct` registra a autorização, não comprova a conclusão da gravação; a auditoria final permanece no banco empresarial.

Instalação pendente: registrar/aplicar `db/admin-corrections.sql` no controle central, instalar a migração 007 em cada banco e publicar o servidor/frontend juntos. Nada foi aplicado em produção. A validação local cobre SQL central com identidades/MFA de teste, duas bases empresariais reais, concorrência, rollback de falha na auditoria, idempotência, autoria e preservação de valores. Handler e componente usam rede simulada. Ainda falta o ensaio completo com sessão real e consulta integrada da auditoria empresarial.

`POST /api/admin/records` recebe empresa UUID, operação permitida e filtros restritos. Não recebe conexão, credencial, contexto de autorização, comandos ou opção de exportação. O executor usa a sessão validada para solicitar `erp_admin_record_context`, que exige ADM ativo/AAL2 e banco pronto. A ausência de vínculo empresarial não impede uma inspeção explicitamente administrativa. Empresa suspensa continua inspecionável; banco em preparação/manutenção permanece indisponível.

A conexão é resolvida no servidor pelo identificador da empresa e passa pela mesma validação de identidade, migrações, privilégios restritos e geração de acesso usada no ERP. O contexto dura 25 segundos e concede apenas leitura. O endpoint comum não permite selecionar esse escopo. A função central registra `records.authorize.read`, com ator, empresa, tipo de consulta e correlação; esse evento comprova autorização, não a conclusão da leitura no banco empresarial.

Operações iniciais: produtos, parceiros, pedidos/detalhes, títulos/detalhes, estoque, movimentações, produção, bobinas, impressoras e receitas de produção. Usa as consultas existentes do motor. Filtros iniciais: busca, ID, página, tamanho limitado a 50 e tipo de pedido. Não há promessa de busca por autor/período nesta etapa.

## Instalação e pendências

`db/admin-records.sql` depende dos módulos centrais `admin-control` e `tenant-backup-control`. É novo e não foi aplicado em produção; registrar migração incremental própria após homologação. Não torna nenhum banco pronto nem altera dados operacionais.

A tela **Registros das empresas** mantém o contexto vermelho e a identificação da empresa, lista paginada, seleção do tipo e campos principais do registro. Mostra os filtros efetivamente aplicados e descarta seleção/resultados ao trocar empresa. Moeda e período são encaminhados ao motor; a tela explica que datas se aplicam a pedidos/títulos/movimentações e moeda a produtos/pedidos/títulos/saldos. O código da moeda não converte valores. Datas inválidas ou invertidas são recusadas.

Pedidos consultam detalhes por ID e mostram itens, atendimentos e títulos vinculados. Títulos mostram pagamentos, autores e informações de estorno disponíveis. As chamadas de detalhe exigem ID e a interface verifica ID/empresa da resposta. Fechar ou trocar empresa aborta a consulta; respostas antigas são descartadas. Campos são apresentados com rótulos, sem editor de SQL ou JSON.

Faltam filtros por autor e ID em todas as listas, período nos demais tipos, detalhamento das linhas de atendimento e relações de outros módulos, auditoria da conclusão/falha correlacionada entre bancos e correções transacionais com justificativa e autoria original preservada. Também falta a verificação ponta a ponta com identidade real e banco empresarial provisionado. Essa etapa não conclui o item 9 do script.

Revisão de navegador com componente real e API fictícia: primeira/segunda página, campos selecionados, troca de empresa com limpeza de seleção e estado vazio; sem erros de console observados. Não representa validação dos dados reais nem de MFA.

Teste adicional do componente em DOM simulado: consulta de detalhes de pedido/título, itens e pagamentos/estornos, cancelamento e descarte de resposta atrasada ao trocar empresa, resposta de outra empresa recusada. O teste usa o componente real com rede simulada; não é autenticação ponta a ponta.

`npm run test:admin-records`: SQL real em PostgreSQL local descartável testa ADM inativo, AAL1, sessão revogada, empresa suspensa, manutenção, ausência de vínculo, privilégios e escopo somente leitura. Handler HTTP usa executor simulado e verifica rejeição de alteração/exportação/conexão arbitrária. Os testes não afirmam concluir o fluxo autenticado completo.
