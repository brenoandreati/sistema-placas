import "server-only";
import { addDaysToDate, dateOnlyToDb, startOfLocalDay, todayString } from "@/lib/dates";
import { formatBRL, formatOrderNumber, pluralize } from "@/lib/format";
import { prisma } from "@/server/db";
import { num } from "@/server/money";
import { findDivergences, getRefundsDue } from "./metrics";
import { stockStatus } from "./inventory";

export type AlertSeverity = "critical" | "warning" | "info";

export interface Alert {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export async function getAlerts(tz: string, recentWithdrawalDays: number): Promise<Alert[]> {
  const today = todayString(tz);
  const todayDb = dateOnlyToDb(today);
  const recentSince = startOfLocalDay(addDaysToDate(today, -(recentWithdrawalDays - 1)), tz);

  const [products, overdueSales, pendingSales, recentWithdrawals, unknownCostItems, refundsDue, divergences] =
    await Promise.all([
      prisma.product.findMany({ where: { active: true } }),
      prisma.sale.findMany({
        where: {
          status: { not: "CANCELLED" },
          paymentStatus: { in: ["PENDING", "PARTIAL"] },
          dueDate: { lt: todayDb },
        },
        include: { customer: { select: { businessName: true } } },
        orderBy: { dueDate: "asc" },
      }),
      prisma.sale.findMany({
        where: {
          status: { not: "CANCELLED" },
          paymentStatus: { in: ["PENDING", "PARTIAL"] },
          OR: [{ dueDate: null }, { dueDate: { gte: todayDb } }],
        },
        select: { total: true, amountPaid: true },
      }),
      prisma.withdrawal.aggregate({
        where: { status: "ACTIVE", withdrawnAt: { gte: recentSince } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.saleItem.aggregate({
        where: { unitCost: null, sale: { status: { not: "CANCELLED" } } },
        _sum: { quantity: true },
      }),
      getRefundsDue(),
      findDivergences(),
    ]);

  const alerts: Alert[] = [];

  for (const divergence of divergences) {
    alerts.push({
      id: `divergence-${divergence.kind}-${divergence.href}`,
      severity: "critical",
      title: divergence.kind === "negative_balance" ? "Saldo de caixa negativo" : "Divergência financeira",
      description: divergence.message,
      href: divergence.href,
      actionLabel: "Verificar",
    });
  }

  for (const p of products) {
    const status = stockStatus(p);
    if (status === "out") {
      alerts.push({
        id: `stock-out-${p.id}`,
        severity: "critical",
        title: `${p.name} sem estoque`,
        description: "Nenhuma unidade disponível para venda. Registre uma entrada de estoque.",
        href: `/estoque?produto=${p.id}`,
        actionLabel: "Registrar entrada",
      });
    } else if (status === "low") {
      alerts.push({
        id: `stock-low-${p.id}`,
        severity: "warning",
        title: `Estoque baixo: ${p.name}`,
        description: `${pluralize(p.currentStock, "unidade disponível", "unidades disponíveis")} (mínimo ${p.minStock}).`,
        href: `/estoque?produto=${p.id}`,
        actionLabel: "Ver estoque",
      });
    }
    if (p.averageCost === null) {
      alerts.push({
        id: `cost-missing-${p.id}`,
        severity: "warning",
        title: `Custo de aquisição não informado: ${p.name}`,
        description: "Sem o custo, o lucro estimado não pode ser calculado com precisão.",
        href: `/estoque?produto=${p.id}&acao=custo`,
        actionLabel: "Informar custo",
      });
    }
  }

  if (overdueSales.length > 0) {
    const total = overdueSales.reduce((acc, s) => acc + num(s.total) - num(s.amountPaid), 0);
    const first = overdueSales[0];
    alerts.push({
      id: "sales-overdue",
      severity: "critical",
      title: `${pluralize(overdueSales.length, "venda com pagamento atrasado", "vendas com pagamento atrasado")}`,
      description:
        overdueSales.length === 1
          ? `${formatOrderNumber(first.number)} — ${first.customer.businessName}: ${formatBRL(total)} em atraso.`
          : `${formatBRL(total)} vencidos. Mais antigo: ${formatOrderNumber(first.number)} (${first.customer.businessName}).`,
      href: overdueSales.length === 1 ? `/vendas/${first.id}` : "/contas-a-receber?status=overdue",
      actionLabel: "Cobrar",
    });
  }

  if (pendingSales.length > 0) {
    const total = pendingSales.reduce((acc, s) => acc + num(s.total) - num(s.amountPaid), 0);
    alerts.push({
      id: "sales-pending",
      severity: "info",
      title: `${pluralize(pendingSales.length, "pagamento pendente", "pagamentos pendentes")}`,
      description: `${formatBRL(total)} a receber dentro do prazo.`,
      href: "/contas-a-receber",
      actionLabel: "Ver contas a receber",
    });
  }

  if (refundsDue.count > 0) {
    alerts.push({
      id: "refunds-due",
      severity: "warning",
      title: "Valores a devolver a clientes",
      description: `${formatBRL(refundsDue.total)} recebidos de ${pluralize(refundsDue.count, "venda cancelada", "vendas canceladas")}.`,
      href: "/vendas?status=CANCELLED",
      actionLabel: "Ver vendas",
    });
  }

  if (recentWithdrawals._count._all > 0) {
    alerts.push({
      id: "withdrawals-recent",
      severity: "info",
      title: `${pluralize(recentWithdrawals._count._all, "retirada recente", "retiradas recentes")}`,
      description: `${formatBRL(num(recentWithdrawals._sum.amount))} retirados nos últimos ${recentWithdrawalDays} dias.`,
      href: "/retiradas",
      actionLabel: "Ver retiradas",
    });
  }

  const unknownUnits = unknownCostItems._sum.quantity ?? 0;
  if (unknownUnits > 0) {
    alerts.push({
      id: "sales-without-cost",
      severity: "warning",
      title: "Vendas sem custo de aquisição",
      description: `${pluralize(unknownUnits, "placa vendida", "placas vendidas")} sem custo conhecido. O lucro exibido é parcial.`,
      href: "/estoque?acao=custo",
      actionLabel: "Informar custo",
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
