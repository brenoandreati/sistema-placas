import "dotenv/config";

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Defina TEST_DATABASE_URL (banco exclusivo para testes; ele é apagado a cada execução).");
  }
  if (process.env.DATABASE_URL && url === process.env.DATABASE_URL && !process.env.ALLOW_TESTS_ON_DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL não pode ser igual a DATABASE_URL: os testes apagam todos os dados.");
  }
  return url;
}
