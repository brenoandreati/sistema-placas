import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Pagination } from "@/components/ui/pagination";
import { formatDateString, formatDateTime, todayString } from "@/lib/dates";
import { formatBRL } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { listAuditLogs } from "@/server/services/audit";
import {
  getOpeningBalanceHistory,
  listCashAccounts,
  listCategories,
  listPaymentMethods,
} from "@/server/services/finance";
import { getSettingsView } from "@/server/services/settings";
import {
  CategoryEditor,
  ChangePasswordForm,
  GroupBadge,
  OpeningBalanceForm,
  PaymentMethodEditor,
  SettingsForm,
} from "./settings-forms";

export const metadata: Metadata = { title: "Configurações" };

const TABS = [
  { key: "geral", label: "Negócio e preferências" },
  { key: "caixa", label: "Caixa e saldo inicial" },
  { key: "categorias", label: "Categorias financeiras" },
  { key: "pagamentos", label: "Formas de pagamento" },
  { key: "conta", label: "Minha conta" },
  { key: "auditoria", label: "Auditoria" },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession();
  const sp = await searchParams;
  const canAdmin = can(session.user.role, "settings.write");
  const tabs = canAdmin ? TABS : TABS.filter((t) => t.key === "conta");
  const tab = tabs.some((t) => t.key === sp.aba) ? sp.aba! : tabs[0].key;
  const settings = await getSettingsView();
  const tz = settings.timezone;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Configurações"
        description="Ajustes do negócio, do caixa e das listas usadas nos lançamentos."
      />
      <LinkTabs items={tabs.map((t) => ({ ...t, href: `/configuracoes?aba=${t.key}` }))} active={tab} />

      {tab === "geral" && (
        <Card>
          <CardBody className="pt-5">
            <SettingsForm initial={settings} />
          </CardBody>
        </Card>
      )}

      {tab === "caixa" && <CashTab tz={tz} />}
      {tab === "categorias" && <CategoriesTab />}
      {tab === "pagamentos" && <PaymentMethodsTab />}
      {tab === "conta" && (
        <Card>
          <CardHeader title="Alterar senha" description={`${session.user.name} · ${session.user.email}`} />
          <CardBody>
            <ChangePasswordForm />
          </CardBody>
        </Card>
      )}
      {tab === "auditoria" && <AuditTab tz={tz} page={Number(sp.page) || 1} sp={sp} />}
    </div>
  );
}

