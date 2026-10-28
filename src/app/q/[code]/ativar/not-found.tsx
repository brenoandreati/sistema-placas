import { QrCode } from "lucide-react";

/** Código inexistente: mensagem neutra (quem chega aqui é o público que escaneou uma placa). */
export default function QrNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-ink text-white">
        <QrCode className="size-6" />
      </span>
      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight text-ink">QR code não encontrado</h1>
      <p className="mt-1 max-w-sm text-sm text-muted">Confira se a placa está inteira e tente escanear novamente.</p>
    </div>
  );
}
