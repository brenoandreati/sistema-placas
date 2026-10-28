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
- Registros financeiros, pagamentos, movimentações de estoque e auditoria são imutáveis (triggers). Correções = lançamento
  compensatório. Toda operação crítica chama `audit()` na mesma transação.
- Antes de concluir: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Documentação: `docs/REGRAS-DE-NEGOCIO.md`, `docs/ARQUITETURA.md`, `docs/SEGURANCA-E-BACKUP.md`, `docs/DEPLOY-CLOUDFLARE.md`.
