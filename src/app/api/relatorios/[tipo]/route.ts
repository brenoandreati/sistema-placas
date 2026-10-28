import { NextResponse, type NextRequest } from "next/server";
import { formatDateTime, isDateString, isPeriodPreset, previousPeriod, resolvePeriod } from "@/lib/dates";
import { formatOrderNumber, formatRecordNumber } from "@/lib/format";
import { can } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { ORIGIN_LABELS, getLedger } from "@/server/services/finance";
import {
  csvMoney,
  getCustomersReport,
  getFinancialReport,
  getSalesReport,
  getStockReport,
  getWithdrawalsReport,
  toCsv,
} from "@/server/services/reports";
import { PAYMENT_STATUS_LABELS, SALE_STATUS_LABELS } from "@/server/services/sales";
import { getSettingsView } from "@/server/services/settings";

export const dynamic = "force-dynamic";

const GROUP_LABELS: Record<string, string> = {
  SALES_RECEIPT: "Recebimentos de vendas",
  SALES_REFUND: "Estornos de vendas",
  STOCK_PURCHASE: "Compras de estoque",
  EXPENSE: "Despesas",
  WITHDRAWAL: "Retiradas",
  CAPITAL_CONTRIBUTION: "Aportes",
  OTHER_INCOME: "Outras entradas",
};

/** Exportação CSV dos relatórios, respeitando o período filtrado. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/relatorios/[tipo]">) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { tipo } = await ctx.params;
  const permission =
    tipo === "livro-caixa" || tipo === "retiradas" || tipo === "financeiro" ? "finance.read" : "reports.read";
  if (!can(session.user.role, permission)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const settings = await getSettingsView();
  const tz = settings.timezone;
  const sp = request.nextUrl.searchParams;
  const de = sp.get("de");
  const ate = sp.get("ate");
  const presetParam = sp.get("periodo");
  const preset = isPeriodPreset(presetParam) ? presetParam : de || ate ? "custom" : "month";
  const period = resolvePeriod(preset, tz, { from: isDateString(de) ? de : null, to: isDateString(ate) ? ate : null });

  let csv: string;
  switch (tipo) {
    case "vendas": {
      const report = await getSalesReport(period);
      csv = toCsv(
        [
          "Pedido",
          "Data",
          "Cliente",
          "Placas",
          "Valor bruto",
          "Desconto",
          "Frete",
          "Total",
          "Recebido",
          "Pendente",
          "Status da venda",
          "Status financeiro",
          "Forma de pagamento",
        ],
        report.rows.map((r) => [
          formatOrderNumber(r.number),
          formatDateTime(r.saleDate, tz),
          r.customer,
          r.units,
          csvMoney(r.gross),
          csvMoney(r.discount),
          csvMoney(r.shipping),
          csvMoney(r.total),
          csvMoney(r.paid),
          csvMoney(r.pending),
          SALE_STATUS_LABELS[r.status],
          PAYMENT_STATUS_LABELS[r.paymentStatus],
          r.paymentMethod,
        ]),
      );
      break;
    }
    case "estoque": {
      const report = await getStockReport(period);
      csv = toCsv(
        [
          "Produto",
          "SKU",
          "Estoque atual",
          "Estoque mínimo",
          "Entradas no período",
          "Vendidas no período",
          "Devolvidas no período",
          "Ajustes no período",
          "Custo médio",
          "Valor em estoque",
        ],
        report.rows.map((r) => [
          r.name,
          r.sku,
          r.currentStock,
          r.minStock,
          r.entries,
          r.sold,
          r.returned,
          r.adjustments,
          csvMoney(r.averageCost),
          csvMoney(r.stockValue),
        ]),
      );
      break;
    }
    case "clientes": {
      const report = await getCustomersReport(period);
      csv = toCsv(
        [
          "Negócio",
          "Responsável",
          "Pedidos no período",
          "Placas no período",
          "Valor no período",
          "Pedidos (histórico)",
          "Valor (histórico)",
          "Recorrente",
        ],
        report.rows.map((r) => [
          r.businessName,
          r.contactName,
          r.periodOrders,
          r.periodUnits,
          csvMoney(r.periodTotal),
          r.allOrders,
          csvMoney(r.allTotal),
          r.recurring ? "Sim" : "Não",
        ]),
      );
      break;
    }
    case "financeiro": {
      const report = await getFinancialReport(period);
      csv = toCsv(
        ["Grupo", "Categoria", "Entradas", "Saídas", "Líquido"],
        [
          ...report.categoryRows.map((r) => [
            GROUP_LABELS[r.group] ?? r.group,
            r.name,
            csvMoney(r.inflow),
            csvMoney(r.outflow),
            csvMoney(r.net),
          ]),
          [],
          ["Resumo", "Saldo no início do período", "", "", csvMoney(report.openingBalance)],
          ["Resumo", "Total de entradas", csvMoney(report.cash.totalIn), "", ""],
          ["Resumo", "Total de saídas", "", csvMoney(report.cash.totalOut), ""],
          ["Resumo", "Saldo no fim do período", "", "", csvMoney(report.closingBalance)],
          ["Resumo", "Lucro estimado", "", "", csvMoney(report.profit.profit)],
        ],
      );
      break;
    }
    case "retiradas": {
      const report = await getWithdrawalsReport(period, previousPeriod(period, tz));
      csv = toCsv(
        ["Retirada", "Data", "Valor", "Categoria", "Forma", "Descrição", "Saldo após", "Status", "Motivo do estorno"],
        report.rows.map((r) => [
          formatRecordNumber("RET", r.number),
          formatDateTime(r.withdrawnAt, tz),
          csvMoney(r.amount),
          r.category,
          r.paymentMethod,
          r.description,
          csvMoney(r.balanceAfter),
          r.status === "ACTIVE" ? "Ativa" : "Estornada",
          r.reversalReason ?? "",
        ]),
      );
      break;
    }
    case "livro-caixa": {
      const rows: unknown[][] = [];
      for (let page = 1; ; page++) {
        const result = await getLedger({ from: period.start, to: period.end, page, pageSize: 200 });
        for (const t of result.items) {
          rows.push([
            formatRecordNumber("MOV", t.number),
            formatDateTime(t.occurredAt, tz),
            t.description,
            t.category,
            t.direction === "IN" ? "Entrada" : "Saída",
            csvMoney(t.signedAmount),
            t.paymentMethod ?? "",
            ORIGIN_LABELS[t.origin],
            t.reference?.label ?? "",
            csvMoney(t.balanceAfter),
            t.notes ?? t.reversalReason ?? "",
          ]);
        }
        if (page >= result.pageCount) break;
      }
      // O livro-caixa vem do mais recente para o mais antigo; o arquivo fica em ordem cronológica.
      rows.reverse();
      csv = toCsv(
        [
          "Lançamento",
          "Data",
          "Descrição",
          "Categoria",
          "Tipo",
          "Valor",
          "Forma",
          "Origem",
          "Referência",
          "Saldo após",
          "Observações",
        ],
        rows,
      );
      break;
    }
    default:
      return NextResponse.json({ error: "Relatório desconhecido" }, { status: 404 });
  }

  const filename = `${tipo}_${period.from}_a_${period.to}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
