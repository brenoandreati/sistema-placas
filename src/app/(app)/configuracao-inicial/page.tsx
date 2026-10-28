import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/server/auth/guard";
import { getSettingsView } from "@/server/services/settings";
import { SetupWizard } from "./setup-wizard";

export const metadata: Metadata = { title: "Configuração inicial" };

export default async function SetupPage() {
  await requirePageSession("settings.write");
  const settings = await getSettingsView();
  if (settings.setupCompleted) redirect("/");
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-[26px] font-semibold tracking-tight text-ink">Vamos configurar o seu painel</h1>
      <p className="mt-1 text-sm text-muted">
        Três passos rápidos. Você pode ajustar tudo depois em Configurações e Estoque.
      </p>
      <SetupWizard
        initialBusinessName={settings.businessName}
        initialDisplayName={settings.displayName}
        defaultMinStock={settings.defaultMinStock}
      />
    </div>
  );
}
