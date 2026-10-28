import type { NextConfig } from "next";

// Painel financeiro: todas as páginas dependem da sessão e de dados sempre atualizados,
// por isso o app usa renderização dinâmica por requisição (Cache Components desativado).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// No build para o Cloudflare Workers (npm run cf:build) o cliente Prisma é trocado pela variante
// gerada com runtime "workerd", que importa o compilador de consultas como módulo WASM.
const workersBuild = process.env.CF_WORKERS_BUILD === "1";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // No Cloudflare Workers o driver pg usa o socket do pg-cloudflare (condição "workerd"),
  // que o rastreamento de arquivos do Next não detecta sozinho.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/pg-cloudflare/dist/**", "./node_modules/pg-cloudflare/esm/**"],
  },
  // O carregador de WASM do Turbopack faz o rastreamento incluir o projeto inteiro, e o OpenNext empacota todo
  // `.wasm` rastreado (CLI do Prisma, pglite...: +15 MiB). O único WASM usado em produção é o compilador de
  // consultas do Prisma, emitido como chunk em `.next/server/chunks`. O app não usa `next/og`; sem ele no
  // rastreamento, o OpenNext também deixa a biblioteca de fora.
  ...(workersBuild
    ? {
        outputFileTracingExcludes: {
          "/**": ["./node_modules/**/*.wasm", "./node_modules/next/dist/compiled/@vercel/og/**"],
        },
      }
    : {}),
  turbopack: {
    ...(workersBuild
      ? {
          resolveAlias: {
            "@/generated/prisma/client": "./src/generated/prisma-workerd/client.ts",
            "@/generated/prisma/enums": "./src/generated/prisma-workerd/enums.ts",
          },
        }
      : {}),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
