"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { firstError, useServerAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/lib/cn";
import { formatCents, formatInteger } from "@/lib/format";
import { completeSetupAction, skipSetupAction } from "@/server/actions/setup";

const STEPS = ["Seu negócio", "Caixa", "Placas em estoque"] as const;

export function SetupWizard({
  initialBusinessName,
  initialDisplayName,
  defaultMinStock,
}: {
  initialBusinessName: string;
  initialDisplayName: string;
  defaultMinStock: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState(initialBusinessName);
  const [displayName, setDisplayName] = useState(initialDisplayName || "Placas NFC");
  const [openingBalance, setOpeningBalance] = useState<number | null>(0);
  const [productName, setProductName] = useState("Placa NFC Avaliações Google");
  const [productSku, setProductSku] = useState("NFC-GOOGLE");
  const [salePrice, setSalePrice] = useState<number | null>(null);
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [costUnknown, setCostUnknown] = useState(false);
  const [initialQuantity, setInitialQuantity] = useState<number | "">("");
  const [minStock, setMinStock] = useState<number | "">(defaultMinStock);
  const { run, pending, fieldErrors } = useServerAction(completeSetupAction);
  const skip = useServerAction(skipSetupAction);

  const canNext = [businessName.trim().length > 0 && displayName.trim().length > 0, openingBalance !== null, true][
    step
  ];

  function finish(e: React.FormEvent) {
    e.preventDefault();
    if (step < 2) {
      if (canNext) setStep(step + 1);
      return;
    }
    run(
      {
        businessName,
        displayName,
        openingBalanceCents: openingBalance ?? 0,
        productName,
        productSku,
        salePriceCents: salePrice ?? 0,
        unitCostCents: costUnknown ? null : unitCost,
        initialQuantity: typeof initialQuantity === "number" ? initialQuantity : 0,
        minStock: typeof minStock === "number" ? minStock : 0,
      },
      { onSuccess: () => router.push("/") },
    );
  }

  return (
    <form onSubmit={finish} className="mt-8">
      <ol className="mb-6 flex items-center gap-2" aria-label="Etapas">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                i < step ? "bg-positive text-white" : i === step ? "bg-ink text-white" : "bg-ink/[0.07] text-muted",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              {i < step ? <Check className="size-4" /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:inline", i === step ? "font-medium text-ink" : "text-muted")}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
        {step === 0 && (
          <div className="grid gap-4">
            <Field
              label="Nome do negócio"
              required
              error={firstError(fieldErrors, "businessName")}
              hint="Aparece nos relatórios."
            >
              {(p) => (
                <Input
                  {...p}
                  autoFocus
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Ex.: Toque Avaliações"
                />
              )}
            </Field>
            <Field
              label="Nome exibido no painel"
              required
              error={firstError(fieldErrors, "displayName")}
              hint="Curto: aparece no menu lateral."
            >
              {(p) => (
                <Input {...p} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} />
              )}
            </Field>
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-4">
            <Field
              label="Quanto dinheiro o negócio tem hoje?"
              required
              error={firstError(fieldErrors, "openingBalanceCents")}
              hint="Saldo inicial do caixa. Vendas, despesas e retiradas são somadas a partir dele. Alterações futuras ficam registradas na auditoria."
            >
              {(p) => (
                <MoneyInput {...p} autoFocus allowNegative value={openingBalance} onValueChange={setOpeningBalance} />
              )}
            </Field>
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Nome do produto"
              required
              className="sm:col-span-2"
              error={firstError(fieldErrors, "productName")}
            >
              {(p) => <Input {...p} value={productName} onChange={(e) => setProductName(e.target.value)} />}
            </Field>
            <Field label="Código (SKU)" required error={firstError(fieldErrors, "productSku")}>
              {(p) => (
                <Input
                  {...p}
                  value={productSku}
                  onChange={(e) => setProductSku(e.target.value.toUpperCase())}
                  className="font-mono"
                />
              )}
            </Field>
            <Field label="Preço de venda" required error={firstError(fieldErrors, "salePriceCents")}>
              {(p) => <MoneyInput {...p} value={salePrice} onValueChange={setSalePrice} />}
            </Field>
            <Field
              label="Placas em estoque agora"
              error={firstError(fieldErrors, "initialQuantity")}
              hint="Não gera saída de caixa: considera-se que já foram pagas."
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={initialQuantity}
                  onChange={(e) =>
                    setInitialQuantity(e.target.value === "" ? "" : Math.max(0, Math.trunc(Number(e.target.value))))
                  }
                />
              )}
            </Field>
            <Field label="Estoque mínimo (alerta)" error={firstError(fieldErrors, "minStock")}>
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={minStock}
                  onChange={(e) =>
                    setMinStock(e.target.value === "" ? "" : Math.max(0, Math.trunc(Number(e.target.value))))
                  }
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Checkbox
                label="Não sei o custo de aquisição por placa"
                description="O lucro estimado ficará marcado como parcial até você informar o custo em Estoque."
                checked={costUnknown}
                onChange={(e) => setCostUnknown(e.target.checked)}
              />
            </div>
            {!costUnknown && (
              <Field label="Custo de aquisição por placa" error={firstError(fieldErrors, "unitCostCents")}>
                {(p) => <MoneyInput {...p} value={unitCost} onValueChange={setUnitCost} />}
              </Field>
            )}
            {salePrice !== null && unitCost !== null && !costUnknown && salePrice > 0 && (
              <p className="self-end pb-2 text-sm text-muted sm:col-span-1">
                Margem bruta por placa:{" "}
                <span className="font-medium text-ink">{formatCents(salePrice - unitCost)}</span>
                {typeof initialQuantity === "number" && initialQuantity > 0 && (
                  <>
                    {" "}
                    · estoque avaliado em {formatCents(unitCost * initialQuantity)} ({formatInteger(initialQuantity)}{" "}
                    un.)
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="ghost"
          className="sm:mr-auto"
          loading={skip.pending}
          onClick={() => skip.run(undefined, { onSuccess: () => router.push("/") })}
        >
          Configurar depois
        </Button>
        {step > 0 && (
          <Button type="button" variant="secondary" onClick={() => setStep(step - 1)}>
            Voltar
          </Button>
        )}
        <Button
          type="submit"
          loading={pending}
          disabled={!canNext || (step === 2 && (!salePrice || !productName.trim() || !productSku.trim()))}
        >
          {step < 2 ? "Continuar" : "Concluir configuração"}
        </Button>
      </div>
      <p className="mt-6 text-sm text-muted">
        Depois de concluir: cadastre clientes e registre vendas pelo botão{" "}
        <span className="font-medium text-ink">Nova venda</span> (ou tecla N).
      </p>
    </form>
  );
}
