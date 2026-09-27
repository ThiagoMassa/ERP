# Consulta administrativa de registros — base em desenvolvimento

`POST /api/admin/records` recebe empresa UUID, operação permitida e filtros restritos. Não recebe conexão, credencial, contexto de autorização, comandos ou opção de exportação. O executor usa a sessão validada para solicitar `erp_admin_record_context`, que exige ADM ativo/AAL2 e banco pronto. A ausência de vínculo empresarial não impede uma inspeção explicitamente administrativa. Empresa suspensa continua inspecionável; banco em preparação/manutenção permanece indisponível.

A conexão é resolvida no servidor pelo identificador da empresa e passa pela mesma validação de identidade, migrações, privilégios restritos e geração de acesso usada no ERP. O contexto dura 25 segundos e concede apenas leitura. O endpoint comum não permite selecionar esse escopo. A função central registra `records.authorize.read`, com ator, empresa, tipo de consulta e correlação; esse evento comprova autorização, não a conclusão da leitura no banco empresarial.

Operações iniciais: produtos, parceiros, pedidos/detalhes, títulos/detalhes, estoque, movimentações, produção, bobinas, impressoras e receitas de produção. Usa as consultas existentes do motor. Filtros iniciais: busca, ID, página, tamanho limitado a 50 e tipo de pedido. Não há promessa de busca por autor/período nesta etapa.

## Instalação e pendências

`db/admin-records.sql` depende dos módulos centrais `admin-control` e `tenant-backup-control`. É novo e não foi aplicado em produção; registrar migração incremental própria após homologação. Não torna nenhum banco pronto nem altera dados operacionais.

Faltam a tela administrativa com identificação permanente da empresa, filtros por autor/período, detalhes completos, auditoria da conclusão/falha correlacionada entre bancos e correções transacionais com justificativa e autoria original preservada. Também falta a verificação ponta a ponta com identidade real e banco empresarial provisionado. Essa fundação não conclui o item 9 do script.

`npm run test:admin-records`: SQL real em PostgreSQL local descartável testa ADM inativo, AAL1, sessão revogada, empresa suspensa, manutenção, ausência de vínculo, privilégios e escopo somente leitura. Handler HTTP usa executor simulado e verifica rejeição de alteração/exportação/conexão arbitrária. Os testes não afirmam concluir o fluxo autenticado completo.
