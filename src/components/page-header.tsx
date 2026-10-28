import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[13px] text-muted">{eyebrow}</div>}
        <h1 className="font-display text-[26px] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatStrip({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; tone?: "positive" | "negative" | "warning" }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line shadow-[var(--shadow-card)] sm:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-surface px-4 py-3.5 sm:px-5">
          <dt className="text-xs text-muted">{item.label}</dt>
          <dd
            className={cn(
              "figure mt-1 font-display text-lg font-semibold tracking-tight",
              item.tone === "positive" && "text-positive",
              item.tone === "negative" && "text-negative",
              item.tone === "warning" && "text-warning",
              !item.tone && "text-ink",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
