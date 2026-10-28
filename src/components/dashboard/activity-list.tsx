import { ArrowDownLeft, ArrowUpRight, Ban, PackagePlus, ReceiptText, SlidersHorizontal, Undo2 } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/dates";
import { formatBRL, formatInteger } from "@/lib/format";
import type { ActivityItem } from "@/server/services/metrics";

const ICON: Record<string, typeof ReceiptText> = {
  "sale.create": ReceiptText,
  "sale.cancel": Ban,
  "payment.receive": ArrowDownLeft,
  "payment.refund": Undo2,
  "stock.entry": PackagePlus,
  "stock.adjust": SlidersHorizontal,
  "withdrawal.create": ArrowUpRight,
  "withdrawal.reverse": Undo2,
  "expense.create": ArrowUpRight,
  "finance.capital_contribution": ArrowDownLeft,
  "finance.other_income": ArrowDownLeft,
  "finance.reverse": Undo2,
};

export function ActivityList({ items, tz }: { items: ActivityItem[]; tz: string }) {
  if (items.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted">
        As movimentações aparecem aqui assim que você registrar vendas, entradas e retiradas.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-line">
      {items.map((item) => {
        const Icon = ICON[item.action] ?? ReceiptText;
        const content = (
          <>
            <span
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                item.tone === "positive" && "bg-positive-soft text-positive",
                item.tone === "negative" && "bg-negative-soft text-negative",
                item.tone === "neutral" && "bg-ink/[0.05] text-ink-2",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{item.summary}</span>
              <span className="tabular block text-xs text-muted">{formatDateTime(item.createdAt, tz)}</span>
            </span>
            <span className="tabular shrink-0 text-right text-sm">
              {item.amount !== null && (
                <span
                  className={cn(
                    "block font-medium",
                    item.tone === "positive" && "text-positive",
                    item.tone === "negative" && "text-negative",
                    item.tone === "neutral" && "text-ink",
                  )}
                >
                  {item.tone === "positive" ? "+ " : item.tone === "negative" ? "− " : ""}
                  {formatBRL(item.amount)}
                </span>
              )}
              {item.quantity !== null && (
                <span className="block text-xs text-muted">
                  {item.quantity > 0 && item.action.startsWith("stock") ? "+" : ""}
                  {formatInteger(item.quantity)} un.
                </span>
              )}
            </span>
          </>
        );
        return (
          <li key={item.id}>
            {item.href ? (
              <Link href={item.href} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                {content}
              </Link>
            ) : (
              <div className="flex items-center gap-3 px-5 py-3">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
