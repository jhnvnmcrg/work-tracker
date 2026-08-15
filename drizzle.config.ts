import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: [".env.local", ".env"] });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"Missing DATABASE_URL. Run `npm run dev` once to let Neon Launchpad provision one, or set it in .env.local.",
	);
}

/**
 * Migrations must run on the direct endpoint, never the pooler.
 *
 * Neon's `-pooler` host is PgBouncer in transaction pooling mode, where a long
 * multi-statement DDL transaction stalls indefinitely rather than failing. The
 * app itself is fine on the pooler; only schema changes need the direct host.
 */
function toDirectConnection(url: string): string {
	const parsed = new URL(url);
	parsed.hostname = parsed.hostname.replace("-pooler", "");
	return parsed.toString();
}

const migrationUrl =
	process.env.DATABASE_URL_UNPOOLED ?? toDirectConnection(databaseUrl);

export default defineConfig({
	out: "./drizzle",
	schema: "./src/db/schema/index.ts",
	dialect: "postgresql",
	// MUST stay in sync with the `casing` passed to drizzle() in src/db/index.ts.
	casing: "snake_case",
	dbCredentials: {
		url: migrationUrl,
	},
	verbose: true,
	strict: true,
});
