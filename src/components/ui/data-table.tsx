import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Representação em cartão para telas pequenas (tabelas largas viram listas). */
  mobileCard?: (row: T) => React.ReactNode;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  mobileCard,
  rowClassName,
  empty,
  footer,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const alignClass = (align?: Column<T>["align"]) =>
    align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <div className={className}>
      {mobileCard && (
        <ul className="divide-y divide-line md:hidden">
          {rows.map((row) => (
            <li key={rowKey(row)} className={cn("px-4 py-3.5", rowClassName?.(row))}>
              {mobileCard(row)}
            </li>
          ))}
        </ul>
      )}
      <div className={cn("overflow-x-auto", mobileCard && "hidden md:block")}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={cn(
                    "bg-surface-2/70 px-4 py-2.5 text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5",
                    alignClass(col.align),
                    col.headerClassName,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={rowKey(row)} className={cn("transition-colors hover:bg-surface-2/80", rowClassName?.(row))}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn("px-4 py-3 align-middle first:pl-5 last:pr-5", alignClass(col.align), col.className)}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t border-line-strong bg-surface-2/70">{footer}</tfoot>}
        </table>
      </div>
    </div>
  );
}
