import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Deploy no Cloudflare Workers via OpenNext. Sem cache incremental: todas as páginas são dinâmicas.
export default defineCloudflareConfig({});
