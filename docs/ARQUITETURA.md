# Arquitetura e decisões técnicas

## Visão geral

```
navegador ──► proxy.ts (cookie presente?) ──► páginas (Server Components) ──► serviços ──► Prisma ──► PostgreSQL
                                             └► server actions (formulários) ──┘
                                             └► route handlers (CSV, health) ──┘
```

| Pasta                           | Responsabilidade                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`          | Modelo de dados; migrations em `prisma/migrations` (inclui CHECKs e triggers de imutabilidade) |
| `src/server/services/`          | **Regras de negócio** (estoque, vendas, financeiro, retiradas, métricas, relatórios, alertas)  |
| `src/server/actions/`           | Server actions: autenticação/permissão + chamada ao serviço + revalidação + erros amigáveis    |
| `src/server/auth/`              | Sessões, senha, limite de tentativas, matriz de permissões                                     |
| `src/server/db.ts`              | Cliente Prisma (único por processo no Node; por requisição no Cloudflare Workers)              |
| `src/lib/validation/`           | Schemas Zod compartilhados entre formulários e servidor                                        |
| `src/lib/dates.ts`, `format.ts` | Períodos no fuso do negócio, formatação pt-BR                                                  |
| `src/components/`               | UI: primitivas (`ui/`), formulários (`forms/`), gráficos, shell, dashboard                     |
| `src/app/(app)/`                | Páginas autenticadas; `src/app/(auth)/login` é a única pública                                 |
| `tests/`                        | Testes de integração dos serviços contra PostgreSQL real                                       |

Os serviços não dependem do Next.js (recebem um `Actor` com o usuário), por isso são testados diretamente e podem ser
reaproveitados por uma API, um job ou outro frontend.

## Decisões

- **Renderização dinâmica sem cache de dados.** Todas as páginas dependem da sessão e de dados financeiros; o
  `cacheComponents` do template foi desativado para que cada requisição leia o estado atual. Após cada mutação, as
  server actions chamam `revalidatePath("/", "layout")`.
- **Autenticação própria** (padrão recomendado pela documentação do Next.js e pelo antigo Lucia): sessões no banco com
  token aleatório de 256 bits no cookie e apenas o hash SHA-256 no banco; renovação deslizante (12 h de inatividade) e
  limite absoluto de 7 dias; bcrypt (custo 12); limite de 5 tentativas por e-mail/15 min e 20 por IP. Dispensa serviços
  externos e mantém o controle total do fluxo.
- **Permissões por papel** (`ADMIN`, `MANAGER`, `OPERATOR`, `VIEWER`) em `src/server/auth/permissions.ts`, verificadas no
  servidor em cada página, action e route handler. A v1 usa apenas `ADMIN`, mas novos usuários podem ser criados com
  `npm run user:create`.
- **Concorrência**: estoque com `UPDATE` condicional; `SELECT … FOR UPDATE` em produto (custo médio), venda
  (pagamentos/cancelamento) e conta de caixa (retiradas). Isolamento padrão (READ COMMITTED).
- **Idempotência**: coluna `idempotency_key` única em vendas, pagamentos, entradas, despesas, retiradas e lançamentos;
  violação de unicidade em corrida devolve o registro existente.
- **Datas**: `timestamptz` para instantes e `date` para vencimentos/previsões; conversões com `@date-fns/tz`.
- **Números**: `NUMERIC` + `decimal.js` (via `Prisma.Decimal`); o cliente trabalha em centavos inteiros
  (`MoneyInput` digita da direita para a esquerda, como em apps de banco).
- **Rascunho da venda** fica no `sessionStorage`: dá para sair do formulário, consultar outra tela e voltar sem perder
  o que foi digitado. Filtros e abas ficam na URL.
- **Gráficos**: paleta validada para daltonismo (verde/vermelho separados por luminosidade e por posição acima/abaixo
  da linha), sem eixo duplo, com alternância para tabela.
- **Prisma 7 com dois clientes gerados**: `src/generated/prisma` (Node) e `src/generated/prisma-workerd` (Cloudflare
  Workers, que proíbe compilar WASM em tempo de execução). O build do Cloudflare troca um pelo outro por alias.

## Preparado para crescer

- Produtos múltiplos (modelos, tamanhos, acabamentos) já são suportados; vendas aceitam vários itens.
- Múltiplas contas de caixa já existem no modelo (`cash_accounts`); os formulários exibem a escolha quando houver mais
  de uma.
- Fornecedores, lotes/códigos individuais de placa, garantia/devoluções, PDF de comprovante e integrações (WhatsApp,
  pagamentos) entram como novas tabelas/serviços sem alterar as regras existentes — os serviços concentram a lógica e
  a auditoria registra tudo.
- Para adicionar uma funcionalidade: schema → migration (`npm run db:migrate:dev`) → serviço com testes → action →
  página/componente.
