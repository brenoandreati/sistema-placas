-- Regras de integridade que o Prisma não expressa no schema.
-- 1) CHECK constraints de domínio (valores positivos, estoque nunca negativo).
-- 2) Imutabilidade de registros financeiros, pagamentos, movimentações de estoque e auditoria:
--    correções acontecem por lançamentos compensatórios, nunca por UPDATE/DELETE.

-- ───────────── CHECK constraints ─────────────

ALTER TABLE "products"
  ADD CONSTRAINT "products_current_stock_non_negative" CHECK ("current_stock" >= 0),
  ADD CONSTRAINT "products_min_stock_non_negative" CHECK ("min_stock" >= 0),
  ADD CONSTRAINT "products_sale_price_non_negative" CHECK ("sale_price" >= 0),
  ADD CONSTRAINT "products_average_cost_non_negative" CHECK ("average_cost" IS NULL OR "average_cost" >= 0);

ALTER TABLE "stock_entries"
  ADD CONSTRAINT "stock_entries_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "stock_entries_unit_cost_non_negative" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_not_zero" CHECK ("quantity" <> 0),
  ADD CONSTRAINT "stock_movements_balance_non_negative" CHECK ("balance_after" >= 0);

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_subtotal_non_negative" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "sales_discount_non_negative" CHECK ("discount" >= 0 AND "discount" <= "subtotal"),
  ADD CONSTRAINT "sales_shipping_non_negative" CHECK ("shipping" >= 0),
  ADD CONSTRAINT "sales_total_consistent" CHECK ("total" = "subtotal" - "discount" + "shipping"),
  ADD CONSTRAINT "sales_amount_paid_range" CHECK ("amount_paid" >= 0 AND "amount_paid" <= "total"),
  ADD CONSTRAINT "sales_amount_refunded_non_negative" CHECK ("amount_refunded" >= 0);

ALTER TABLE "sale_items"
  ADD CONSTRAINT "sale_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "sale_items_unit_price_non_negative" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "sale_items_returned_range" CHECK ("returned_quantity" >= 0 AND "returned_quantity" <= "quantity");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_refund_has_reason" CHECK ("kind" = 'RECEIPT' OR "reason" IS NOT NULL);

ALTER TABLE "financial_transactions"
  ADD CONSTRAINT "financial_transactions_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "financial_transactions_reversal_has_reason" CHECK ("origin" <> 'REVERSAL' OR ("reversal_of_id" IS NOT NULL AND "reversal_reason" IS NOT NULL));

ALTER TABLE "withdrawals"
  ADD CONSTRAINT "withdrawals_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "settings"
  ADD CONSTRAINT "settings_singleton" CHECK ("id" = 1);

-- ───────────── Imutabilidade ─────────────

CREATE OR REPLACE FUNCTION prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registros de % são imutáveis: use um lançamento compensatório.', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "financial_transactions_immutable"
  BEFORE UPDATE OR DELETE ON "financial_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER "payments_immutable"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER "stock_movements_immutable"
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER "audit_logs_immutable"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

-- Vendas com valores recebidos não podem ser apagadas; vendas em geral só são canceladas.
CREATE TRIGGER "sales_no_delete"
  BEFORE DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER "withdrawals_no_delete"
  BEFORE DELETE ON "withdrawals"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();

CREATE TRIGGER "expenses_no_delete"
  BEFORE DELETE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
