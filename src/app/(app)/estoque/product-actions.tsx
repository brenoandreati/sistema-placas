"use client";

import { Ellipsis, PackagePlus, Pencil, Plus, SlidersHorizontal, Tag } from "lucide-react";
import { useState } from "react";
import {
  AdjustStockDialog,
  CostDialog,
  ProductDialog,
  type ProductFormData,
} from "@/components/forms/inventory-dialogs";
import { useQuickActions } from "@/components/quick-actions";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";

export function NewProductButton({ defaults }: { defaults: { salePrice: number | null; minStock: number } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Plus /> Novo produto
      </Button>
      <ProductDialog open={open} onOpenChange={setOpen} defaults={defaults} />
    </>
  );
}

export function ProductActions({
  product,
  timezone,
  defaults,
  canCost,
  autoOpenCost,
}: {
  product: ProductFormData;
  timezone: string;
  defaults: { salePrice: number | null; minStock: number };
  canCost: boolean;
  autoOpenCost?: boolean;
}) {
  const [dialog, setDialog] = useState<null | "edit" | "adjust" | "cost">(autoOpenCost && canCost ? "cost" : null);
  const { open } = useQuickActions();
  const close = (o: boolean) => !o && setDialog(null);

  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => open({ type: "stock-entry", productId: product.id })}>
          <PackagePlus /> Entrada
        </Button>
        <Dropdown>
          <DropdownTrigger asChild>
            <Button size="icon" variant="ghost" aria-label={`Mais ações para ${product.name}`}>
              <Ellipsis />
            </Button>
          </DropdownTrigger>
          <DropdownContent className="w-56">
            <DropdownItem onSelect={() => setDialog("adjust")}>
              <SlidersHorizontal /> Ajustar estoque
            </DropdownItem>
            {canCost && (
              <DropdownItem onSelect={() => setDialog("cost")}>
                <Tag /> {product.averageCost === null ? "Informar custo" : "Corrigir custo médio"}
              </DropdownItem>
            )}
            <DropdownItem onSelect={() => setDialog("edit")}>
              <Pencil /> Editar produto
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      </div>
      <ProductDialog open={dialog === "edit"} onOpenChange={close} product={product} defaults={defaults} />
      <AdjustStockDialog open={dialog === "adjust"} onOpenChange={close} product={product} timezone={timezone} />
      {canCost && <CostDialog open={dialog === "cost"} onOpenChange={close} product={product} />}
    </>
  );
}
