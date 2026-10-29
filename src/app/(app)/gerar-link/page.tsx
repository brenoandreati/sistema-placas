import { Monitor, Smartphone, Star } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchFilter } from "@/components/ui/filters";
import { formatDate } from "@/lib/dates";
import { requirePageSession } from "@/server/auth/guard";
import { can } from "@/server/auth/permissions";
import { listReviewLinks, type ReviewLinkView } from "@/server/services/review-links";
import { getSettingsView } from "@/server/services/settings";
import { ReviewLinkGenerator, ReviewLinkRowActions } from "./review-link-generator";

export const metadata: Metadata = { title: "Gerar link de avaliação" };

export default async function ReviewLinksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requirePageSession("sales.read");
  const sp = await searchParams;
  const canWrite = can(session.user.role, "reviewlinks.write");
  const [settings, links] = await Promise.all([getSettingsView(), listReviewLinks(sp.q)]);
  const tz = settings.timezone;

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-5">
      <PageHeader
        title="Gerar link de avaliação"
        description="Cole o link do negócio no Google Maps e receba o link que abre direto a tela de dar estrelas."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {canWrite ? (
          <ReviewLinkGenerator />
        ) : (
          <Card className="p-5 text-sm text-muted">Seu acesso permite só consultar os links já gerados.</Card>
        )}
        <Card>
          <CardHeader title="Onde pegar o link do Google" />
          <CardBody className="flex flex-col gap-4 text-sm text-ink-2">
            <div className="flex gap-3">
              <Smartphone className="mt-0.5 size-4 shrink-0 text-muted" />
              <p>
                <span className="font-medium text-ink">No celular:</span> abra o Google Maps, procure o negócio, toque
                nele e depois em <span className="font-medium">Compartilhar → Copiar link</span>.
              </p>
            </div>
            <div className="flex gap-3">
              <Monitor className="mt-0.5 size-4 shrink-0 text-muted" />
              <p>
                <span className="font-medium text-ink">No computador:</span> procure o negócio no Google Maps, clique
                nele e copie o endereço da barra do navegador (ou Compartilhar → Copiar link).
              </p>
            </div>
            <p className="text-xs text-muted">
              Se o dono do negócio já tiver o link de “pedir avaliações” do Perfil da Empresa (g.page/r/…), pode colar
              ele também.
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Links gerados"
          description="Os links ficam guardados aqui para copiar de novo quando precisar."
        />
        {(links.length > 0 || sp.q) && (
          <div className="border-b border-line p-4">
            <SearchFilter placeholder="Buscar pelo nome do negócio" className="lg:w-80" />
          </div>
        )}
        <DataTable<ReviewLinkView>
          rows={links}
          rowKey={(l) => l.id}
          empty={
            sp.q ? (
              <EmptyState title="Nenhum link encontrado" description="Ajuste a busca." />
            ) : (
              <EmptyState
                icon={<Star />}
                title="Nenhum link gerado ainda"
                description="Os links que você gerar aparecem aqui."
              />
            )
          }
          columns={[
            {
              key: "business",
              header: "Negócio",
              cell: (l) => (
                <span className="block max-w-64">
                  <span className="block truncate font-medium text-ink">{l.businessName}</span>
                  <span className="block text-xs text-muted">{formatDate(l.updatedAt, tz)}</span>
                </span>
              ),
            },
            {
              key: "link",
              header: "Link de avaliação",
              cell: (l) => (
                <span className="block max-w-[28rem] truncate font-mono text-xs text-ink-2" title={l.reviewUrl}>
                  {l.reviewUrl.replace(/^https:\/\//, "")}
                </span>
              ),
            },
            {
              key: "actions",
              header: <span className="sr-only">Ações</span>,
              align: "right",
              cell: (l) => (
                <ReviewLinkRowActions
                  id={l.id}
                  businessName={l.businessName}
                  reviewUrl={l.reviewUrl}
                  canWrite={canWrite}
                />
              ),
            },
          ]}
          mobileCard={(l) => (
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{l.businessName}</span>
                <span className="block truncate font-mono text-[11px] text-muted">
                  {l.reviewUrl.replace(/^https:\/\//, "")}
                </span>
              </span>
              <ReviewLinkRowActions
                id={l.id}
                businessName={l.businessName}
                reviewUrl={l.reviewUrl}
                canWrite={canWrite}
              />
            </div>
          )}
        />
      </Card>
    </div>
  );
}
