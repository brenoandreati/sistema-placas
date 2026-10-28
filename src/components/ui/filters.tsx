"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { Input, Select } from "./form";

/** Atualiza parâmetros da URL (filtros ficam no endereço e sobrevivem à navegação). */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParams(updates: Record<string, string | null | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === undefined || value === "") params.delete(key);
      else params.set(key, value);
    }
    if (!("page" in updates)) params.delete("page");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { searchParams, setParams, pending };
}

export function SearchFilter({
  param = "q",
  placeholder,
  className,
}: {
  param?: string;
  placeholder: string;
  className?: string;
}) {
  const { searchParams, setParams } = useUrlParams();
  const current = searchParams.get(param) ?? "";
  const [value, setValue] = useState(current);
  const [synced, setSynced] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quando a URL muda por fora (ex.: "Limpar filtros"), o campo acompanha.
  if (current !== synced) {
    setSynced(current);
    setValue(current);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setParams({ [param]: next.trim() || null }), 300);
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 [&::-webkit-search-cancel-button]:hidden"
        aria-label={placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
          aria-label="Limpar busca"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function SelectFilter({
  param,
  label,
  options,
  className,
}: {
  param: string;
  label: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  const { searchParams, setParams } = useUrlParams();
  return (
    <Select
      aria-label={label}
      value={searchParams.get(param) ?? ""}
      onChange={(e) => setParams({ [param]: e.target.value || null })}
      className={cn("w-auto min-w-36", className)}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function DateRangeFilter({ fromParam = "de", toParam = "ate" }: { fromParam?: string; toParam?: string }) {
  const { searchParams, setParams } = useUrlParams();
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="date"
        aria-label="Data inicial"
        value={searchParams.get(fromParam) ?? ""}
        onChange={(e) => setParams({ [fromParam]: e.target.value || null })}
        className="w-auto min-w-0 max-md:flex-1"
      />
      <span className="text-xs text-muted">até</span>
      <Input
        type="date"
        aria-label="Data final"
        value={searchParams.get(toParam) ?? ""}
        onChange={(e) => setParams({ [toParam]: e.target.value || null })}
        className="w-auto min-w-0 max-md:flex-1"
      />
    </div>
  );
}

export function ClearFilters({ params }: { params: string[] }) {
  const { searchParams, setParams } = useUrlParams();
  const active = params.some((p) => searchParams.get(p));
  if (!active) return null;
  return (
    <button
      type="button"
      onClick={() => setParams(Object.fromEntries(params.map((p) => [p, null])))}
      className="inline-flex h-10 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
    >
      <X className="size-3.5" /> Limpar filtros
    </button>
  );
}

/**
 * Barra de filtros: busca sempre visível; demais filtros ficam recolhidos atrás de um botão
 * em telas pequenas e em linha a partir do tablet.
 */
export function FilterBar({
  search,
  params,
  children,
  className,
}: {
  search?: React.ReactNode;
  params: string[];
  children: React.ReactNode;
  className?: string;
}) {
  const { searchParams } = useUrlParams();
  const [open, setOpen] = useState(false);
  const active = params.filter((p) => searchParams.get(p)).length;
  return (
    <div
      className={cn("flex flex-col gap-2 border-b border-line p-4 lg:flex-row lg:flex-wrap lg:items-center", className)}
    >
      <div className="flex gap-2">
        {search && <div className="min-w-0 flex-1">{search}</div>}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-line-strong bg-surface px-3 text-sm font-medium text-ink-2 md:hidden"
        >
          <SlidersHorizontal className="size-4" /> Filtros{active > 0 ? ` (${active})` : ""}
        </button>
      </div>
      <div className={cn("flex-wrap items-center gap-2 md:flex [&>*]:max-md:w-full", open ? "flex" : "hidden")}>
        {children}
      </div>
    </div>
  );
}
