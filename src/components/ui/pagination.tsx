import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatInteger } from "@/lib/format";

export function buildHref(
  basePath: string,
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
) {
  const merged = { ...params, ...overrides };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({
  basePath,
  params,
  page,
  pageCount,
  total,
  pageSize,
  label = "registros",
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  label?: string;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const linkClass =
    "inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink-2 hover:bg-surface-2";
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-5 py-3" aria-label="Paginação">
      <p className="tabular text-[13px] text-muted">
        {formatInteger(from)}–{formatInteger(to)} de {formatInteger(total)} {label}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkClass} href={buildHref(basePath, params, { page: String(page - 1) })} scroll={false}>
            <ChevronLeft className="size-4" /> <span className="hidden sm:inline">Anterior</span>
          </Link>
        ) : (
          <span className={cn(linkClass, "pointer-events-none opacity-40")}>
            <ChevronLeft className="size-4" /> <span className="hidden sm:inline">Anterior</span>
          </span>
        )}
        <span className="tabular text-[13px] text-muted">
          {page}/{pageCount}
        </span>
        {page < pageCount ? (
          <Link className={linkClass} href={buildHref(basePath, params, { page: String(page + 1) })} scroll={false}>
            <span className="hidden sm:inline">Próxima</span> <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(linkClass, "pointer-events-none opacity-40")}>
            <span className="hidden sm:inline">Próxima</span> <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
