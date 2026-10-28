"use client";

import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

interface ContentProps extends Omit<React.ComponentProps<typeof D.Content>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** "dialog" centralizado; "sheet" painel lateral (desktop) que vira tela cheia no celular. */
  variant?: "dialog" | "sheet";
  size?: "sm" | "md" | "lg";
  footer?: React.ReactNode;
}

const sizes = { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" };

export function DialogContent({
  title,
  description,
  variant = "dialog",
  size = "md",
  footer,
  className,
  children,
  ...props
}: ContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col bg-surface shadow-[var(--shadow-pop)] focus:outline-none",
          variant === "dialog"
            ? cn(
                "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl data-[state=open]:animate-pop-in",
                "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
                sizes[size],
              )
            : cn(
                "inset-0 data-[state=open]:animate-slide-in-right sm:inset-y-0 sm:right-0 sm:left-auto sm:w-full sm:border-l sm:border-line",
                size === "lg" ? "sm:max-w-2xl" : "sm:max-w-xl",
              ),
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <D.Title className="font-display text-lg font-semibold tracking-tight text-ink">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : "Formulário"}</D.Description>
            )}
          </div>
          <D.Close
            className="-mr-1 rounded-lg p-1.5 text-muted transition-colors hover:bg-ink/5 hover:text-ink"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 sm:flex-row sm:justify-end sm:rounded-b-2xl sm:px-6">
            {footer}
          </div>
        )}
      </D.Content>
    </D.Portal>
  );
}
