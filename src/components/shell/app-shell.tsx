"use client";

import {
  ChevronDown,
  LogOut,
  Menu,
  PackagePlus,
  Plus,
  ArrowUpRight,
  CircleMinus,
  KeyRound,
  CalendarDays,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand";
import { useQuickActions, type QuickAction } from "@/components/quick-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { cn } from "@/lib/cn";
import { logoutAction } from "@/server/actions/auth";
import { NAV_GROUPS, isActive } from "./nav";

interface ShellProps {
  displayName: string;
  businessName: string;
  todayLabel: string;
  user: { name: string; email: string; role: string };
  setupPending: boolean;
  /** Permissões do usuário atual (controla o que aparece no menu e nos atalhos). */
  permissions: string[];
  children: React.ReactNode;
}

function NavLinks({
  pathname,
  permissions,
  onNavigate,
}: {
  pathname: string;
  permissions: string[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-5" aria-label="Seções">
      {NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => !item.permission || permissions.includes(item.permission)),
      }))
        .filter((group) => group.items.length > 0)
        .map((group, index) => (
          <div key={index} className="flex flex-col gap-0.5">
            {group.label && (
              <p className="px-3 pb-1 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">{group.label}</p>
            )}
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                    active
                      ? "bg-primary-soft font-medium text-primary-ink"
                      : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink",
                  )}
                >
                  <item.icon
                    className={cn(
                      "size-[18px] shrink-0",
                      active ? "text-primary" : "text-muted group-hover:text-ink-2",
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
    </nav>
  );
}

function UserMenu({ user, compact }: { user: ShellProps["user"]; compact?: boolean }) {
  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-ink/[0.04]",
            compact ? "p-1" : "w-full p-2",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
            {initials}
          </span>
          {!compact && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
            </span>
          )}
          {!compact && <ChevronDown className="size-4 text-muted" />}
        </button>
      </DropdownTrigger>
      <DropdownContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-56">
        <DropdownLabel>{user.email}</DropdownLabel>
        <DropdownItem asChild>
          <Link href="/configuracoes?aba=conta">
            <KeyRound /> Alterar senha
          </Link>
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem onSelect={() => logoutAction()}>
          <LogOut /> Sair
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

const LAUNCH_ITEMS = [
  { type: "follow-up", label: "Agendar retorno", icon: CalendarDays, permission: "followups.write" },
  { type: "stock-entry", label: "Entrada de estoque", icon: PackagePlus, permission: "inventory.write" },
  { type: "withdrawal", label: "Retirada de dinheiro", icon: ArrowUpRight, permission: "withdrawals.write" },
  { type: "expense", label: "Despesa", icon: CircleMinus, permission: "finance.write" },
  { type: "income", label: "Aporte ou outra entrada", icon: Plus, permission: "finance.write" },
] as const;

function LaunchItems({ permissions, onOpen }: { permissions: string[]; onOpen: (action: QuickAction) => void }) {
  const items = LAUNCH_ITEMS.filter((item) => permissions.includes(item.permission));
  if (items.length === 0) return <DropdownLabel>Nenhum lançamento disponível para o seu perfil</DropdownLabel>;
  return (
    <>
      {items.map((item) => (
        <DropdownItem key={item.type} onSelect={() => onOpen({ type: item.type })}>
          <item.icon /> {item.label}
        </DropdownItem>
      ))}
    </>
  );
}

export function AppShell({
  displayName,
  businessName,
  todayLabel,
  user,
  setupPending,
  permissions,
  children,
}: ShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const { open } = useQuickActions();
  const canSell = permissions.includes("sales.write");

  // Atalho de teclado: "N" abre uma nova venda (fora de campos de texto).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      if (document.querySelector("[role=dialog]")) return;
      if (canSell && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        open({ type: "sale" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canSell]);

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      {/* Sidebar (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-line bg-surface lg:flex">
        <Link href="/" className="flex h-16 items-center gap-2.5 px-5">
          <BrandMark />
          <span className="min-w-0">
            <span className="block truncate font-display text-[15px] leading-tight font-semibold text-ink">
              {displayName}
            </span>
            {businessName && <span className="block truncate text-xs text-muted">{businessName}</span>}
          </span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <NavLinks pathname={pathname} permissions={permissions} />
        </div>
        <div className="border-t border-line p-2">
          <UserMenu user={user} />
        </div>
      </aside>

      {/* Cabeçalho */}
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="-ml-1.5 rounded-lg p-2 text-ink-2 hover:bg-ink/5 lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </button>
          <Link href="/" className="flex min-w-0 items-center gap-2 lg:hidden">
            <BrandMark className="size-7" />
            <span className="truncate font-display text-[15px] font-semibold">{displayName}</span>
          </Link>
          <p className="hidden text-sm text-ink-2 first-letter:uppercase lg:block">{todayLabel}</p>

          <div className="ml-auto flex items-center gap-2">
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="secondary" size="md" className="hidden sm:inline-flex">
                  Lançar <ChevronDown />
                </Button>
              </DropdownTrigger>
              <DropdownContent className="w-60">
                <LaunchItems permissions={permissions} onOpen={open} />
              </DropdownContent>
            </Dropdown>
            {canSell && (
              <Button onClick={() => open({ type: "sale" })} className="hidden sm:inline-flex" title="Atalho: N">
                <Plus /> Nova venda
              </Button>
            )}
            <div className="lg:hidden">
              <UserMenu user={user} compact />
            </div>
          </div>
        </div>
      </header>

      {setupPending && pathname !== "/configuracao-inicial" && (
        <div className="border-b border-primary/15 bg-primary-soft px-4 py-2.5 text-sm text-primary-ink sm:px-6 lg:px-8">
          Falta concluir a configuração inicial (saldo do caixa e produto).{" "}
          <Link href="/configuracao-inicial" className="font-medium underline underline-offset-2">
            Configurar agora
          </Link>
        </div>
      )}

      <main className="px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12">{children}</main>

      {/* Ação principal sempre ao alcance no celular */}
      <div
        className="fixed right-4 bottom-4 z-30 flex flex-col items-end gap-2 sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <Dropdown>
          <DropdownTrigger asChild>
            <button
              type="button"
              className="flex size-11 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 shadow-[var(--shadow-pop)]"
              aria-label="Outros lançamentos"
            >
              <ChevronDown className="size-5 rotate-180" />
            </button>
          </DropdownTrigger>
          <DropdownContent side="top" className="w-60">
            <LaunchItems permissions={permissions} onOpen={open} />
          </DropdownContent>
        </Dropdown>
        {canSell && (
          <button
            type="button"
            onClick={() => open({ type: "sale" })}
            className="flex h-14 items-center gap-2 rounded-full bg-primary pr-6 pl-5 font-medium text-white shadow-[0_10px_30px_-6px_rgb(34_81_209/0.55)]"
          >
            <Plus className="size-5" /> Nova venda
          </button>
        )}
      </div>

      {/* Menu (celular/tablet) */}
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent
          variant="sheet"
          title={displayName}
          description={todayLabel}
          className="sm:right-auto sm:left-0 sm:max-w-xs sm:border-r sm:border-l-0"
        >
          <NavLinks pathname={pathname} permissions={permissions} onNavigate={() => setMenuOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
