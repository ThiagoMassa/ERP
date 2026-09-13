# Verificação — 13/09/2026

## Aprovado

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit`.
- Build de produção: `node scripts/run-framework.mjs build` (cinco etapas concluídas).
- `tests/domain.test.mjs`: semana na virada do ano, fevereiro bissexto, intervalo inválido, série somente com realizados, fórmulas de mecânica e impressão 3D, divisões por zero, margem inválida, sugestões por nome, deduplicação/URLs/moedas das ofertas e precisão KWD/JPY.
- HTTP local: página 200 com módulos presentes; configuração informa Google e marketplace pendentes; marketplace retorna 503/NOT_CONFIGURED sem credenciais e 400 para entrada inválida; e-mail exige autenticação.
- Supabase com transação revertida: saldo fracionado, geração de histórico, bloqueio de saldo negativo, bloqueio de referência entre moedas e isolamento de leitura/escrita entre dois usuários. Nenhum dado de teste permaneceu no banco.
- Migrações aplicadas: expansão do catálogo/estoque/fotos, negócios múltiplos/lixeira/moedas, precisão monetária.

## Pendências de validação

- O navegador automatizado não estava disponível (`apps: [], browsers: []`; abertura de iab retornou indisponível). A nova interface, o upload de foto e o fluxo de edição/restauração não foram exercitados visualmente nesta revisão. O teste HTTP não substitui o teste de interação.
- Google OAuth, SerpApi e Resend aguardam credenciais por decisão do usuário; não houve login Google, consulta externa paga ou envio real de e-mail.
- ESLint não passou: predominam anotações `any`, avisos de dependências e regras de estado em efeitos, além de importações não usadas. Isso é dívida de qualidade do código; TypeScript e build passaram. As regras não foram desativadas para ocultar os achados.
- O build avisa que um pacote JavaScript excede 500 kB; há espaço para carregar módulos sob demanda.
- O advisor do Supabase apontou proteção contra senhas vazadas desativada. Revisar a disponibilidade e configuração no painel antes da abertura pública: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

A publicação externa permanece pendente. Os arquivos atualizados e o ZIP são entregues no workspace.

## Atualização de acesso e hospedagem

- Prévia reiniciada, HTTP 200, tela inicial confirmada visualmente e hidratação confirmada pela lista de moedas e gráfico. Os fluxos completos de upload/edição/restauração continuam sem teste nesta revisão.
- Build com nome de Worker `fluxo-erp` aprovado.
- Simulação local de deploy do Wrangler foi bloqueada por acesso negado ao percorrer diretórios no Windows; não houve publicação na Cloudflare. O arquivo dist/server/index.js existe.
- Git local continua sem conseguir criar `.git/index.lock`, mesmo após a concessão solicitada. Nenhum envio pelo Git local foi concluído.
- Adicionados comando `deploy:cloudflare`, iniciador local e guia DEPLOYMENT.md.

## Estúdio 3D e execução Node

Build Next.js/webpack e TypeScript aprovados. Testes de geometria aprovados: sólidos paramétricos, corte com conservação de volume e faces fechadas, rejeição de malha aberta, suavização, roundtrip 3MF, componentes externos, transformação, conversão de unidades e ciclos inválidos. No navegador: geração de caixa, split em duas partes e comparação da suavização aprovados. Arquivos não foram abertos no aplicativo Bambu Studio instalado; a compatibilidade validada é do pacote 3MF Core e das geometrias. Perfis e configurações proprietárias não são exportados.
