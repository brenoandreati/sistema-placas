import { Badge, type BadgeTone } from "@/components/ui/badge";
import { FOLLOW_UP_STATUS, type FollowUpStatus } from "@/lib/follow-ups";

export const SALE_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  REGISTERED: { label: "Registrada", tone: "neutral" },
  PREPARING: { label: "Em preparação", tone: "primary" },
  SHIPPED: { label: "Enviada", tone: "primary" },
  DELIVERED: { label: "Entregue", tone: "positive" },
  CANCELLED: { label: "Cancelada", tone: "outline" },
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Pendente", tone: "warning" },
  PARTIAL: { label: "Parcial", tone: "warning" },
  PAID: { label: "Pago", tone: "positive" },
  REFUNDED: { label: "Estornado", tone: "neutral" },
  CANCELLED: { label: "Sem cobrança", tone: "outline" },
};

export function SaleStatusBadge({ status }: { status: string }) {
  const s = SALE_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PaymentStatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue)
    return (
      <Badge tone="negative" dot>
        Atrasado
      </Badge>
    );
  const s = PAYMENT_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot={status === "PENDING" || status === "PARTIAL"}>
      {s.label}
    </Badge>
  );
}

export function FollowUpStatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue)
    return (
      <Badge tone="negative" dot>
        Atrasado
      </Badge>
    );
  const s = FOLLOW_UP_STATUS[status as FollowUpStatus] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot={status === "SCHEDULED"}>
      {s.label}
    </Badge>
  );
}