async function CashTab({ tz }: { tz: string }) {
  const [accounts, history] = await Promise.all([listCashAccounts(), getOpeningBalanceHistory()]);
  const today = todayString(tz);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader title="Contas de caixa" description="O saldo disponível parte do saldo inicial de cada conta." />
        <ul className="divide-y divide-line border-t border-line">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <p className="flex items-center gap-2 font-medium text-ink">
                  {a.name} {a.isDefault && <Badge tone="primary">Padrão</Badge>}{" "}
                  {!a.active && <Badge tone="outline">Inativa</Badge>}
                </p>
                <p className="text-sm text-muted">
                  Saldo inicial {formatBRL(a.openingBalance)}
                  {a.openingBalanceDate ? ` em ${formatDateString(a.openingBalanceDate)}` : ""}
                </p>
              </div>
              <OpeningBalanceForm account={a} today={today} />
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Histórico do saldo inicial" description="Toda definição ou alteração fica registrada." />
        {history.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted">Nenhum registro.</p>
        ) : (
          <ol className="flex flex-col gap-3 px-5 pb-5">
            {history.map((h) => (
              <li key={h.id} className="rounded-xl border border-line px-3.5 py-3 text-sm">
                <p className="text-ink">{h.summary}</p>
                {h.reason && <p className="text-[13px] text-ink-2">Motivo: {h.reason}</p>}
                <p className="text-xs text-muted">
                  {formatDateTime(h.createdAt, tz)}
                  {h.user ? ` · ${h.user}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

async function CategoriesTab() {
  const categories = await listCategories({ includeInactive: true });
  return (
    <Card>
      <CardHeader
        title="Categorias financeiras"
        description="Organizam despesas, retiradas e entradas. Categorias de sistema (recebimentos, estornos e compras de estoque) são fixas."
        action={<CategoryEditor />}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-line bg-surface-2/70 text-xs text-muted">
            <tr>
              <th scope="col" className="px-5 py-2.5 text-left font-medium">
                Categoria
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Grupo
              </th>
              <th scope="col" className="px-4 py-2.5 text-left font-medium">
                Detalhes
              </th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {categories.map((c) => (
              <tr key={c.id} className={!c.active ? "opacity-55" : undefined}>
                <td className="px-5 py-2.5 text-ink">{c.name}</td>
                <td className="px-4 py-2.5">
                  <GroupBadge group={c.group} />
                </td>
                <td className="px-4 py-2.5 text-[13px] text-muted">
                  {[
                    c.isSystem ? "Sistema" : null,
                    c.isDirectCost ? "Custo direto das vendas" : null,
                    c.withdrawalKind === "OWNER_DRAW"
                      ? "Retirada pessoal"
                      : c.withdrawalKind === "PROFIT_DISTRIBUTION"
                        ? "Distribuição de lucros"
                        : c.withdrawalKind === "REIMBURSEMENT"
                          ? "Reembolso"
                          : null,
                    !c.active ? "Inativa" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="px-5 py-2.5 text-right">{!c.isSystem && <CategoryEditor category={c} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function PaymentMethodsTab() {
  const methods = await listPaymentMethods({ includeInactive: true });
  return (
    <Card>
      <CardHeader
        title="Formas de pagamento"
        description="Usadas em vendas, recebimentos, despesas e retiradas."
        action={<PaymentMethodEditor />}
      />
      <ul className="divide-y divide-line border-t border-line">
        {methods.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <span className="flex items-center gap-2 text-sm text-ink">
              {m.name} {!m.active && <Badge tone="outline">Inativa</Badge>}
            </span>
            <PaymentMethodEditor method={m} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function AuditTab({ tz, page, sp }: { tz: string; page: number; sp: Record<string, string | undefined> }) {
  const logs = await listAuditLogs({ page, pageSize: 30 });
  return (
    <Card>
      <CardHeader
        title="Registro de operações"
        description="Operações críticas com responsável, data, valores anteriores e justificativa. Os registros não podem ser alterados."
      />
      <ul className="divide-y divide-line border-t border-line">
        {logs.items.map((l) => (
          <li key={l.id} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-ink">
                {l.entityType === "sale" && l.entityId ? (
                  <Link href={`/vendas/${l.entityId}`} className="hover:underline">
                    {l.summary}
                  </Link>
                ) : l.entityType === "customer" && l.entityId && l.action !== "customer.delete" ? (
                  <Link href={`/clientes/${l.entityId}`} className="hover:underline">
                    {l.summary}
                  </Link>
                ) : (
                  l.summary
                )}
              </p>
              <span className="font-mono text-[11px] text-muted">{l.action}</span>
            </div>
            {l.reason && <p className="text-[13px] text-ink-2">Motivo: {l.reason}</p>}
            {(l.before !== null || l.after !== null) && (
              <details className="mt-1 text-xs text-muted">
                <summary className="cursor-pointer">Valores</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-ink-2">
                  {l.before !== null && `antes: ${JSON.stringify(l.before)}\n`}
                  {l.after !== null && `depois: ${JSON.stringify(l.after)}`}
                </pre>
              </details>
            )}
            <p className="text-xs text-muted">
              {formatDateTime(l.createdAt, tz)}
              {l.user ? ` · ${l.user}` : ""}
              {l.ipAddress ? ` · IP ${l.ipAddress}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <Pagination
        basePath="/configuracoes"
        params={{ ...sp, aba: "auditoria" }}
        page={logs.page}
        pageCount={logs.pageCount}
        total={logs.total}
        pageSize={logs.pageSize}
        label="registros"
      />
    </Card>
  );
}
