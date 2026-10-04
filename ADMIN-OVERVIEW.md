# Indicadores e alertas globais

O painel mostra o total de empresas cadastradas, ativas e suspensas, e o total de identidades. Os usuários são classificados em grupos exclusivos, nesta ordem: bloqueio global ou banimento vigente no Auth; suspensão; e-mail pendente de confirmação; ativo com e-mail confirmado. A soma dos quatro grupos corresponde ao total. Estes indicadores não concedem acesso a empresas nem substituem suas permissões.

Os indicadores são globais mesmo quando uma empresa está selecionada; a tela explicita esse alcance. O painel conserva as últimas ações administrativas e mostra até dez itens por grupo: empresas atualmente com provisionamento falho, manutenções em estado de falha e eventos centrais negados/falhos nas últimas 24 horas. Os grupos não constituem um monitor externo de disponibilidade. Ausência de registros não comprova ausência de incidentes; integração completa de logins e falhas de autenticação permanece pendente.

`db/admin-overview.sql` adiciona um leitor privado autorizado pelo leitor ADM existente e encaminha somente a seção overview da RPC pública. As demais seções, inclusive o diretório empresarial ampliado, são preservadas. O resumo de alertas omite justificativas privadas, detalhes do driver, credenciais, artefatos e valores antes/depois; a auditoria detalhada mantém sua interface autorizada própria.

Os testes SQL incluem contas com banimento, suspensão, bloqueio e confirmação pendente, conciliação das contagens, falhas de provisionamento/manutenção, correlação do evento e ausência de detalhes privados nos alertas. A [execução Linux 37196468985](https://github.com/ThiagoMassa/ERP/actions/runs/37196468985), commit `43683ddc6a704ee9fa8b4dcb9492e04bd5814cc5`, passou esses cenários e as regressões de provisionamento, manutenção e recuperação. Build, TypeScript e lint locais aprovados.

Instalado no Supabase central pela migração `20261004104831_admin_overview_metrics_alerts`. Privilégios e recusa sem sessão conferidos após aplicação; advisor sem novos avisos. Preservar a fonte SQL instalada e usar migração incremental para alterações. Publicação do frontend e validação autenticada no navegador continuam pendentes.
