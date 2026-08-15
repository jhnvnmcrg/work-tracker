import { postgres } from "vite-plugin-neon-new";

/**
 * Provisions a Neon Launchpad database on first `vite dev` if DATABASE_URL is
 * unset. Note the claimed database expires after 72 hours.
 *
 * The scaffold's `seed: { type: "sql-script", path: "db/init.sql" }` is
 * deliberately removed. That script runs only on fresh provisioning, so it would
 * drift from `drizzle/` and become a second, silently-wrong source of truth for
 * the schema. Provisioning creates an empty database; `npm run db:migrate`
 * builds the schema; reference data is seeded by application code, which can do
 * the idempotent, effectivity-aware upserts that holidays and contribution
 * tables actually need.
 */
export default postgres({
	referrer: "create-tanstack",
	dotEnvKey: "DATABASE_URL",
});
