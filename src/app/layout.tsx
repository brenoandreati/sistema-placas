import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Public_Sans, Schibsted_Grotesk } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const body = Public_Sans({ variable: "--font-body", subsets: ["latin"], display: "swap" });
const display = Schibsted_Grotesk({ variable: "--font-display-face", subsets: ["latin"], display: "swap" });
const code = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Painel Placas NFC", template: "%s · Painel Placas NFC" },
  description: "Gestão de estoque, vendas, clientes e caixa das placas NFC de avaliação.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f4f6f9",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${body.variable} ${display.variable} ${code.variable} h-full`}>
      <body className="min-h-full">
        {children}
        <Toaster
          position="top-right"
          closeButton
          toastOptions={{
            classNames: {
              toast: "!rounded-xl !border-line !shadow-[var(--shadow-pop)] !font-sans",
              title: "!font-medium !text-ink",
              description: "!text-ink-2",
            },
          }}
        />
      </body>
    </html>
  );
}
