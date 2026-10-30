<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Projeto: Painel Placas NFC

- Regras de negócio ficam em `src/server/services/` (sem dependência do Next) e são testadas em `tests/` contra
  PostgreSQL real (`npm test`, usa `TEST_DATABASE_URL`). Server actions em `src/server/actions/` apenas autenticam,
  chamam o serviço e revalidam.
- Dinheiro: `NUMERIC` no banco, `Prisma.Decimal` no servidor (`src/server/money.ts`), centavos inteiros no cliente.
  Nunca some valores monetários com `number`.
- Registros financeiros, pagamentos, movimentações de estoque, histórico de retornos (`follow_up_events`) e auditoria
  são imutáveis (triggers). Correções = lançamento compensatório. Toda operação crítica chama `audit()` na mesma
  transação.
- Antes de concluir: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- **Várias sessões trabalham neste repositório.** O ramo padrão do GitHub (hoje `claude/practical-tesla-odjvjv`) é a
  versão oficial: tem tudo o que está no ar. Antes de começar qualquer alteração, e de novo antes de cada deploy, rode
  `git fetch origin` e junte o ramo padrão no seu (`git merge origin/<ramo padrão>`). Nunca rode `npm run cf:deploy`
  a partir de um ramo que não contenha o ramo padrão: o deploy substitui o site inteiro e apaga o que outras sessões
  publicaram (aconteceu em 28/10/2026 com os QR codes). Ao terminar, junte o seu trabalho de volta no ramo padrão por
  pull request. Migrations novas são aplicadas no banco de produção (Neon) antes do deploy.
- Documentação: `docs/REGRAS-DE-NEGOCIO.md`, `docs/ARQUITETURA.md`, `docs/SEGURANCA-E-BACKUP.md`, `docs/DEPLOY-CLOUDFLARE.md`.
