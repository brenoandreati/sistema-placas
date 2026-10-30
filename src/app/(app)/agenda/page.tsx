import { CalendarDays, MessageCircle, PhoneOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Kpi } from "@/components/dashboard/kpi";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { FollowUpActions, NewFollowUpButton } from "@/components/follow-ups/follow-up-actions";
import { PageHeader } from "@/components/page-header";
import { FollowUpStatusBadge } from "@/components/status";
import { Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ClearFilters, DateRangeFilter, FilterBar, SearchFilter, SelectFilter } from "@/components/ui/filters";
import { LinkTabs } from "@/components/ui/link-tabs";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import {
  addDaysToDate,
  formatDateString,
  isDateString,
  isPeriodPreset,
  resolvePeriod,
  startOfLocalDay,
  todayString,
} from "@/lib/dates";
import {
  FOLLOW_UP_STATUS,
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_TYPE_LABELS,
  FOLLOW_UP_TYPES,
  type FollowUpType,
} from "@/lib/follow-ups";
import { formatInteger, formatPhone, pluralize, whatsappLink } from "@/lib/format";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import {
  getAgendaSummary,
  listFollowUps,
  listFollowUpsInRange,
  listNeedsContact,
  listOverdueFollowUps,
  type FollowUpStatusFilter,
  type FollowUpView,
} from "@/server/services/follow-ups";
import { getSettingsView } from "@/server/services/settings";
import { AgendaCalendar, calendarRange, type CalendarMode } from "./calendar";
import { FollowUpCard } from "./follow-up-card";

export const metadata: Metadata = { title: "Agenda de Retornos" };

