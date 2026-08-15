import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	smallint,
	text,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditCols } from "./_shared.ts";
import * as e from "./enums.ts";
import { userProfiles } from "./identity.ts";

/**
 * Effectivity envelope for a contribution or tax schedule.
 *
 * `userId IS NULL` is a seeded global row, read-only from the app. A non-null
 * `userId` is that user's private override, which wins for its date range. This
 * gives editable configuration without letting one person's correction change
 * anybody else's payroll.
 *
 * The provenance columns are not decoration: nobody can verify these numbers
 * from memory, so every row must point at the issuance it came from.
 */
export const statutorySchedules = pgTable(
	"statutory_schedules",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text().references(() => userProfiles.userId, {
			onDelete: "cascade",
		}),
		kind: e.statutoryKind().notNull(),
		name: text().notNull(),
		effectiveFrom: date({ mode: "string" }).notNull(),
		effectiveTo: date({ mode: "string" }),

		/* Pure-percentage schemes (PhilHealth) need no bracket rows at all. */
		/** Parts per million: 5% is 50_000. */
		ratePpm: integer(),
		employeeSharePpm: integer(),
		floorCentavos: bigint({ mode: "number" }),
		ceilingCentavos: bigint({ mode: "number" }),

		sourceUrl: text(),
		sourceCitation: text(),
		verifiedAt: date({ mode: "string" }),
		isActive: boolean().notNull().default(true),
		notes: text(),
		...auditCols,
	},
	(t) => [
		index("statutory_schedules_lookup_idx").on(t.kind, t.effectiveFrom.desc()),
		index("statutory_schedules_user_lookup_idx").on(
			t.userId,
			t.kind,
			t.effectiveFrom.desc(),
		),
		uniqueIndex("statutory_schedules_global_uq")
			.on(t.kind, t.effectiveFrom)
			.where(sql`${t.userId} IS NULL`),
		uniqueIndex("statutory_schedules_user_uq")
			.on(t.userId, t.kind, t.effectiveFrom)
			.where(sql`${t.userId} IS NOT NULL`),
		check(
			"statutory_schedules_range_ck",
			sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
		),
	],
);

/**
 * One generic bracket table with a superset of nullable columns.
 *
 * The lookup algorithm is identical for all four schemes — resolve the schedule
 * for the pay date, then find the bracket containing the basis amount — so four
 * near-identical tables would triple the migration and query surface for no
 * type-safety gain; the engine parses rows through zod unions regardless.
 *
 * Per-kind column contract:
 *   sss             salaryCreditCentavos + the employee/employer/EC/MPF amounts
 *                   (SSS publishes an amount table, not a formula)
 *   pagibig         employeeRatePpm, employerRatePpm, capCentavos
 *   philhealth      normally no rows; the schedule scalars are enough
 *   withholding_tax periodType + baseAmountCentavos + excessRatePpm
 */
export const statutoryBrackets = pgTable(
	"statutory_brackets",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		scheduleId: integer()
			.notNull()
			.references(() => statutorySchedules.id, { onDelete: "cascade" }),
		periodType: e.taxPeriodType().notNull().default("monthly"),
		rangeFromCentavos: bigint({ mode: "number" }).notNull(),
		/** Null marks the open-ended top bracket. */
		rangeToCentavos: bigint({ mode: "number" }),

		/* bracketed flat amounts */
		salaryCreditCentavos: bigint({ mode: "number" }),
		employeeAmountCentavos: bigint({ mode: "number" }),
		employerAmountCentavos: bigint({ mode: "number" }),
		employerEcAmountCentavos: bigint({ mode: "number" }),
		employeeMpfCentavos: bigint({ mode: "number" }),
		employerMpfCentavos: bigint({ mode: "number" }),

		/* tiered rates */
		employeeRatePpm: integer(),
		employerRatePpm: integer(),
		capCentavos: bigint({ mode: "number" }),

		/* marginal brackets: tax = baseAmount + (basis - rangeFrom) * excessRate */
		baseAmountCentavos: bigint({ mode: "number" }),
		excessRatePpm: integer(),

		meta: jsonb(),
		sortOrder: smallint().notNull().default(0),
	},
	(t) => [
		uniqueIndex("statutory_brackets_uq").on(
			t.scheduleId,
			t.periodType,
			t.rangeFromCentavos,
		),
		index("statutory_brackets_lookup_idx").on(
			t.scheduleId,
			t.periodType,
			t.rangeFromCentavos,
			t.rangeToCentavos,
		),
		check(
			"statutory_brackets_range_ck",
			sql`${t.rangeToCentavos} IS NULL OR ${t.rangeToCentavos} >= ${t.rangeFromCentavos}`,
		),
	],
);

/**
 * Day and overtime premium multipliers.
 *
 * Not used by the v1 engine (premiums are deferred), but modelled now so
 * enabling them later needs no migration.
 *
 * The key modelling point: `overtimeMultiplierPpm` is *multiplicative* on
 * `dayMultiplierPpm`, not additive. Rest-day overtime is 1.30 x 1.30 = 1.69, and
 * regular-holiday overtime is 2.00 x 1.30 = 2.60.
 */
export const premiumRules = pgTable(
	"premium_rules",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text().references(() => userProfiles.userId, {
			onDelete: "cascade",
		}),
		dayKind: e.dayKind().notNull(),
		isRestDay: boolean().notNull().default(false),
		worked: boolean().notNull().default(true),
		/** Statutory total for the first 8 hours: 2_000_000 ppm is 200%. */
		dayMultiplierPpm: integer().notNull(),
		/** Applied on top of the day multiplier: 1_300_000 ppm is +30%. */
		overtimeMultiplierPpm: integer().notNull().default(1_250_000),
		nightDiffRatePpm: integer().notNull().default(100_000),
		effectiveFrom: date({ mode: "string" }).notNull(),
		effectiveTo: date({ mode: "string" }),
		label: text(),
		sourceCitation: text(),
		notes: text(),
		...auditCols,
	},
	(t) => [
		uniqueIndex("premium_rules_global_uq")
			.on(t.dayKind, t.isRestDay, t.worked, t.effectiveFrom)
			.where(sql`${t.userId} IS NULL`),
		uniqueIndex("premium_rules_user_uq")
			.on(t.userId, t.dayKind, t.isRestDay, t.worked, t.effectiveFrom)
			.where(sql`${t.userId} IS NOT NULL`),
		index("premium_rules_lookup_idx").on(t.dayKind, t.effectiveFrom.desc()),
	],
);
