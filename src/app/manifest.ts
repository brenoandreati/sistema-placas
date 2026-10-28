import type { MetadataRoute } from "next";

// Permite instalar o painel na tela inicial (iPhone: Compartilhar → Adicionar à Tela de Início) e abri-lo como app,
// sem a barra do navegador. O ícone do iPhone vem de `app/apple-icon.png`; estes são os do Android/Chrome.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Painel Placas NFC",
    short_name: "Placas NFC",
    description: "Gestão de estoque, vendas, clientes e caixa das placas NFC de avaliação.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f6f9",
    theme_color: "#f4f6f9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // A marca ocupa ~60% da largura: cabe na área segura dos ícones adaptáveis do Android.
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