const VIEWS = [
  { key: "lista", label: "Lista" },
  { key: "calendario", label: "Calendário" },
  { key: "hoje", label: "Hoje" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "atrasados", label: "Atrasados" },
  { value: "hoje", label: "Hoje" },
  { value: "proximos", label: "Próximos" },
  { value: "todos", label: "Todos os status" },
  ...FOLLOW_UP_STATUSES.filter((s) => s !== "SCHEDULED").map((s) => ({ value: s, label: FOLLOW_UP_STATUS[s].label })),
];
const STATUS_PARAM: Record<string, FollowUpStatusFilter> = {
  atrasados: "overdue",
  hoje: "today",
  proximos: "upcoming",
  todos: "all",
};
const LIST_PARAMS = ["q", "status", "tipo", "inicio", "fim"];

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession("sales.read");
  const canWrite = can(session.user.role, "followups.write");
  const sp = await searchParams;
  const settings = await getSettingsView();
  const tz = settings.timezone;
  const today = todayString(tz);
  const view: View = VIEWS.some((v) => v.key === sp.visao) ? (sp.visao as View) : "lista";
  const preset = isPeriodPreset(sp.periodo) ? sp.periodo : "30d";
  const period = resolvePeriod(preset, tz, { from: sp.de, to: sp.ate });

  const [summary, needsContact] = await Promise.all([getAgendaSummary(tz, period), listNeedsContact(tz, 6)]);
  const keep = { periodo: sp.periodo, de: sp.de, ate: sp.ate };
  const link = (params: Record<string, string | null | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...params })) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `/agenda?${s}` : "/agenda";
  };

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-5">
      <PageHeader
        title="Agenda de Retornos"
        description="Quando voltar a falar com cada cliente: visitas, ligações, propostas e respostas pendentes."
        actions={canWrite ? <NewFollowUpButton /> : undefined}
      />

      <section aria-label="Indicadores da agenda" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Link
          href={link({ visao: "hoje" })}
          className="rounded-[var(--radius-card)] focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Kpi
            className="h-full p-4 sm:p-5"
            label="Retornos de hoje"
            value={formatInteger(summary.today)}
            detail={
              summary.todayTotal > summary.today
                ? `${formatInteger(summary.todayTotal)} no dia, contando os resolvidos`
                : "pendentes"
            }
          />
        </Link>
        <Link
          href={link({ visao: "lista", status: "proximos" })}
          className="rounded-[var(--radius-card)] focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Kpi
            className="h-full p-4 sm:p-5"
            label="Próximos retornos"
            value={formatInteger(summary.upcoming)}
            detail="a partir de amanhã"
          />
        </Link>
        <Link
          href={link({ visao: "lista", status: "atrasados" })}
          className="rounded-[var(--radius-card)] focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Kpi
            className="h-full p-4 sm:p-5"
            label="Retornos atrasados"
            value={formatInteger(summary.overdue)}
            tone={summary.overdue > 0 ? "negative" : "neutral"}
            detail={summary.overdue > 0 ? "aguardando resolução" : "nenhum pendente"}
          />
        </Link>
        <Link
          href={link({ visao: "lista", status: "todos" })}
          className="rounded-[var(--radius-card)] focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Kpi
            className="h-full p-4 sm:p-5"
            label="Concluídos"
            value={formatInteger(summary.completed)}
            tone={summary.completed > 0 ? "positive" : "neutral"}
            detail={period.label}
          />
        </Link>
      </section>
      <div className="-mt-2 flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:justify-end">
        <span className="text-xs text-muted">Período dos concluídos:</span>
        <PeriodSelector preset={period.preset} from={period.from} to={period.to} />
      </div>

      {needsContact.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader
            title="Precisam de novo contato"
            description={`${pluralize(summary.needsContact, "cliente teve", "clientes tiveram")} uma conversa sem desfecho e nenhum retorno agendado.`}
          />
          <ul className="divide-y divide-line border-t border-line">
            {needsContact.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="min-w-0 flex-1">
                  {f.customer ? (
                    <Link
                      href={`/clientes/${f.customer.id}?aba=contatos`}
                      className="font-medium text-ink hover:underline"
                    >
                      {f.businessName}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{f.businessName}</span>
                  )}
                  <span className="block truncate text-xs text-muted">
                    {f.status === "NO_CONTACT" ? (
                      <PhoneOff className="mr-1 inline size-3" />
                    ) : (
                      <MessageCircle className="mr-1 inline size-3" />
                    )}
                    {FOLLOW_UP_STATUS[f.status].label} em {formatDateString(f.date)}
                    {f.outcome ? ` · ${f.outcome}` : ""}
                  </span>
                </span>
                {canWrite && f.customer && (
                  <NewFollowUpButton customerId={f.customer.id} variant="secondary" size="sm">
                    <CalendarDays /> Agendar retorno
                  </NewFollowUpButton>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <LinkTabs
        items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: link({ visao: v.key }) }))}
        active={view}
      />

      {view === "lista" && <ListView sp={sp} tz={tz} today={today} canWrite={canWrite} pageSize={settings.pageSize} />}
      {view === "calendario" && <CalendarView sp={sp} tz={tz} today={today} canWrite={canWrite} link={link} />}
      {view === "hoje" && <TodayView tz={tz} today={today} canWrite={canWrite} />}
    </div>
  );
}

