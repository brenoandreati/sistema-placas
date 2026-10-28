import { testDatabaseUrl } from "./test-db-url";

// Todos os serviços passam a usar o banco de testes.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.TZ = "UTC";
