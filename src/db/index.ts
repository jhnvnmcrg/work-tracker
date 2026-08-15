import { drizzle } from "drizzle-orm/node-postgres";
import { requireEnv } from "#/lib/env.ts";
import * as schema from "./schema/index.ts";

// `casing` MUST stay in sync with drizzle.config.ts. If the two diverge, the
// column names the runtime queries stop matching the ones the migrations created.
export const db = drizzle(requireEnv("DATABASE_URL"), {
	schema,
	casing: "snake_case",
});

export type Db = typeof db;
