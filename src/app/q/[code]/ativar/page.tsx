import { CircleCheck, ExternalLink, QrCode } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { QrActivationForm } from "@/components/forms/qr-code-form";
import { normalizeQrCode } from "@/lib/qr";
import { can } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { getQrCode } from "@/server/services/qr-codes";

export const metadata: Metadata = { title: "QR code" };

/**
 * Aberta ao escanear um QR code sem link. Para o público, avisa que a placa ainda não foi ativada;
 * para quem está logado no painel (ex.: no celular), permite cadastrar o link ali mesmo.
 */
export default async function QrActivationPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeQrCode(raw);
  const qr = code ? await getQrCode(code) : null;
  if (!qr) notFound();

  const session = await getCurrentSession();
  const canWrite = !!session && can(session.user.role, "qrcodes.write");
  if (!canWrite && qr.destinationUrl) redirect(`/q/${qr.code}`);

  return (
    <div className="flex min-h-dvh items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-ink text-white">
            <QrCode className="size-6" />
          </span>
          {canWrite ? (
            <>
              <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
                QR code <span className="font-mono">{qr.code}</span>
              </h1>
              <p className="mt-1 text-sm text-muted">
                {qr.destinationUrl
                  ? "Este QR code já está ativo. Você pode trocar o link abaixo."
                  : "Ainda sem link. Cadastre para onde a placa deve levar."}
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">
                Este QR code ainda não foi ativado
              </h1>
              <p className="mt-1 text-sm text-muted">Volte mais tarde ou avise o responsável pelo estabelecimento.</p>
            </>
          )}
        </div>

        {canWrite ? (
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
            {qr.destinationUrl && (
              <div className="mb-5 flex flex-col gap-2 rounded-xl bg-positive-soft px-4 py-3 text-sm">
                <span className="flex items-center gap-2 font-medium text-positive">
                  <CircleCheck className="size-4 shrink-0" /> Ativo
                  {qr.customer ? ` · ${qr.customer.businessName}` : ""}
                </span>
                <span className="[overflow-wrap:anywhere] text-ink-2">{qr.destinationUrl}</span>
                <a
                  href={`/q/${qr.code}`}
                  className="inline-flex w-fit items-center gap-1.5 font-medium text-primary hover:underline"
                >
                  Testar agora <ExternalLink className="size-3.5" />
                </a>
              </div>
            )}
            <QrActivationForm qr={qr} />
            <Link
              href={`/qr-codes?q=${qr.code}`}
              className="mt-4 block text-center text-[13px] text-muted hover:text-ink"
            >
              Ver no painel
            </Link>
          </div>
        ) : (
          <p className="text-center text-xs text-muted">
            É o responsável por esta placa?{" "}
            <Link href={`/login?next=${encodeURIComponent(`/q/${qr.code}/ativar`)}`} className="text-primary">
              Entre para ativar
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
