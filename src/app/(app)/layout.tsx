import { QuickActionsProvider } from "@/components/quick-actions";
import { AppShell } from "@/components/shell/app-shell";
import { formatLongDate } from "@/lib/dates";
import { requirePageSession } from "@/server/auth/guard";
import { PERMISSIONS, can, type Permission } from "@/server/auth/permissions";
import { getSettingsView } from "@/server/services/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  const settings = await getSettingsView();
  const permissions = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(session.user.role, p));
  return (
    <QuickActionsProvider>
      <AppShell
        displayName={settings.displayName}
        businessName={settings.businessName}
        todayLabel={formatLongDate(new Date(), settings.timezone)}
        user={{ name: session.user.name, email: session.user.email, role: session.user.role }}
        setupPending={!settings.setupCompleted}
        permissions={permissions}
      >
        {children}
      </AppShell>
    </QuickActionsProvider>
  );
}
