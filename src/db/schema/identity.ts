import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditCols } from "./_shared.ts";
import * as e from "./enums.ts";

/**
 * Local mirror of Clerk identity.
 *
 * Clerk owns authentication; this row exists so every domain table can carry a
 * real foreign key — which gives `ON DELETE CASCADE` for account deletion and
 * lets child tables use composite `(userId, id)` keys. The primary key is the
 * Clerk user id itself, so no lookup is needed to scope a query.
 */
export const userProfiles = pgTable("user_profiles", {
	userId: text().primaryKey(),
	email: text(),
	displayName: text(),
	employeeNo: text(),
	position: text(),
	department: text(),
	dateHired: date({ mode: "string" }),
	timezone: text().notNull().default("Asia/Manila"),
	onboardedAt: timestamp({ withTimezone: true, mode: "date" }),
	...auditCols,
});

/**
 * Employment terms, effective-dated.
 *
 * Versioned rather than a single mutable settings row: a raise in July must not
 * retroactively change what January's payslip says, and a finalized payslip has
 * to stay reproducible from the terms that were in force when it was computed.
 */
export const employmentTerms = pgTable(
	"employment_terms",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		effectiveFrom: date({ mode: "string" }).notNull(),
		effectiveTo: date({ mode: "string" }),

		/* ------------------------------- rates ------------------------------- */

		monthlyRateCentavos: bigint({ mode: "number" }).notNull(),
		/**
		 * Working-days divisor times 100, so 313 is stored as 31300. Scaled because
		 * some contracts use fractional divisors such as 393.5.
		 */
		// Explicit column name: the snake_case converter would otherwise split the
		// digit boundary into "working_days_factor_x_100".
		workingDaysFactorX100: integer("working_days_factor_x100")
			.notNull()
			.default(31_300),
		dailyHours: smallint().notNull().default(8),

		/**
		 * Whether the monthly rate already pays for days not worked. This is what
		 * makes a premium incremental rather than a gross-up: for a monthly-paid
		 * employee whose salary already covers holidays, working a regular holiday
		 * adds +100%, not the full 200%.
		 *
		 * Stored explicitly rather than derived from the factor, because contracts
		 * vary and guessing here silently changes someone's pay. Factor 313 implies
		 * holidays covered, rest days not.
		 */
		monthlyRateCoversRestDays: boolean().notNull().default(false),
		monthlyRateCoversHolidays: boolean().notNull().default(true),

		basePaySplitMode: e.basePaySplitMode().notNull().default("half_month_flat"),
		holidayPayMode: e.holidayPayMode().notNull().default("incremental"),
		rateRoundingMode: e.rateRoundingMode().notNull().default("amounts_only"),

		/* ----------------------------- statutory ----------------------------- */

		/** Override bases; fall back to `monthlyRateCentavos` when null. */
		sssBasisCentavos: bigint({ mode: "number" }),
		philhealthBasisCentavos: bigint({ mode: "number" }),
		pagibigBasisCentavos: bigint({ mode: "number" }),

		sssTiming: e.deductionTiming().notNull().default("first_cutoff"),
		philhealthTiming: e.deductionTiming().notNull().default("first_cutoff"),
		pagibigTiming: e.deductionTiming().notNull().default("first_cutoff"),
		/** Withholding tax is genuinely per-cutoff, unlike the contributions. */
		taxTiming: e.deductionTiming().notNull().default("every_cutoff"),
		taxExempt: boolean().notNull().default(false),

		/* ------------------------- premiums (deferred) ------------------------ */

		/**
		 * Night differential and holiday/rest-day premiums are out of scope for v1.
		 * The columns exist so enabling them later needs no migration; the engine
		 * currently returns zero and flags any day that would have earned one.
		 */
		nightDiffEnabled: boolean().notNull().default(false),
		nightDiffStartMinute: smallint().notNull().default(1320),
		nightDiffEndMinute: smallint().notNull().default(360),
		premiumsEnabled: boolean().notNull().default(false),

		/* ----------------------------- overtime ------------------------------ */

		overtimeRequiresApproval: boolean().notNull().default(true),
		countPreShiftOvertime: boolean().notNull().default(false),
		minOvertimeMinutes: smallint().notNull().default(30),

		/* ------------------------------ punches ------------------------------ */

		graceMinutes: smallint().notNull().default(0),
		/** When true, exceeding grace forfeits it: 08:06 with 5 min grace is 6 late. */
		graceForfeits: boolean().notNull().default(false),
		/** Allow a day recorded as just first-in / last-out, minus the break. */
		allowTwoPunchDay: boolean().notNull().default(true),
		punchRoundingMinutes: smallint().notNull().default(0),
		punchRoundingMode: e.punchRoundingMode().notNull().default("none"),
		missingPunchPolicy: e.missingPunchPolicy().notNull().default("flag_only"),
		unaccountedDayPolicy: e.unaccountedDayPolicy().notNull().default("warn"),

		payDateOffsetDays: smallint().notNull().default(5),
		/** Local holiday regions that apply, matched against `holidays.region`. */
		holidayRegions: text().array().notNull().default(sql`ARRAY[]::text[]`),
		notes: text(),
		...auditCols,
	},
	(t) => [
		uniqueIndex("employment_terms_user_from_uq").on(t.userId, t.effectiveFrom),
		index("employment_terms_lookup_idx").on(t.userId, t.effectiveFrom.desc()),
		check(
			"employment_terms_range_ck",
			sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
		),
		check("employment_terms_factor_ck", sql`${t.workingDaysFactorX100} > 0`),
		check("employment_terms_rate_ck", sql`${t.monthlyRateCentavos} >= 0`),
		check(
			"employment_terms_hours_ck",
			sql`${t.dailyHours} > 0 AND ${t.dailyHours} <= 24`,
		),
	],
);

