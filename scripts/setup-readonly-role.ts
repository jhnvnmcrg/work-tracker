/**
 * Creates (or rotates) the SELECT-only Postgres role the AI assistant uses,
 * verifies it genuinely cannot write, and writes DATABASE_URL_READONLY into
 * .env.local.
 *
 * The assistant being read-only is a database grant, not a prompt instruction.
 * A prompt can be argued with, injected around, or broken by a refactor; a role
 * without INSERT, UPDATE, DELETE or DDL cannot write no matter what the layers
 * above it intend. This script is what establishes that.
 *
 * Run with `npm run setup:readonly`. Safe to re-run — it rotates the password.
 */
import crypto from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: [".env.local", ".env"] });

const ROLE = "work_tracker_readonly";
const ENV_PATH = ".env.local";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("DATABASE_URL is not set. Run `npm run dev` once first.");
	process.exit(1);
}

/** DDL and role changes go over the direct endpoint, never the pooler. */
const direct = new URL(databaseUrl);
direct.hostname = direct.hostname.replace("-pooler", "");

const admin = new pg.Client({ connectionString: direct.toString() });
await admin.connect();

const { rows } = await admin.query<{ db: string; can: boolean }>(
	"select current_database() as db, (select rolcreaterole from pg_roles where rolname = current_user) as can",
);
if (!rows[0].can) {
	console.error(
		`The role you are connected as cannot create roles. Create ${ROLE} in the Neon console with SELECT-only grants, then set DATABASE_URL_READONLY yourself.`,
	);
	process.exit(1);
}

const password = crypto.randomBytes(18).toString("base64url");
const exists = await admin.query("select 1 from pg_roles where rolname = $1", [
	ROLE,
]);

if (exists.rowCount === 0) {
	await admin.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}'`);
	console.log(`created role ${ROLE}`);
} else {
	await admin.query(`ALTER ROLE ${ROLE} PASSWORD '${password}'`);
	console.log(`rotated password for existing role ${ROLE}`);
}

await admin.query(`GRANT CONNECT ON DATABASE ${rows[0].db} TO ${ROLE}`);
await admin.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
await admin.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
// So tables added by a future migration are readable without re-running this.
await admin.query(
	`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${ROLE}`,
);
await admin.end();

const readonlyUrl = new URL(databaseUrl);
readonlyUrl.username = ROLE;
readonlyUrl.password = password;

/* --- prove the grant, rather than trusting it --------------------------- */

const probe = new pg.Client({ connectionString: readonlyUrl.toString() });
await probe.connect();

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures += 1;
};

const count = await probe.query("select count(*)::int n from user_profiles");
check("SELECT is permitted", count.rows[0].n >= 0);

for (const [label, sql] of [
	["INSERT is refused", "insert into user_profiles (user_id) values ('probe')"],
	["UPDATE is refused", "update daily_time_records set late_minutes = 0"],
	["DELETE is refused", "delete from user_profiles"],
	["DDL is refused", "create table probe_table (id int)"],
] as const) {
	try {
		await probe.query(sql);
		check(label, false, "the statement was ALLOWED");
	} catch (error) {
		check(label, true, (error as Error).message.split("\n")[0].slice(0, 50));
	}
}
await probe.end();

if (failures > 0) {
	console.error("\nThe role is not read-only. Not writing the connection string.");
	process.exit(1);
}

let env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
env = env.replace(/^DATABASE_URL_READONLY=.*$/m, "").trimEnd();
env += `\n\n# SELECT-only role for the AI assistant. Regenerate with npm run setup:readonly.\nDATABASE_URL_READONLY=${readonlyUrl.toString()}\n`;
writeFileSync(ENV_PATH, env, "utf8");

console.log(`\nDATABASE_URL_READONLY written to ${ENV_PATH}`);
