import { cn } from "@/lib/cn";

/** Marca: a placa vista de frente com as ondas de aproximação NFC. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--ink)" />
      <path
        d="M11.5 20.5a6.4 6.4 0 0 1 0-9"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.45"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M15.2 18.2a3.2 3.2 0 0 1 0-4.4"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.75"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="19.6" cy="16" r="2.3" fill="var(--primary)" />
      <circle cx="19.6" cy="16" r="2.3" fill="none" stroke="#fff" strokeWidth="1.2" />
    </svg>
  );
}
