import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "#/db/schema/index.ts";
import { requireEnv } from "#/lib/env.ts";

/**
 * A separate connection on a `GRANT SELECT`-only Postgres role.
 *
 * The assistant being read-only is a property of the database grant, not of a
 * sentence in a prompt. That distinction matters: a prompt instruction can be
 * talked around by a determined user, sidestepped by prompt injection hidden in
 * data, or quietly broken by a refactor that swaps an import. A role with no
 * INSERT, UPDATE, DELETE or DDL privilege survives all three — the query is
 * refused by Postgres regardless of what any layer above intended.
 *
 * A Biome rule additionally forbids importing `#/db` anywhere under
 * `src/lib/ai/tools/`, so reaching the writable connection is a build failure
 * rather than something to catch in review.
 *
 * Created on first use rather than at import, so defining a tool does not
 * require a database and a missing variable surfaces when the assistant is
 * actually used.
 *
 * Set up with `npm run setup:readonly`.
 */
let connection: ReturnType<typeof create> | null = null;

function create() {
	return drizzle(requireEnv("DATABASE_URL_READONLY"), {
		schema,
		// Must match src/db/index.ts, or column names diverge.
		casing: "snake_case",
	});
}

export function readonlyDb() {
	if (connection === null) connection = create();
	return connection;
}

export type ReadonlyDb = ReturnType<typeof create>;
