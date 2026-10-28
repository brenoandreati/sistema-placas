"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-negative-soft text-negative">
        <CircleAlert className="size-6" />
      </div>
      <h1 className="font-display text-xl font-semibold text-ink">Não foi possível carregar esta página</h1>
      <p className="mt-2 text-sm text-muted">
        Verifique a conexão com o banco de dados e tente novamente. Nenhuma operação foi gravada pela metade.
        {error.digest && <span className="mt-1 block font-mono text-xs">Código: {error.digest}</span>}
      </p>
      <div className="mt-6 flex gap-2">
        <Button onClick={reset}>Tentar novamente</Button>
        <Button variant="secondary" asChild>
          <Link href="/">Ir para o dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
