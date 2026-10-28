"use client";

import { useState } from "react";
import { useUrlParams } from "@/components/ui/filters";
import { Input } from "@/components/ui/form";

/** Faixa de valor total (em reais) aplicada ao sair do campo. */
export function ValueRangeFilter() {
  const { searchParams, setParams } = useUrlParams();
  const urlMin = searchParams.get("min") ?? "";
  const urlMax = searchParams.get("max") ?? "";
  const [min, setMin] = useState(urlMin);
  const [max, setMax] = useState(urlMax);
  const [synced, setSynced] = useState(`${urlMin}|${urlMax}`);
  if (synced !== `${urlMin}|${urlMax}`) {
    setSynced(`${urlMin}|${urlMax}`);
    setMin(urlMin);
    setMax(urlMax);
  }
  const apply = () => setParams({ min: min || null, max: max || null });
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        placeholder="Valor mín."
        aria-label="Valor mínimo"
        value={min}
        onChange={(e) => setMin(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && apply()}
        className="w-28"
      />
      <span className="text-xs text-muted">a</span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        placeholder="Valor máx."
        aria-label="Valor máximo"
        value={max}
        onChange={(e) => setMax(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && apply()}
        className="w-28"
      />
    </div>
  );
}