export const workSchedules = pgTable(
	"work_schedules",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		name: text().notNull().default("Default"),
		effectiveFrom: date({ mode: "string" }).notNull(),
		effectiveTo: date({ mode: "string" }),
		isActive: boolean().notNull().default(true),
		...auditCols,
	},
	(t) => [
		uniqueIndex("work_schedules_user_from_uq").on(t.userId, t.effectiveFrom),
		// Target of the composite FK from work_schedule_days, which makes a
		// cross-tenant child row impossible at the database level rather than
		// merely unlikely. This must be a table CONSTRAINT, not a unique index:
		// drizzle-kit emits foreign keys before indexes, so an index would not
		// yet exist when the FK is added.
		unique("work_schedules_user_id_uq").on(t.userId, t.id),
		check(
			"work_schedules_range_ck",
			sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`,
		),
	],
);

/** One row per weekday. Saturday half-days and four-day weeks fall out of this. */
export const workScheduleDays = pgTable(
	"work_schedule_days",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text().notNull(),
		scheduleId: integer().notNull(),
		/** 0 = Sunday … 6 = Saturday, matching `Date#getUTCDay`. */
		weekday: smallint().notNull(),
		isRestDay: boolean().notNull().default(false),
		/** Minutes since local midnight. */
		amInMinute: smallint(),
		amOutMinute: smallint(),
		pmInMinute: smallint(),
		pmOutMinute: smallint(),
		standardWorkMinutes: smallint().notNull().default(480),
		breakMinutes: smallint().notNull().default(60),
	},
	(t) => [
		uniqueIndex("work_schedule_days_uq").on(t.scheduleId, t.weekday),
		foreignKey({
			columns: [t.userId, t.scheduleId],
			foreignColumns: [workSchedules.userId, workSchedules.id],
			name: "work_schedule_days_schedule_fk",
		}).onDelete("cascade"),
		check("work_schedule_days_weekday_ck", sql`${t.weekday} BETWEEN 0 AND 6`),
		check(
			"work_schedule_days_order_ck",
			sql`
				(${t.amInMinute} IS NULL OR ${t.amOutMinute} IS NULL OR ${t.amOutMinute} >= ${t.amInMinute})
				AND (${t.pmInMinute} IS NULL OR ${t.pmOutMinute} IS NULL OR ${t.pmOutMinute} >= ${t.pmInMinute})
			`,
		),
	],
);
