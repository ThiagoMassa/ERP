# Fluxo ERP

ERP com múltiplos negócios por conta, Supabase Auth/PostgreSQL/Storage e interface em português, inglês e espanhol.

## Recursos

- **Meus negócios:** criar, editar, selecionar, excluir e restaurar negócios. O nome sugere modelos locais de impressão 3D, mecânica/manutenção, cozinha/produção, hospedagem, comércio ou serviços. A sugestão pode ser alterada; não usa IA nem busca externa.
- **Financeiro:** receitas, despesas, realizado/pendente, cliente/fornecedor, forma de pagamento, categoria, observações e vínculo com produto/quantidade. Gráfico e filtros por dia, semana, mês, ano e intervalo de até 10 anos; exportação CSV.
- **Produtos e serviços:** fotos JPG/PNG/WebP de até 5 MB, SKU, descrição, custo, venda, unidade, estoque mínimo, fornecedor e localização; edição e lixeira com restauração.
- **Estoque:** pronta entrega, matérias-primas e peças, filtros de disponibilidade/reposição, entradas e saídas fracionadas e histórico com saldo e motivo. Operação atômica no banco impede saldo negativo. Editar um produto não sobrescreve o saldo de estoque.
- **Precificação:** campos por atividade, composição do custo, despesas rateadas, taxas e margem. O preço calculado pode ser aplicado a um produto da moeda selecionada.
- **Marketplace:** busca de ofertas por texto, imagem, loja, preço máximo e ordenação. A integração Google Shopping/SerpApi está preparada; exige configuração. Sem credenciais, mostra o estado pendente e não apresenta preços fictícios.
- **Preferências:** moedas ISO 4217 disponíveis no navegador; português, inglês e espanhol. Preferências ficam neste navegador. Dados cadastrados pelo usuário não são traduzidos.

## Estúdio 3D para Bambu Studio

- Importação de 3MF Core com componentes, transformações e referências de modelos da extensão Production, incluindo caminhos de componentes utilizados em projetos Bambu.
- Gerador paramétrico de caixa organizadora, vaso cônico e bloco; dimensões e espessura ajustáveis.
- Visualização WebGL com rotação/zoom; corte por plano X/Y/Z com fechamento das faces pelo Manifold.
- Sugestão de suavização ao importar, comparação das dimensões, aplicação opcional e desfazer (oito alterações).
- Exportação 3MF da geometria de todas as partes ou somente da selecionada. As posições de montagem são preservadas: organize as partes na mesa no Bambu Studio.
- A1 mini (180 mm), A1/P1S/P2S (256 mm): verificação simples das dimensões contra volume nominal. A2 está listado como perfil manual não validado; sem dimensões inventadas.
- Roteiro de acabamento para bico 0,4 mm com sugestão de camada e uso de altura variável no Bambu Studio.

O estúdio processa arquivos localmente, sem enviar modelos a servidores. Salve o 3MF antes de sair/recarregar/trocar de módulo. O 3MF exportado **não preserva** pinturas, suportes, perfis proprietários, associações AMS nem G-code do original. É geometria para importar no Bambu Studio, não um projeto fatiado. Suavização não garante qualidade física e pode alterar encaixes. Malhas abertas devem ser reparadas no fatiador. Limites: arquivo 25 MB, conteúdo expandido 80 MB, 128 partes, entrada 150 mil triângulos e suavização até 90 mil; operações de geometria têm timeout de 30 segundos.

