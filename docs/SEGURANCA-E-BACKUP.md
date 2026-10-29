# Segurança, permissões e backup

## Autenticação

- Login por nome de usuário (ex.: `loja.placas`) ou e-mail, e senha (bcrypt, custo 12). Os dois ficam na coluna
  única `users.email`. Política de senha: mínimo de 10 caracteres com letras e números.
- Sessão no banco; o cookie `placas_session` é `httpOnly`, `SameSite=Lax` e `Secure` em produção. O banco guarda só o
  hash SHA-256 do token.
- Expira após 12 h sem uso (`SESSION_TTL_HOURS`) e, no máximo, 7 dias após o login.
- Limite de tentativas: 5 falhas por e-mail ou 20 por IP em 15 minutos.
- Alterar a senha encerra as demais sessões. `npm run user:create -- --email … --reset` redefine a senha pela linha de
  comando e encerra todas as sessões do usuário.

## Autorização

- `src/proxy.ts` redireciona quem não tem cookie (verificação rápida). A validação real acontece no servidor em cada
  página (`requirePageSession`), server action (`runAction` → `requireActor`) e route handler.
- Server actions validam todos os dados com Zod no servidor; o navegador nunca envia totais calculados que sejam aceitos
  sem recálculo (o servidor recalcula subtotal, total e status).
- Matriz de permissões em `src/server/auth/permissions.ts`. Papéis: `ADMIN` (tudo), `MANAGER` (operação e financeiro,
  sem configurações), `OPERATOR` (vendas, clientes, estoque e QR codes), `VIEWER` (consulta).

## Proteções adicionais

- Cabeçalhos: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`.
- Redirecionamento pós-login só para caminhos internos (sem open redirect).
- `/q/{código}` (endereço dos QR codes) é a única rota pública além do login e do health check. Ela só redireciona
  para destinos `http(s)` cadastrados por usuários com a permissão `qrcodes.write` (CHECK no banco impede
  `javascript:` e similares) e não expõe dados do sistema; a página de ativação só mostra o formulário a quem está
  logado com essa permissão.
- O gerador de link de avaliação só abre (no servidor) links curtos de domínios do Google e só segue
  redirecionamentos que continuem em domínios do Google, com tempo limite: não serve para buscar endereços arbitrários.
- CSV protegido contra injeção de fórmulas.
- Nenhum segredo no frontend; variáveis sensíveis apenas no servidor (`.env` ou segredos do provedor).

## Auditoria

`audit_logs` registra criação e cancelamento de vendas, pagamentos e estornos, movimentações de estoque, retiradas,
despesas, aportes, alterações de saldo inicial, preços, custos, clientes, QR codes e configurações — com usuário,
data/hora, IP, valores anteriores/novos e justificativa. A tabela é imutável (trigger) e pode ser consultada em
Configurações → Auditoria.

## Políticas de acesso ao banco

`db/roles.sql` cria dois papéis:

- `placas_owner`: dono do schema, usado apenas pelas migrations (`MIGRATION_DATABASE_URL`);
- `placas_app`: usado pela aplicação (`DATABASE_URL`), só com `SELECT/INSERT/UPDATE/DELETE`, **sem** permissão de
  alterar ou apagar livro-caixa, pagamentos, movimentações de estoque e auditoria, nem de apagar vendas, retiradas e
  despesas.

```bash
psql "$SUPERUSER_URL" -v app_password="'senha-app'" -v owner_password="'senha-owner'" -f db/roles.sql
```

Mesmo sem esses papéis, os triggers das migrations já impedem alterar/apagar os registros financeiros confirmados.

## Backup e recuperação

```bash
npm run backup
```

Gera `backups/placas_<data>.dump` (formato custom do `pg_dump`), valida o arquivo, cria o `.sha256` e remove backups
com mais de `RETENTION_DAYS` (padrão 30). Variáveis: `BACKUP_DATABASE_URL`, `BACKUP_DIR`, `RETENTION_DAYS`.

Restauração (em um banco **vazio**):

```bash
TARGET_DATABASE_URL=postgresql://usuario:senha@host/banco_novo bash scripts/restore.sh backups/placas_AAAAMMDDTHHMMSSZ.dump
```

Estratégia recomendada:

1. Backup diário automático (cron ou agendador do provedor) copiado para fora do servidor (ex.: R2/S3).
2. Em provedores gerenciados (ex.: Neon), manter também o _point-in-time restore_ habilitado.
3. Testar a restauração periodicamente em um banco temporário e conferir `npx prisma migrate status`.
4. Após restaurar, abra Financeiro: a verificação de divergências confirma que estoque, pagamentos e livro-caixa batem.
