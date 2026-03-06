import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export type Database = ReturnType<typeof createDb>["db"];
export { schema };