Referências: [3MF Core](https://github.com/3MFConsortium/spec_core), [Manifold](https://manifoldcad.org/docs/jsapi/classes/manifold.Manifold.html), [A1 mini](https://us.store.bambulab.com/products/a1-mini), [A1](https://us.store.bambulab.com/products/a1), [P1S](https://bambulab.com/en-us/p1p) e [P2S](https://blog.bambulab.com/the-icon-redefined-meet-the-p2s-a-completely-reengineered-version-of-the-ultra-productive-p1-series/).

## Moedas e cálculos

A moeda selecionada define novos registros e filtra catálogo, estoque e totais. Cada registro preserva sua moeda; trocar BRL para USD não converte nem renomeia valores existentes. Não há cotação ou conversão de câmbio. A lista vem de `Intl.supportedValuesOf('currency')`; formatação e precisão usam `Intl.NumberFormat`. O banco aceita quatro casas decimais.

- Caixa: receitas realizadas menos despesas realizadas. Pendências ficam em totais separados.
- Venda média: receitas realizadas vinculadas a produtos / respectivas quantidades vendidas.
- Margem bruta: (preço - custo) / preço.
- Preço sugerido: custo / (1 - taxas/100 - margem/100). Taxas + margem devem ser inferiores a 100%.
- Impressão 3D: peso do material/perdas, potência e duração, tarifa kWh, manutenção, acabamento, embalagem e aluguel/outras despesas rateados por horas de máquina.
- Mecânica/serviços: peças/materiais, horas de trabalho e rateio de aluguel, energia fixa e outras despesas por horas produtivas.
- Cozinha: custo do lote e perdas, rendimento, trabalho e custos fixos por unidade.
- Hospedagem: custos mensais / noites ocupadas, limpeza / duração da estadia e consumo por noite.
- Comércio: compra, frete, embalagem e custos mensais / vendas esperadas.

Os parâmetros iniciais são exemplos; devem ser ajustados aos custos reais. Lançamentos financeiros não baixam estoque automaticamente: registre a movimentação na aba Estoque.

## Conta e dados

Sem autenticação, a interface usa exemplos temporários reiniciados ao recarregar. Na conta, cada negócio tem seus registros separados. A migração preservou o negócio que já estava cadastrado.

Supabase na organização Phaxe Solutions, projeto `kbqzwdttqptttoceygkd`. Todas as tabelas de usuário têm RLS por proprietário; referências compostas impedem vincular registros de outra conta. Fotos ficam em bucket privado `product-photos`, com políticas por pasta do proprietário. Exclusões na interface usam lixeira; não apagam o histórico de estoque.

Para um novo banco, aplique nesta ordem:

1. `db/schema.sql`
2. `db/expansion.sql`
3. `db/business-units.sql`
4. `db/currency-precision.sql`

Essas migrações já foram aplicadas ao projeto conectado. Não as execute novamente nele.

## Integrações aguardando configuração

Conforme solicitado, credenciais serão configuradas posteriormente.

- **Google OAuth:** ativar o provedor Google no Supabase, informar client ID/secret e configurar callback do Supabase e URLs de redirecionamento da aplicação. O botão fica indisponível enquanto o provedor não estiver ativo.
- **Marketplace:** definir `SERPAPI_KEY` somente no servidor. O endpoint exige sessão válida quando habilitado. A busca atual usa Google Shopping Brasil e devolve ofertas em BRL, independentemente da moeda do ERP. Menor preço significa menor entre as ofertas retornadas; frete e disponibilidade devem ser confirmados na loja. Não houve consulta paga.
- **Resend:** pausado. Definir `RESEND_API_KEY` e `RESEND_FROM` com domínio verificado quando retomar. Não existe envio automático nem botão de envio ativo nesta versão. O adaptador `/api/email` requer conta com e-mail confirmado e corpo `{period:"AAAA-MM",business_id:"UUID",currency:"BRL"}`; consulta apenas dados realizados e ativos desse negócio/moeda e envia à própria conta. SMTP de autenticação no Supabase é configuração separada.

Nunca coloque chaves de provedores em variáveis públicas nem no repositório. `.env.example` lista as variáveis. A chave privilegiada de serviço do Supabase não é utilizada.

## Publicar e acessar de outro computador

Veja [DEPLOYMENT.md](DEPLOYMENT.md) para iniciar a prévia, preparar o GitHub e configurar a hospedagem Railway e os redirecionamentos do Supabase.

## Desenvolvimento

Node 22.13+ (testado com Node 24):

```sh
npm ci
npm run dev
npm run build
npm test
```

A prévia lê `.dev.vars`, ignorado pelo Git. Nesta máquina, a prévia está em `http://localhost:5173/`. O pacote de código não contém segredos nem dependências instaladas.

## Verificação e limites

Veja `VERIFICATION.md` para resultados e pendências. Esta versão não inclui emissão fiscal, conciliação bancária, integração de reservas Airbnb, colaboração com permissões de equipe ou cotações de câmbio. Consulte DEPLOYMENT.md para o estado da publicação.
