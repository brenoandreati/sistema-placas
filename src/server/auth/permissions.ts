import type { UserRole } from "@/generated/prisma/client";

// Matriz de permissões. Na primeira versão há um único administrador, mas cada operação
// já é verificada por permissão para permitir novos usuários e papéis no futuro.
export const PERMISSIONS = {
  "dashboard.read": ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"],
  "sales.read": ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"],
  "sales.write": ["ADMIN", "MANAGER", "OPERATOR"],
  "sales.cancel": ["ADMIN", "MANAGER"],
  "customers.write": ["ADMIN", "MANAGER", "OPERATOR"],
  "customers.delete": ["ADMIN"],
  "inventory.write": ["ADMIN", "MANAGER", "OPERATOR"],
  "inventory.cost": ["ADMIN", "MANAGER"],
  "finance.read": ["ADMIN", "MANAGER", "VIEWER"],
  "finance.write": ["ADMIN", "MANAGER"],
  "finance.reverse": ["ADMIN"],
  "withdrawals.write": ["ADMIN"],
  "reports.read": ["ADMIN", "MANAGER", "VIEWER"],
  "settings.write": ["ADMIN"],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}
