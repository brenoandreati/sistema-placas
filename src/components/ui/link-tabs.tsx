import Link from "next/link";
import { cn } from "@/lib/cn";

/** Abas baseadas na URL: a aba ativa sobrevive a recarregamentos e pode ser compartilhada. */
export function LinkTabs({
  items,
  active,
  className,
}: {
  items: { key: string; label: React.ReactNode; href: string }[];
  active: string;
  className?: string;
}) {
  return (
    <nav className={cn("-mb-px flex gap-1 overflow-x-auto border-b border-line", className)} aria-label="Abas">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          scroll={false}
          aria-current={item.key === active ? "page" : undefined}
          className={cn(
            "shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
            item.key === active
              ? "border-primary font-medium text-ink"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
