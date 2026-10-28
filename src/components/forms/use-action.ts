"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/validation/common";

type FieldErrors = Record<string, string[] | undefined>;

/** Executa uma server action com estado de carregamento, erros por campo e feedback visual. */
export function useServerAction<I, T>(action: (input: I) => Promise<ActionResult<T>>) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (input: I, options: { onSuccess?: (data: T) => void; successMessage?: string | null } = {}) => {
      setError(null);
      startTransition(async () => {
        try {
          const result = await action(input);
          if (result.ok) {
            setFieldErrors({});
            const message = options.successMessage === undefined ? result.message : options.successMessage;
            if (message) toast.success(message);
            options.onSuccess?.(result.data);
          } else {
            setFieldErrors(result.fieldErrors ?? {});
            setError(result.error);
            toast.error(result.error);
          }
        } catch (err) {
          // Redirecionamentos do Next (ex.: sessão expirada) seguem o fluxo normal.
          if (err && typeof err === "object" && "digest" in err) throw err;
          const message = "Falha de comunicação com o servidor. Verifique a conexão e tente novamente.";
          setError(message);
          toast.error(message);
        }
      });
    },
    [action],
  );

  const clear = useCallback(() => {
    setFieldErrors({});
    setError(null);
  }, []);

  return { run, pending, fieldErrors, error, clear };
}

/** Chave de idempotência por abertura de formulário (evita registro duplicado em cliques repetidos). */
export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const renew = useCallback(() => setKey(crypto.randomUUID()), []);
  return [key, renew] as const;
}

/**
 * Estado persistido na sessão do navegador: rascunhos sobrevivem à navegação entre seções.
 * Use apenas em componentes renderizados no cliente (ex.: conteúdo de diálogos abertos).
 */
export function useDraft<T>(storageKey: string, initial: () => T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) return { ...initial(), ...JSON.parse(raw) };
    } catch {
      // Armazenamento indisponível ou rascunho ilegível: começa vazio.
    }
    return initial();
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Armazenamento indisponível (modo privado): segue sem rascunho.
    }
  }, [storageKey, value]);

  const initialRef = useRef(initial);
  const discard = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    setValue(initialRef.current());
  }, [storageKey]);

  return [value, setValue, discard] as const;
}

export function firstError(errors: FieldErrors, key: string): string | undefined {
  return errors[key]?.[0];
}
