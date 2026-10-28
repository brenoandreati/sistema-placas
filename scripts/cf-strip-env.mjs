// O OpenNext embute no Worker os valores dos arquivos .env* locais (como padrões de process.env).
// Em produção as variáveis vêm só do Cloudflare (vars do wrangler.jsonc e segredos; .dev.vars no preview),
// então o arquivo gerado é esvaziado para que credenciais locais nunca sejam publicadas.
import { writeFileSync } from "node:fs";

writeFileSync(
  ".open-next/cloudflare/next-env.mjs",
  ["production", "development", "test"].map((mode) => `export const ${mode} = {};\n`).join(""),
);
console.log("next-env.mjs: variáveis dos arquivos .env locais removidas do bundle.");
