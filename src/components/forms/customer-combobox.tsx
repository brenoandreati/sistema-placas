"use client";

import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { formatPhone } from "@/lib/format";

export interface CustomerOption {
  id: string;
  businessName: string;
  contactName: string;
  phone: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

function normalize(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Seletor de cliente com busca e opção de cadastrar um novo sem sair do formulário. */
export function CustomerCombobox({
  customers,
  value,
  onChange,
  onCreateNew,
  invalid,
  id,
}: {
  customers: CustomerOption[];
  value: string | null;
  onChange: (customer: CustomerOption) => void;
  onCreateNew: (initialName: string) => void;
  invalid?: boolean;
  id?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = customers.find((c) => c.id === value) ?? null;

  const results = useMemo(() => {
    const q = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    const list = q
      ? customers.filter(
          (c) =>
            normalize(c.businessName).includes(q) ||
            normalize(c.contactName).includes(q) ||
            (digits.length >= 3 && (c.phone ?? "").includes(digits)),
        )
      : customers;
    return list.slice(0, 50);
  }, [customers, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function choose(customer: CustomerOption) {
    onChange(customer);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (highlight < results.length) choose(results[highlight]);
      else onCreateNew(query);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {!open && selected ? (
        <button
          type="button"
          id={id}
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="flex h-auto min-h-10 w-full items-center gap-3 rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-left hover:border-ink-2/40"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-xs font-semibold text-primary-ink">
            {selected.businessName.slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">{selected.businessName}</span>
            <span className="block truncate text-xs text-muted">
              {selected.contactName}
              {selected.phone ? ` · ${formatPhone(selected.phone)}` : ""}
            </span>
          </span>
          <ChevronDown className="size-4 text-muted" />
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={invalid || undefined}
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Buscar cliente por negócio, responsável ou telefone"
            className={cn(
              "h-10 w-full rounded-[10px] border border-line-strong bg-surface pr-3 pl-9 text-sm placeholder:text-muted/80",
              "focus:border-primary focus:ring-3 focus:ring-primary/15 focus:outline-none aria-[invalid=true]:border-negative",
            )}
          />
        </div>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+4px)] z-20 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          {results.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted">
              {customers.length === 0 ? "Nenhum cliente cadastrado ainda." : "Nenhum cliente encontrado."}
            </li>
          )}
          {results.map((c, index) => (
            <li
              key={c.id}
              role="option"
              aria-selected={c.id === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2",
                highlight === index && "bg-ink/[0.05]",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{c.businessName}</span>
                <span className="block truncate text-xs text-muted">
                  {c.contactName}
                  {c.phone ? ` · ${formatPhone(c.phone)}` : ""}
                </span>
              </span>
              {c.id === value && <Check className="size-4 text-primary" />}
            </li>
          ))}
          <li
            role="option"
            aria-selected={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false);
              onCreateNew(query);
            }}
            onMouseEnter={() => setHighlight(results.length)}
            className={cn(
              "mt-1 flex cursor-pointer items-center gap-2 rounded-lg border-t border-line px-3 py-2.5 text-sm font-medium text-primary",
              highlight === results.length && "bg-primary-soft",
            )}
          >
            <Plus className="size-4" /> Cadastrar novo cliente{query.trim() ? `: “${query.trim()}”` : ""}
          </li>
        </ul>
      )}
    </div>
  );
}
