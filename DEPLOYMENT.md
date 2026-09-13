# Publicação do Fluxo ERP

Repositório confirmado pelo proprietário: https://github.com/ThiagoMassa/ERP

A aplicação agora utiliza **Next.js em Node.js 24**. A execução foi adaptada para hospedagem Railway; os endpoints leem variáveis de ambiente do servidor. O fluxo antigo de build Vinext/Cloudflare não é o caminho de publicação atual.

## Executar localmente

```sh
npm ci
npm run dev
```

Preencha `.dev.vars` conforme `.env.example`. Acesse http://localhost:5173/. No Windows, `iniciar-previa.cmd` também inicia a prévia. Mantenha o processo em execução.

## Railway

- Projeto: Fluxo ERP.
- Repositório: ThiagoMassa/ERP, branch main.
- Runtime: Node.js 24.
- Build: `npm run build` (copia o motor WASM e compila o Next.js).
- Start: `npm start` (usa a porta PORT fornecida pela hospedagem).
- Variáveis no serviço: SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY; nunca usar service_role.
- RESEND_API_KEY, RESEND_FROM e SERPAPI_KEY continuam pendentes conforme solicitado.
- A URL pública é gerada pelo domínio do serviço Railway; consulte a mensagem de entrega para o resultado verificado. Não é necessário comprar um domínio próprio para acessar de outro computador.

O repositório contém código, não os registros da sua conta. Os dados ficam no Supabase e exigem login. A demonstração e o estúdio 3D local usam dados temporários.

## Supabase após obter a URL pública

Em Authentication → URL Configuration, defina a URL HTTPS publicada como Site URL e adicione-a em Redirect URLs (com `/` ao final). Preserve localhost como redirecionamento adicional para desenvolvimento, se desejar. Isso permite que confirmações de e-mail voltem ao ERP publicado. O login com Google continua pendente de configuração do provedor.

[Documentação dos redirecionamentos](https://supabase.com/docs/guides/auth/redirect-urls).

Não envie arquivos `.dev.vars`, `.env` com valores, dependências instaladas ou builds ao GitHub. O `.gitignore` já exclui esses arquivos. O WASM é copiado da dependência instalada durante o build.
