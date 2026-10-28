# Deploy no Cloudflare Workers

O app roda no Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare). O Cloudflare não oferece
PostgreSQL gerenciado, então o banco fica em um provedor PostgreSQL (recomendado: **Neon**, região São Paulo
`aws-sa-east-1`), acessado por TCP a partir do Worker.

## Requisitos

- **Plano Workers Paid** (US$ 5/mês): o bundle comprimido tem ~3,4 MiB, acima do limite de 3 MiB do plano gratuito, e
  as páginas precisam de mais CPU que os 10 ms do plano gratuito (o login, com bcrypt, usa ~600 ms).
- Um PostgreSQL 14+ acessível pela internet, com duas URLs:
  - `DATABASE_URL`: conexão **com pooler** (no Neon, o host com `-pooler`), usada pelo app;
  - `MIGRATION_DATABASE_URL`: conexão **direta**, usada só pelas migrations.
- Token da API do Cloudflare com permissão _Workers Scripts: Edit_ (`CLOUDFLARE_API_TOKEN`).

## Primeiro deploy

```bash
MIGRATION_DATABASE_URL="postgresql://…direto…" npx prisma migrate deploy
```

```bash
DATABASE_URL="postgresql://…direto…" ADMIN_EMAIL="voce@exemplo.com" ADMIN_PASSWORD="senha-forte-aqui" npm run db:seed
```

```bash
npm run cf:deploy
```

```bash
npx wrangler secret put DATABASE_URL
```

(cole a URL **com pooler** quando solicitado). O app fica em `https://sistema-placas.<seu-subdominio>.workers.dev`.
Para usar um domínio próprio, adicione uma rota/custom domain ao Worker no painel do Cloudflare.

**QR codes das placas.** O domínio gravado nos QR codes (QR codes → "Endereço dos QR codes") precisa apontar para este
Worker. Prefira um domínio curto e definitivo (ex.: `suaplaca.com.br`): com o domínio no Cloudflare, abra o Worker →
Settings → Domains & Routes → Add → Custom domain. Defina esse domínio **antes** de imprimir: é ele que fica na placa.

Verifique: `https://…/api/health` deve responder `{"status":"ok"}`.

O `wrangler.jsonc` fixa a execução do Worker perto do banco (`"placement": { "mode": "targeted", "region":
"aws:sa-east-1" }`). Se o banco estiver em outra região, ajuste esse valor: cada página faz várias consultas, e com o
Worker longe do banco cada uma paga a distância (medido: `/api/health` caiu de ~1 s para ~70 ms).

## Deploys seguintes

```bash
npm run cf:deploy
```

Se houver migrations novas, rode `npx prisma migrate deploy` com `MIGRATION_DATABASE_URL` antes. Há também o workflow
manual `.github/workflows/deploy-cloudflare.yml` (segredos `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` e
`MIGRATION_DATABASE_URL`).

## Testar localmente no runtime do Workers

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run cf:preview
```

## Como funciona

- `npm run cf:build` define `CF_WORKERS_BUILD=1`; o `next.config.ts` troca o cliente Prisma pela variante gerada com
  `runtime = "workerd"` (`src/generated/prisma-workerd`), que importa o compilador de consultas como módulo WASM — o
  Workers proíbe compilar WASM em tempo de execução.
- O driver `pg` usa sockets TCP do Workers (`pg-cloudflare`, flag `nodejs_compat`). Como conexões não podem ser
  compartilhadas entre requisições no Workers, `src/server/db.ts` cria um cliente Prisma por requisição (no Node.js o
  cliente continua único por processo).
- No build do Workers, o `next.config.ts` tira do rastreamento de arquivos os `.wasm` de `node_modules` e o `next/og`
  (não usado). Sem isso, o OpenNext empacotava a CLI do Prisma, o pglite e afins (19 MiB comprimidos).
- O OpenNext embute no Worker os valores dos arquivos `.env*` locais; `scripts/cf-strip-env.mjs` (chamado pelo
  `cf:build`) apaga esses valores. Em produção as variáveis vêm só de `vars` no `wrangler.jsonc` e dos segredos
  (`wrangler secret put`); no `cf:preview`, do `.dev.vars`.
- Opcional: com um token que tenha permissão de Hyperdrive, é possível criar um Hyperdrive para o banco e usar a
  `connectionString` dele como `DATABASE_URL`, reduzindo a latência de conexão.
