import {
  ArrowUpRight,
  Boxes,
  CalendarClock,
  ChartColumn,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Operação",
    items: [
      { href: "/vendas", label: "Vendas", icon: ReceiptText },
      { href: "/clientes", label: "Clientes", icon: Store },
      { href: "/estoque", label: "Estoque de placas", icon: Boxes },
    ],
  },
  {
    label: "Dinheiro",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: Wallet },
      { href: "/contas-a-receber", label: "Contas a receber", icon: CalendarClock },
      { href: "/retiradas", label: "Retiradas", icon: ArrowUpRight },
    ],
  },
  {
    label: "Análise",
    items: [
      { href: "/relatorios", label: "Relatórios", icon: ChartColumn },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
