-- Política de acesso ao banco (produção) — privilégio mínimo.
--
-- placas_owner : dono do schema; usado SOMENTE pelas migrations (MIGRATION_DATABASE_URL).
-- placas_app   : usado pela aplicação (DATABASE_URL). Só lê e grava dados; não altera estrutura.
--                Não pode apagar nem alterar livro-caixa, pagamentos, movimentações de estoque
--                ou auditoria (além dos triggers de imutabilidade já existentes).
--
-- Uso (como superusuário), trocando as senhas:
--   psql "$SUPERUSER_URL" -v app_password="'senha-forte-app'" -v owner_password="'senha-forte-owner'" -f db/roles.sql
-- Depois rode as migrations com MIGRATION_DATABASE_URL=postgresql://placas_owner:...@host/placas
-- e reexecute a seção GRANT abaixo sempre que novas tabelas forem criadas (ou use os DEFAULT PRIVILEGES).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'placas_owner') THEN
    CREATE ROLE placas_owner LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'placas_app') THEN
    CREATE ROLE placas_app LOGIN;
  END IF;
END $$;

ALTER ROLE placas_owner PASSWORD :owner_password;
ALTER ROLE placas_app PASSWORD :app_password;
ALTER ROLE placas_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

ALTER SCHEMA public OWNER TO placas_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO placas_app;

-- Permissões padrão para tabelas e sequências criadas pelas migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE placas_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO placas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE placas_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO placas_app;

-- Tabelas existentes.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO placas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO placas_app;

-- Registros que nunca podem ser alterados ou removidos pela aplicação.
REVOKE UPDATE, DELETE, TRUNCATE ON financial_transactions, payments, stock_movements, audit_logs FROM placas_app;
REVOKE DELETE, TRUNCATE ON sales, withdrawals, expenses, stock_entries FROM placas_app;
REVOKE ALL ON _prisma_migrations FROM placas_app;
