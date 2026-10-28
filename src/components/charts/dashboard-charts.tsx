"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBRL, formatInteger } from "@/lib/format";
import { ChartFrame, ChartTable, ChartTooltip, compactNumber } from "./chart-frame";

export interface SeriesPoint {
  key: string;
  label: string;
  salesTotal: number;
  units: number;
  received: number;
  inflows: number;
  withdrawals: number;
  expenses: number;
}

const C = {
  sold: "var(--chart-sold)",
  in: "var(--chart-in)",
  expense: "var(--chart-expense)",
  withdrawal: "var(--chart-withdrawal)",
  grid: "var(--chart-grid)",
  axis: "var(--chart-axis)",
};

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: C.axis, fontSize: 11 },
} as const;

function xInterval(points: number) {
  return points > 16 ? "preserveStartEnd" : 0;
}

export function SalesChart({ points, granularity }: { points: SeriesPoint[]; granularity: "day" | "month" }) {
  return (
    <ChartFrame
      title="Vendas e recebimentos"
      description={
        granularity === "day"
          ? "Valor das vendas e dinheiro recebido por dia"
          : "Valor das vendas e dinheiro recebido por mês"
      }
      legend={[
        { label: "Vendido", color: C.sold, shape: "line" },
        { label: "Recebido", color: C.in, shape: "line" },
      ]}
      table={
        <ChartTable
          headers={["Período", "Vendido", "Recebido"]}
          rows={points.map((p) => [p.label, formatBRL(p.salesTotal), formatBRL(p.received)])}
        />
      }
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="soldFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2251d1" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#2251d1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" {...axisProps} interval={xInterval(points.length)} minTickGap={16} />
            <YAxis {...axisProps} width={48} tickFormatter={(v: number) => compactNumber(v)} />
            <Tooltip
              cursor={{ stroke: C.axis, strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    title={String(label)}
                    rows={[
                      {
                        label: "Vendido",
                        value: formatBRL(Number(payload[0]?.payload.salesTotal ?? 0)),
                        color: C.sold,
                      },
                      { label: "Recebido", value: formatBRL(Number(payload[0]?.payload.received ?? 0)), color: C.in },
                    ]}
                  />
                ) : null
              }
            />
            <Area
              type="monotone"
              dataKey="salesTotal"
              name="Vendido"
              stroke={C.sold}
              strokeWidth={2}
              fill="url(#soldFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            />
            <Line
              type="monotone"
              dataKey="received"
              name="Recebido"
              stroke={C.in}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

export function UnitsChart({ points }: { points: SeriesPoint[] }) {
  return (
    <ChartFrame
      title="Placas vendidas"
      description="Unidades por período (vendas canceladas não contam)"
      table={
        <ChartTable headers={["Período", "Unidades"]} rows={points.map((p) => [p.label, formatInteger(p.units)])} />
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" {...axisProps} interval={xInterval(points.length)} minTickGap={16} />
            <YAxis {...axisProps} width={36} allowDecimals={false} tickFormatter={(v: number) => compactNumber(v)} />
            <Tooltip
              cursor={{ fill: "rgb(17 26 39 / 0.04)" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <ChartTooltip
                    title={String(label)}
                    rows={[{ label: "Placas", value: formatInteger(Number(payload[0]?.value ?? 0)), color: C.sold }]}
                  />
                ) : null
              }
            />
            <Bar dataKey="units" name="Placas" fill={C.sold} radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

export function CashFlowChart({ points }: { points: SeriesPoint[] }) {
  const data = points.map((p) => ({ ...p, expensesNeg: -p.expenses, withdrawalsNeg: -p.withdrawals }));
  return (
    <ChartFrame
      title="Entradas e saídas do caixa"
      description="Entradas acima da linha; despesas (inclui compras de estoque) e retiradas abaixo"
      legend={[
        { label: "Entradas", color: C.in },
        { label: "Despesas", color: C.expense },
        { label: "Retiradas", color: C.withdrawal },
      ]}
      table={
        <ChartTable
          headers={["Período", "Entradas", "Despesas", "Retiradas"]}
          rows={points.map((p) => [p.label, formatBRL(p.inflows), formatBRL(p.expenses), formatBRL(p.withdrawals)])}
        />
      }
    >
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} stackOffset="sign" margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={C.grid} />
            <XAxis dataKey="label" {...axisProps} interval={xInterval(points.length)} minTickGap={16} />
            <YAxis {...axisProps} width={48} tickFormatter={(v: number) => compactNumber(v)} />
            <ReferenceLine y={0} stroke="var(--line-strong)" />
            <Tooltip
              cursor={{ fill: "rgb(17 26 39 / 0.04)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as SeriesPoint;
                return (
                  <ChartTooltip
                    title={String(label)}
                    rows={[
                      { label: "Entradas", value: formatBRL(p.inflows), color: C.in },
                      { label: "Despesas", value: formatBRL(p.expenses), color: C.expense },
                      { label: "Retiradas", value: formatBRL(p.withdrawals), color: C.withdrawal },
                    ]}
                  />
                );
              }}
            />
            <Bar dataKey="inflows" stackId="cash" fill={C.in} radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="expensesNeg" stackId="cash" fill={C.expense} maxBarSize={24} stroke="#fff" strokeWidth={1} />
            <Bar
              dataKey="withdrawalsNeg"
              stackId="cash"
              fill={C.withdrawal}
              radius={[0, 0, 4, 4]}
              maxBarSize={24}
              stroke="#fff"
              strokeWidth={1}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
