import Link from "next/link";
import { BrandMark } from "@/components/brand";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <BrandMark className="size-10" />
      <h1 className="mt-5 font-display text-2xl font-semibold text-ink">Página não encontrada</h1>
      <p className="mt-1 text-sm text-muted">O registro pode ter sido removido ou o endereço está incorreto.</p>
      <Link
        href="/"
        className="mt-6 rounded-[10px] bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover"
      >
        Voltar ao dashboard
      </Link>
    </div>
  );
}
