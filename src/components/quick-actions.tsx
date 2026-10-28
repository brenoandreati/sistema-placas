"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { FinanceEntryDialog } from "@/components/forms/finance-entry-dialog";
import { SaleDialog } from "@/components/forms/sale-dialog";
import { StockEntryDialog } from "@/components/forms/stock-entry-dialog";
import { WithdrawalDialog } from "@/components/forms/withdrawal-dialog";

export type QuickAction =
  | { type: "sale"; customerId?: string }
  | { type: "stock-entry"; productId?: string }
  | { type: "withdrawal" }
  | { type: "expense"; saleId?: string }
  | { type: "income" };

const QuickActionsContext = createContext<{ open: (action: QuickAction) => void } | null>(null);

/** Formulários de lançamento acessíveis de qualquer tela, sem perder a página atual. */
export function QuickActionsProvider({ children }: { children: React.ReactNode }) {
  const [action, setAction] = useState<QuickAction | null>(null);
  const [lastSaleCustomer, setLastSaleCustomer] = useState<string | undefined>();
  const open = useCallback((next: QuickAction) => {
    if (next.type === "sale") setLastSaleCustomer(next.customerId);
    setAction(next);
  }, []);
  const close = useCallback((isOpen: boolean) => {
    if (!isOpen) setAction(null);
  }, []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <QuickActionsContext.Provider value={value}>
      {children}
      <SaleDialog open={action?.type === "sale"} onOpenChange={close} presetCustomerId={lastSaleCustomer} />
      <StockEntryDialog
        open={action?.type === "stock-entry"}
        onOpenChange={close}
        presetProductId={action?.type === "stock-entry" ? action.productId : undefined}
      />
      <WithdrawalDialog open={action?.type === "withdrawal"} onOpenChange={close} />
      <FinanceEntryDialog
        open={action?.type === "expense"}
        onOpenChange={close}
        mode="expense"
        presetSaleId={action?.type === "expense" ? action.saleId : undefined}
      />
      <FinanceEntryDialog open={action?.type === "income"} onOpenChange={close} mode="income" />
    </QuickActionsContext.Provider>
  );
}

export function useQuickActions() {
  const ctx = useContext(QuickActionsContext);
  if (!ctx) throw new Error("useQuickActions deve ser usado dentro de QuickActionsProvider");
  return ctx;
}

/** Botão que abre um lançamento rápido (pode ser usado em páginas do servidor). */
export function QuickActionButton({ action, ...props }: { action: QuickAction } & Omit<ButtonProps, "onClick">) {
  const { open } = useQuickActions();
  return <Button {...props} onClick={() => open(action)} />;
}
