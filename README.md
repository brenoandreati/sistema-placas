# Painel Placas NFC

Sistema de gestão para o negócio de venda de placas NFC de avaliação do Google: estoque, vendas, clientes (mini-CRM),
pagamentos, contas a receber, livro-caixa, retiradas e relatórios — com dados reais em PostgreSQL, regras financeiras
auditáveis e interface responsiva.

| Área                   | O que faz                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**          | Saldo em caixa e placas disponíveis (posição atual); placas vendidas, valor bruto, recebido e lucro estimado por período; gráficos; alertas; atividades                                                                     |
| **Vendas**             | Cadastro rápido (cliente pode ser criado no próprio formulário), filtros, pagamentos parciais, estornos, cancelamento com devolução ao estoque                                                                              |
| **Clientes**           | Busca, histórico de compras, financeiro, observações, dados do negócio, link de avaliações do Google, WhatsApp                                                                                                              |
| **Agenda de Retornos** | Retornos comerciais (visita, ligação, WhatsApp, proposta) para clientes e potenciais clientes: lista, calendário mensal/semanal, visão do dia, resultado, reagendamento com histórico e integração com clientes e dashboard |
| **Estoque**            | Produtos, entradas (com custo médio ponderado), ajustes justificados, histórico de movimentações e de custos                                                                                                                |
| **QR codes**           | QR codes dinâmicos em lote para imprimir nas placas; o link de cada um é cadastrado ou trocado depois (pelo painel ou escaneando a placa logado no celular), com contagem de leituras                                       |
| **Gerar link**         | Link direto de avaliação do Google a partir do link do negócio no Google Maps (inclusive os links curtos de compartilhamento), com histórico                                                                                |
| **Financeiro**         | Posição atual × indicadores do período, livro-caixa com saldo acumulado, despesas, aportes, estornos compensatórios                                                                                                         |
| **Contas a receber**   | Vencidas, a vencer e sem vencimento; recebimento parcial ou total; link de cobrança pelo WhatsApp                                                                                                                           |
| **Retiradas**          | Confirmação com saldo antes/depois, bloqueio de saldo negativo, categorias (pessoal × distribuição de lucros), estorno auditável                                                                                            |
| **Relatórios**         | Vendas, estoque, clientes, financeiro e retiradas por período, com exportação CSV (padrão Excel pt-BR)                                                                                                                      |
| **Configurações**      | Negócio, fuso, saldo inicial (com histórico), categorias, formas de pagamento, preferências, senha e log de auditoria                                                                                                       |

## Stack

- **Next.js 16** (App Router, Server Actions, `proxy.ts`) + **React 19** + **TypeScript**
- **Tailwind CSS 4**, componentes próprios sobre **Radix UI**, ícones **Lucide**, gráficos **Recharts**
- **PostgreSQL 16** + **Prisma 7** (driver adapter `pg`), valores em `NUMERIC`
- **Zod 4** (validação compartilhada entre formulários e servidor)
- Autenticação própria por sessão no banco (token com hash SHA-256, cookie `httpOnly`, bcrypt)
- **Vitest** com testes de integração em PostgreSQL real
- Deploy: Node.js (`next start`) ou **Cloudflare Workers** via OpenNext — veja [docs/DEPLOY-CLOUDFLARE.md](docs/DEPLOY-CLOUDFLARE.md)

## Rodando localmente

Pré-requisitos: Node.js 20.9+ (recomendado 22) e PostgreSQL 16 (ou Docker).

```bash
cp .env.example .env
```

Edite o `.env`: `DATABASE_URL`, `TEST_DATABASE_URL` e o administrador inicial (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).

```bash
docker compose up -d
```

(O compose cria os bancos `placas_dev`, `placas_test` e `placas_demo`. Pule se já tiver um PostgreSQL.)

```bash
npm install
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

Acesse http://localhost:3000 e entre com o administrador do `.env`. No primeiro acesso o sistema pede a **configuração
inicial**: nome do negócio, saldo inicial do caixa e o produto (preço, custo se conhecido e estoque inicial).

Atalho: a tecla **N** abre uma nova venda em qualquer tela.

## Scripts

| Comando                                         | Descrição                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `npm run dev`                                   | Servidor de desenvolvimento                                       |
| `npm run build` / `npm start`                   | Build e servidor de produção (Node.js)                            |
| `npm test`                                      | Testes automatizados (usa `TEST_DATABASE_URL`, que é **apagado**) |
| `npm run lint` / `typecheck` / `format`         | Qualidade de código                                               |
| `npm run db:migrate`                            | Aplica as migrations (`prisma migrate deploy`)                    |
| `npm run db:migrate:dev`                        | Cria uma nova migration a partir do `schema.prisma`               |
| `npm run db:seed`                               | Dados de referência + administrador inicial (sem dados fictícios) |
| `npm run db:demo`                               | Dados de demonstração **em banco separado** (`DEMO_DATABASE_URL`) |
| `npm run user:create -- --email … --name …`     | Cria usuário (`--role`, `--reset` para redefinir senha)           |
| `npm run backup`                                | Backup com `pg_dump` (+ checksum e retenção)                      |
| `npm run cf:build` / `cf:preview` / `cf:deploy` | Build, teste local e deploy no Cloudflare Workers                 |
| `npm run cf:link:deploy`                        | Publica o endereço `brplacasnfc.pages.dev` (repasse ao Worker)    |

## Dados de demonstração

Os dados reais nunca são misturados com dados de exemplo. Para apresentar o sistema com dados fictícios:

```bash
DEMO_DATABASE_URL=postgresql://placas:placas@localhost:5432/placas_demo npm run db:demo
```

```bash
DATABASE_URL=postgresql://placas:placas@localhost:5432/placas_demo npm run dev
```

Login da demonstração: `demo@placas.local` / `Demo@123456`. O script recusa bancos cujo nome não termine em `_demo`.

## Testes

```bash
npm test
```

72 testes de integração contra PostgreSQL real cobrem os cenários A–H do requisito (entrada de estoque, venda paga,
venda pendente, pagamento parcial, retirada, cancelamento, compra de estoque e consistência), além de concorrência
(vendas e retiradas simultâneas), idempotência, estornos, imutabilidade no banco, duplicidade de clientes, cálculo de
custo médio e lucro e QR codes dinâmicos (geração em lote, troca de link, leitura pública) geração do link de avaliação do Google e agenda de retornos (reagendamento com histórico, indicadores, potenciais clientes).

## Documentação

- [Regras de negócio e fórmulas](docs/REGRAS-DE-NEGOCIO.md)
- [Arquitetura e decisões técnicas](docs/ARQUITETURA.md)
- [Segurança, permissões e backup](docs/SEGURANCA-E-BACKUP.md)
- [Deploy no Cloudflare Workers](docs/DEPLOY-CLOUDFLARE.md)