async function ListView({
  sp,
  tz,
  today,
  canWrite,
  pageSize,
}: {
  sp: Record<string, string | undefined>;
  tz: string;
  today: string;
  canWrite: boolean;
  pageSize: number;
}) {
  const statusParam = sp.status ?? "";
  const status: FollowUpStatusFilter =
    STATUS_PARAM[statusParam] ??
    ((FOLLOW_UP_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as FollowUpStatusFilter)
      : "pending");
  const type = (FOLLOW_UP_TYPES as readonly string[]).includes(sp.tipo ?? "") ? (sp.tipo as FollowUpType) : undefined;
  const result = await listFollowUps(
    {
      status,
      type,
      search: sp.q,
      from: isDateString(sp.inicio) ? sp.inicio : undefined,
      to: isDateString(sp.fim) ? sp.fim : undefined,
      page: Number(sp.page) || 1,
      pageSize,
    },
    tz,
  );
  const filtered = LIST_PARAMS.some((p) => sp[p]);

  return (
    <Card>
      <FilterBar
        search={<SearchFilter placeholder="Buscar cliente, estabelecimento, telefone ou motivo" className="lg:w-80" />}
        params={LIST_PARAMS}
      >
        <SelectFilter param="status" label="Pendentes (agendados)" options={STATUS_FILTERS} />
        <SelectFilter
          param="tipo"
          label="Todos os tipos"
          options={FOLLOW_UP_TYPES.map((t) => ({ value: t, label: FOLLOW_UP_TYPE_LABELS[t] }))}
        />
        <DateRangeFilter fromParam="inicio" toParam="fim" />
        <ClearFilters params={LIST_PARAMS} />
      </FilterBar>
      <DataTable<FollowUpView>
        rows={result.items}
        rowKey={(f) => f.id}
        rowClassName={(f) => (f.status !== "SCHEDULED" ? "opacity-75" : undefined)}
        empty={
          filtered ? (
            <EmptyState title="Nenhum retorno encontrado" description="Ajuste a busca ou os filtros." />
          ) : (
            <EmptyState
              icon={<CalendarDays />}
              title="Nenhum retorno pendente"
              description="Agende quando voltar a um cliente ou potencial cliente: visita, ligação, proposta…"
              action={canWrite ? <NewFollowUpButton /> : undefined}
            />
          )
        }
        columns={[
          {
            key: "date",
            header: "Data e horário",
            cell: (f) => (
              <span
                className={cn("tabular block whitespace-nowrap", f.overdue ? "font-medium text-negative" : "text-ink")}
              >
                {formatDateString(f.date)}
                <span className="block text-xs font-normal text-muted">
                  {f.time ?? "sem horário"}
                  {f.date === today && <span className="text-primary"> · hoje</span>}
                </span>
              </span>
            ),
          },
          {
            key: "business",
            header: "Estabelecimento",
            cell: (f) => (
              <span className="block max-w-56">
                {f.customer ? (
                  <Link
                    href={`/clientes/${f.customer.id}?aba=contatos`}
                    className="block truncate font-medium text-ink hover:underline"
                  >
                    {f.businessName}
                  </Link>
                ) : (
                  <span className="block truncate font-medium text-ink">{f.businessName}</span>
                )}
                {/* Telas médias: o motivo aparece aqui; em telas largas, na coluna própria. */}
                <span className="block truncate text-xs text-muted 2xl:hidden" title={f.reason}>
                  {f.reason}
                </span>
              </span>
            ),
          },
          {
            key: "contact",
            header: "Cliente e telefone",
            cell: (f) => (
              <span className="block max-w-48">
                <span className="block truncate text-ink-2">{f.contactName ?? "—"}</span>
                <PhoneCell phone={f.phone} />
              </span>
            ),
          },
          {
            key: "type",
            header: "Tipo",
            cell: (f) => <span className="text-ink-2">{FOLLOW_UP_TYPE_LABELS[f.type]}</span>,
          },
          {
            key: "reason",
            header: "Motivo",
            className: "max-2xl:hidden",
            headerClassName: "max-2xl:hidden",
            cell: (f) => (
              <span className="block max-w-64 truncate text-ink-2" title={f.reason}>
                {f.reason}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            cell: (f) => <FollowUpStatusBadge status={f.status} overdue={f.overdue} />,
          },
          {
            key: "actions",
            header: <span className="sr-only">Ações</span>,
            align: "right",
            cell: (f) => <FollowUpActions followUp={f} canWrite={canWrite} today={today} tz={tz} />,
          },
        ]}
        mobileCard={(f) => (
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={cn("tabular text-xs", f.overdue ? "font-medium text-negative" : "text-muted")}>
                {formatDateString(f.date)}
                {f.time ? ` · ${f.time}` : ""}
                {f.date === today ? " · hoje" : ""}
              </span>
              <span className="truncate font-medium text-ink">{f.businessName}</span>
              <span className="truncate text-xs text-muted">
                {[f.contactName, FOLLOW_UP_TYPE_LABELS[f.type]].filter(Boolean).join(" · ")}
              </span>
              <span className="truncate text-xs text-ink-2">{f.reason}</span>
              <span className="mt-1">
                <FollowUpStatusBadge status={f.status} overdue={f.overdue} />
              </span>
            </span>
            <FollowUpActions followUp={f} canWrite={canWrite} today={today} tz={tz} />
          </div>
        )}
      />
      <Pagination
        basePath="/agenda"
        params={sp}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        label="retornos"
      />
    </Card>
  );
}

function PhoneCell({ phone }: { phone: string | null }) {
  if (!phone) return null;
  const wa = whatsappLink(phone);
  return (
    <span className="tabular flex items-center gap-1.5 text-xs whitespace-nowrap text-muted">
      {formatPhone(phone)}
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="text-positive"
          aria-label={`WhatsApp ${formatPhone(phone)}`}
        >
          <MessageCircle className="size-4" />
        </a>
      )}
    </span>
  );
}

