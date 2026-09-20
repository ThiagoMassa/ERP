# Verificação — 20/09/2026

## Código e banco

- Build de produção Next.js/webpack e TypeScript aprovados. Lint direcionado aos arquivos alterados aprovado; isso não significa que toda a dívida de lint histórica foi resolvida.
- Testes de domínio: períodos financeiros, moedas, precificação, validação de margens, sugestões e ofertas.
- Testes de geometria: sólidos, corte com conservação de volume e faces fechadas, malhas/dimensões inválidas, suavização, roundtrip 3MF, componentes/transformações, unidades e referências cíclicas.
- Testes de permissões da interface: negação por padrão, precedência de bloqueio, exportação e mapeamento de ações.
- PostgreSQL 17.11 local: bancos e credenciais exclusivos, conexão cruzada negada, tabelas/núcleos privados, rollback de migração, checksums e repetição sem duplicação. Motor real exercitado com estoque, venda, pagamentos parciais, estornos e produção 3D.
- Importador: origem bloqueada aguarda transação concorrente; outra empresa continua operando; decimais além da precisão de Number preservados; IDs, autores e datas mantidos; movimentos históricos não reaplicados; registros arquivados não geram receita. Conciliação, repetição, recusa de origem alterada e rollback integral aprovados.
- Worker de corte: controle SQL real em bancos locais descartáveis; sessão revogada/MFA removido negados; cópia, ativação e consulta pelo contexto central aprovadas; falhas antes/depois do commit recuperáveis sem reabrir o legado ou duplicar dados. Segunda empresa preservada. As tabelas Auth nesse ensaio são fixtures, não um login Supabase real.
- Backup: pg_dump/pg_restore nativos, AES-256-GCM, manifesto autenticado, prazo de retenção, repetição pelo ID, recuperação integral em banco temporário e comparação das tabelas/funções aprovados. A outra empresa permaneceu intacta. Chave incorreta, troca de empresa, manifesto/arquivo adulterados e excesso de tamanho foram recusados; arquivos parciais e banco temporário foram removidos.
- Supabase central, dentro de BEGIN/ROLLBACK: controle administrativo, políticas, roteamento de contexto, corte legado e matriz de permissões aprovados. A matriz foi verificada novamente depois de instalada. Dados de teste não permanecem no banco.

- Restauração em PostgreSQL real: cópia de segurança, comparação antes do commit e falha durante recriação dos esquemas com rollback integral aprovados. Contextos antigos recusados após restauração. Worker central retoma falhas antes/depois da conclusão sem repetir a sobrescrita; autoria original e outra empresa preservadas.

## Interface

- Login ADM inspecionado em revisão anterior, com tema vermelho e identificação permanente.
- Matriz de permissões exercitada em navegador com o componente real e respostas fictícias isoladas: seleção de usuário, detalhe de decisão, preparação de regra individual, vínculo suspenso com 80 decisões negadas e limpeza ao alterar a busca.
- Inspeção visual da matriz em desktop e largura de 390 px; rolagem horizontal da tabela preserva a coluna do módulo. Corrigida a fonte de fallback e traduzida a origem dos perfis.
- Esse ensaio não substitui o fluxo autenticado com MFA nem confirma salvamento de regras em produção. Não houve alteração de acesso por essa prévia.

- Tela de backups: componente real com respostas fictícias, desktop/390 px, revisão de impacto, envio bloqueado sem confirmação, solicitação exibida em andamento e filtro vazio. Sem excesso de largura na página; tabela rola horizontalmente. Isso não exercita MFA nem servidor real.

## Estado externo e limites

- Aplicados no Supabase: controle administrativo, validação incremental das políticas, contexto empresarial por requisição e matriz administrativa de permissões e controle de manutenção/backup.
- Controle de manutenção: teste central com rollback após instalação aprovado; usuário comum, MFA antigo, prontidão falsa, confirmação incorreta, concorrência e execução privada pelo cliente recusados. Consulta posterior: zero jobs e backups.
- db/tenant-cutover.sql foi testado com rollback, mas **não aplicado**. O importador/worker e o novo cliente não foram liberados em produção.
- Última consulta: zero empresas prontas e zero fatores MFA verificados na conta ADM inicial.
- Nenhum backup ou restauração **de produção** realizado. Integração controle/API/painel/operador e restauração sobre banco existente passaram nos testes locais; ainda faltam agendamento, retenção automática, arquivos externos e configuração/execução de produção. Nenhum banco empresarial de produção criado/ativado.
- Frontend operacional ainda usa a RPC compartilhada; adaptar à API de bancos exclusivos é obrigatório antes da publicação desta revisão.
- Fotos/3MF dependem de migração/registro de arquivos; o importador recusa referências de foto não verificadas. Origem com operações v2 exige migrador próprio.
- Testes 3D estruturais não substituem abertura real no Bambu Studio. O modelo A2 segue manual/não verificado.
- Resend, Google OAuth e SerpApi continuam sem credenciais por decisão do titular.
- Advisor: oito avisos informativos de RLS sem políticas nas tabelas privadas, intencionalmente fechadas, e aviso preexistente de proteção contra senhas vazadas desativada.

O PR permanece em desenvolvimento. A versão pública da Railway não equivale ao código local desta revisão. Consulte STATUS-IMPLEMENTACAO.md para as pendências completas.
