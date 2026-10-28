import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand";
import { getCurrentSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const session = await getCurrentSession();
  const { next } = await searchParams;
  if (session) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-12" />
          <h1 className="mt-5 font-display text-2xl font-semibold tracking-tight text-ink">Painel Placas NFC</h1>
          <p className="mt-1 text-sm text-muted">Estoque, vendas e caixa em um só lugar.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]">
          <LoginForm next={next} />
        </div>
        <p className="mt-6 text-center text-xs text-muted">
          Acesso restrito. As operações são registradas para auditoria.
        </p>
      </div>
    </div>
  );
}