async function CalendarView({
  sp,
  tz,
  today,
  canWrite,
  link,
}: {
  sp: Record<string, string | undefined>;
  tz: string;
  today: string;
  canWrite: boolean;
  link: (params: Record<string, string | null | undefined>) => string;
}) {
  const mode: CalendarMode = sp.modo === "semana" ? "semana" : "mes";
  const refDate = isDateString(sp.data) ? sp.data : today;
  const range = calendarRange(mode, refDate);
  const selected = isDateString(sp.dia) ? sp.dia : range.days.includes(today) ? today : null;
  const items = await listFollowUpsInRange(
    { start: startOfLocalDay(range.first, tz), end: startOfLocalDay(range.end, tz) },
    tz,
  );
  const dayItems = selected
    ? selected >= range.first && selected < range.end
      ? items.filter((i) => i.date === selected)
      : await listFollowUpsInRange(
          { start: startOfLocalDay(selected, tz), end: startOfLocalDay(addDaysToDate(selected, 1), tz) },
          tz,
        )
    : [];
  const calendarHref = (params: Record<string, string | null>) =>
    link({ visao: "calendario", modo: mode, data: refDate, dia: selected, ...params });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <AgendaCalendar
          mode={mode}
          refDate={refDate}
          selected={selected}
          today={today}
          items={items}
          href={calendarHref}
        />
      </Card>
      {selected && (
        <Card>
          <CardHeader
            title={selected === today ? "Retornos de hoje" : `Retornos de ${formatDateString(selected)}`}
            description={dayItems.length ? pluralize(dayItems.length, "compromisso", "compromissos") : undefined}
            action={canWrite ? <NewFollowUpButton variant="secondary" size="sm" /> : undefined}
          />
          {dayItems.length === 0 ? (
            <EmptyState
              title="Nenhum retorno neste dia"
              description="Toque em outro dia do calendário para ver os compromissos."
            />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {dayItems.map((f) => (
                <FollowUpCard key={f.id} followUp={f} canWrite={canWrite} today={today} tz={tz} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

async function TodayView({ tz, today, canWrite }: { tz: string; today: string; canWrite: boolean }) {
  const [overdue, todays] = await Promise.all([
    listOverdueFollowUps(tz),
    listFollowUpsInRange({ start: startOfLocalDay(today, tz), end: startOfLocalDay(addDaysToDate(today, 1), tz) }, tz),
  ]);
  // Com horário primeiro (em ordem), depois os sem horário; cancelados no fim.
  const ordered = [...todays].sort((a, b) => {
    const rank = (f: FollowUpView) => (f.status === "CANCELLED" ? 2 : f.time ? 0 : 1);
    return rank(a) - rank(b) || (a.time ?? "").localeCompare(b.time ?? "");
  });
  const pendingToday = todays.filter((f) => f.status === "SCHEDULED").length;

  return (
    <div className="flex flex-col gap-5">
      {overdue.length > 0 && (
        <Card className="border-negative/30">
          <CardHeader
            title="Atrasados"
            description={`${pluralize(overdue.length, "retorno ficou", "retornos ficaram")} para trás e ainda não ${overdue.length === 1 ? "foi resolvido" : "foram resolvidos"}.`}
          />
          <ul className="divide-y divide-line border-t border-line">
            {overdue.map((f) => (
              <FollowUpCard key={f.id} followUp={f} canWrite={canWrite} today={today} tz={tz} showDate />
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader
          title={`Hoje, ${formatDateString(today)}`}
          description={
            todays.length
              ? `${pluralize(pendingToday, "pendente", "pendentes")} de ${pluralize(todays.length, "compromisso", "compromissos")}`
              : undefined
          }
          action={canWrite ? <NewFollowUpButton variant="secondary" size="sm" /> : undefined}
        />
        {ordered.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title="Nenhum retorno para hoje"
            description="Os retornos agendados para hoje aparecem aqui, em ordem de horário."
          />
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {ordered.map((f) => (
              <FollowUpCard key={f.id} followUp={f} canWrite={canWrite} today={today} tz={tz} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
