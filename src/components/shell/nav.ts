import {
  ArrowUpRight,
  Boxes,
  CalendarClock,
  ChartColumn,
  LayoutDashboard,
  QrCode,
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
  /** Permissão necessária para ver o item (ver server/auth/permissions). */
  permission?: string;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "", items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }] },
  {
    label: "Operação",
    items: [
      { href: "/vendas", label: "Vendas", icon: ReceiptText },
      { href: "/clientes", label: "Clientes", icon: Store },
      { href: "/estoque", label: "Estoque de placas", icon: Boxes },
      { href: "/qr-codes", label: "QR codes", icon: QrCode },
    ],
  },
  {
    label: "Dinheiro",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: Wallet, permission: "finance.read" },
      { href: "/contas-a-receber", label: "Contas a receber", icon: CalendarClock },
      { href: "/retiradas", label: "Retiradas", icon: ArrowUpRight, permission: "finance.read" },
    ],
  },
  {
    label: "Análise",
    items: [
      { href: "/relatorios", label: "Relatórios", icon: ChartColumn, permission: "reports.read" },
      { href: "/configuracoes", label: "Configurações", icon: Settings },
    ],
  },
];

export function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
