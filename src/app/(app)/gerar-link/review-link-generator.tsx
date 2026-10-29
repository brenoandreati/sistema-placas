"use client";

import { Check, Copy, ExternalLink, MapPin, RotateCcw, Star, Trash } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { firstError, useServerAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { deleteReviewLinkAction, generateReviewLinkAction } from "@/server/actions/review-links";

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Link copiado.");
    return true;
  } catch {
    toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    return false;
  }
}

/** Formulário: nome do negócio + link do Google Maps → link direto de avaliação. */
export function ReviewLinkGenerator() {
  const [businessName, setBusinessName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [result, setResult] = useState<{ businessName: string; reviewUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Link da Busca do Google (share.google): mostra o atalho para pegar o link certo no Google Maps.
  const [searchHelp, setSearchHelp] = useState<{ query: string; mapsUrl: string | null } | null>(null);
  const { run, pending, fieldErrors } = useServerAction(generateReviewLinkAction);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSearchHelp(null);
    run(
      { businessName, sourceUrl },
      {
        successMessage: null,
        onSuccess: (link) => {
          if (link.kind === "search") {
            setSearchHelp({ query: link.query, mapsUrl: link.mapsUrl });
            return;
          }
          setResult({ businessName: link.businessName, reviewUrl: link.reviewUrl });
          setCopied(false);
          toast.success(link.alreadyExisted ? "Esse negócio já estava no histórico: link atualizado." : "Link gerado.");
        },
      },
    );
  }

  function reset() {
    setResult(null);
    setSearchHelp(null);
    setBusinessName("");
    setSourceUrl("");
  }

  if (result) {
    return (
      <Card className="flex flex-col gap-4 border-positive/30 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-positive-soft text-positive">
            <Star className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
              Link de avaliação de {result.businessName}
            </h2>
            <p className="text-sm text-muted">Abre direto a tela de dar estrelas no Google.</p>
          </div>
        </div>
        <p className="rounded-xl bg-surface-2 px-4 py-3 font-mono text-[13px] [overflow-wrap:anywhere] text-ink">
          {result.reviewUrl}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={async () => setCopied(await copyToClipboard(result.reviewUrl))}
            className="sm:min-w-40"
            size="lg"
          >
            {copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar link"}
          </Button>
          <Button asChild variant="secondary" size="lg">
            <a href={result.reviewUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Abrir para testar
            </a>
          </Button>
          <Button variant="ghost" size="lg" onClick={reset} className="sm:ml-auto">
            <RotateCcw /> Gerar outro
          </Button>
        </div>
        <p className="text-xs text-muted">
          Use esse link no chip NFC ou no QR code da placa (QR codes → Cadastrar link).
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome do negócio" required error={firstError(fieldErrors, "businessName")}>
          {(p) => (
            <Input
              {...p}
              autoFocus
              maxLength={150}
              placeholder="Ex.: Padaria Pão Dourado"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Link do negócio no Google"
          required
          error={firstError(fieldErrors, "sourceUrl")}
          hint="No Google Maps, abra o negócio e toque em Compartilhar → Copiar link. Pode colar o texto inteiro."
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              inputMode="url"
              placeholder="https://maps.app.goo.gl/..."
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          )}
        </Field>
        {searchHelp && (
          <div role="status" className="flex flex-col gap-3 rounded-xl bg-warning-soft px-4 py-3.5 text-sm text-ink-2">
            <p>
              <span className="font-medium text-ink">Esse link é da Busca do Google</span>
              {searchHelp.query ? ` (“${searchHelp.query}”)` : ""} e não traz o endereço do negócio no Maps. Pegue o
              link certo em 3 passos:
            </p>
            <ol className="ml-5 list-decimal space-y-1">
              <li>
                {searchHelp.mapsUrl
                  ? "Toque no botão abaixo para abrir o negócio no Google Maps."
                  : "Abra o negócio no Google Maps."}
              </li>
              <li>
                No Maps, toque em <span className="font-medium">Compartilhar → Copiar link</span>.
              </li>
              <li>Volte aqui, cole o link novo no campo acima e gere de novo.</li>
            </ol>
            {searchHelp.mapsUrl && (
              <Button asChild variant="secondary" className="h-auto min-h-10 w-full py-2 whitespace-normal sm:w-fit">
                <a
                  href={searchHelp.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  // O campo fica limpo para colar o link do Maps ao voltar.
                  onClick={() => setSourceUrl("")}
                >
                  <MapPin /> Abrir {searchHelp.query ? `“${searchHelp.query}”` : "o negócio"} no Google Maps
                </a>
              </Button>
            )}
          </div>
        )}
        <Button type="submit" size="lg" loading={pending} className="sm:w-fit">
          <Star /> Gerar link de avaliação
        </Button>
      </form>
    </Card>
  );
}

export function ReviewLinkRowActions({
  id,
  businessName,
  reviewUrl,
  canWrite,
}: {
  id: string;
  businessName: string;
  reviewUrl: string;
  canWrite: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const remove = useServerAction(() => deleteReviewLinkAction(id));
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="secondary" size="sm" onClick={() => copyToClipboard(reviewUrl)}>
        <Copy /> <span className="max-sm:sr-only">Copiar</span>
      </Button>
      <Button asChild variant="ghost" size="icon" aria-label={`Abrir o link de avaliação de ${businessName}`}>
        <a href={reviewUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
        </a>
      </Button>
      {canWrite && (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirm(true)}
            aria-label={`Excluir o link de ${businessName} do histórico`}
          >
            <Trash />
          </Button>
          <Dialog open={confirm} onOpenChange={setConfirm}>
            <DialogContent
              size="sm"
              title="Excluir do histórico?"
              description={`O link de ${businessName} sai da lista. Placas e QR codes que já usam esse link continuam funcionando.`}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setConfirm(false)}>
                    Manter
                  </Button>
                  <Button
                    variant="danger"
                    loading={remove.pending}
                    onClick={() => remove.run(undefined, { onSuccess: () => setConfirm(false) })}
                  >
                    Excluir
                  </Button>
                </>
              }
            >
              <p className="font-mono text-xs [overflow-wrap:anywhere] text-muted">{reviewUrl}</p>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
