import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { auditCols } from "./_shared.ts";
import * as e from "./enums.ts";
import { userProfiles } from "./identity.ts";

/** Everything needed to reproduce a finalized payslip exactly. */
export type ComputationSnapshot = {
	engineVersion: number;
	employmentTermsId: number;
	scheduleIds: number[];
	statutoryScheduleIds: Record<string, number | null>;
	statutoryBracketIds: Record<string, number | null>;
	premiumRuleIds: number[];
	rates: {
		monthlyCentavos: number;
		workingDaysFactorX100: number;
		dailyMicroCentavos: number;
		hourlyMicroCentavos: number;
		minuteMicroCentavos: number;
	};
	policy: Record<string, string | number | boolean>;
};

export type PayslipWarning = {
	code: string;
	message: string;
	dates?: string[];
	blocksFinalize: boolean;
};

/** Provenance for one payslip line, captured at computation time. */
export type LineItemComputation = {
	/** Human-readable derivation, e.g. "6h00m x P323.28 (hourly x 1.25)". */
	computation: string;
	/** DTR dates that contributed. Empty for lines not derived from attendance. */
	sourceDates: string[];
	/** e.g. "SSS Circular 2025-003, MSC bracket 19". */
	ruleReference: string | null;
};

/**
 * A pay period. The 1–16 / 17–end-of-month rule is enforced by a CHECK
 * constraint rather than left to application convention.
 */
export const payPeriods = pgTable(
	"pay_periods",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		year: smallint().notNull(),
		month: smallint().notNull(),
		half: e.payPeriodHalf().notNull(),
		startDate: date({ mode: "string" }).notNull(),
		endDate: date({ mode: "string" }).notNull(),
		payDate: date({ mode: "string" }).notNull(),
		/** 16 for the first half; 12–15 for the second. */
		dayCount: smallint().notNull(),
		status: e.payPeriodStatus().notNull().default("open"),
		lockedAt: timestamp({ withTimezone: true, mode: "date" }),
		...auditCols,
	},
	(t) => [
		uniqueIndex("pay_periods_user_period_uq").on(
			t.userId,
			t.year,
			t.month,
			t.half,
		),
		// Table constraint, not an index — see the note in identity.ts.
		unique("pay_periods_user_id_uq").on(t.userId, t.id),
		index("pay_periods_user_range_idx").on(t.userId, t.startDate.desc()),
		check("pay_periods_month_ck", sql`${t.month} BETWEEN 1 AND 12`),
		check("pay_periods_year_ck", sql`${t.year} BETWEEN 2000 AND 2100`),
		check(
			"pay_periods_cutoff_ck",
			sql`
				(${t.half} = 'first'
					AND extract(day from ${t.startDate}) = 1
					AND extract(day from ${t.endDate}) = 16)
				OR (${t.half} = 'second'
					AND extract(day from ${t.startDate}) = 17
					AND ${t.endDate} = (date_trunc('month', ${t.startDate}) + interval '1 month - 1 day')::date)
			`,
		),
	],
);

/**
 * A payslip. Drafts are computed on read and never stored; only a finalized
 * payslip is persisted, because it is an immutable financial document that must
 * remain explainable after the contribution tables change.
 */
export const payslips = pgTable(
	"payslips",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		payPeriodId: integer().notNull(),
		type: e.payslipType().notNull().default("regular"),
		status: e.payslipStatus().notNull().default("draft"),

		/* rate basis as it stood at computation time */
		monthlyRateCentavos: bigint({ mode: "number" }).notNull(),
		workingDaysFactorX100: integer("working_days_factor_x100").notNull(),
		dailyRateCentavos: bigint({ mode: "number" }).notNull(),
		hourlyRateCentavos: bigint({ mode: "number" }).notNull(),

		/* minute rollups, so the dashboard can aggregate in SQL */
		daysPresent: smallint().notNull().default(0),
		daysAbsent: smallint().notNull().default(0),
		daysOnLeave: smallint().notNull().default(0),
		daysHoliday: smallint().notNull().default(0),
		regularMinutes: integer().notNull().default(0),
		lateMinutes: integer().notNull().default(0),
		undertimeMinutes: integer().notNull().default(0),
		overtimeMinutes: integer().notNull().default(0),
		nightDiffMinutes: integer().notNull().default(0),
		paidLeaveMinutes: integer().notNull().default(0),

		/* money rollups */
		basePayCentavos: bigint({ mode: "number" }).notNull().default(0),
		totalEarningsCentavos: bigint({ mode: "number" }).notNull().default(0),
		taxableGrossCentavos: bigint({ mode: "number" }).notNull().default(0),
		nonTaxableCentavos: bigint({ mode: "number" }).notNull().default(0),
		grossPayCentavos: bigint({ mode: "number" }).notNull().default(0),
		totalDeductionsCentavos: bigint({ mode: "number" }).notNull().default(0),
		netPayCentavos: bigint({ mode: "number" }).notNull().default(0),

		/* statutory broken out for BIR 2316 and reporting */
		sssEeCentavos: bigint({ mode: "number" }).notNull().default(0),
		sssErCentavos: bigint({ mode: "number" }).notNull().default(0),
		philhealthEeCentavos: bigint({ mode: "number" }).notNull().default(0),
		philhealthErCentavos: bigint({ mode: "number" }).notNull().default(0),
		pagibigEeCentavos: bigint({ mode: "number" }).notNull().default(0),
		pagibigErCentavos: bigint({ mode: "number" }).notNull().default(0),
		withholdingTaxCentavos: bigint({ mode: "number" }).notNull().default(0),

		/* provenance */
		engineVersion: smallint().notNull().default(1),
		computationSnapshot: jsonb().$type<ComputationSnapshot>(),
		warnings: jsonb()
			.$type<PayslipWarning[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		finalizedAt: timestamp({ withTimezone: true, mode: "date" }),
		voidedAt: timestamp({ withTimezone: true, mode: "date" }),
		voidReason: text(),
		...auditCols,
	},
	(t) => [
		// One live regular payslip per period; voided ones may accumulate.
		uniqueIndex("payslips_regular_uq")
			.on(t.userId, t.payPeriodId)
			.where(sql`${t.type} = 'regular' AND ${t.status} <> 'voided'`),
		unique("payslips_user_id_uq").on(t.userId, t.id),
		foreignKey({
			columns: [t.userId, t.payPeriodId],
			foreignColumns: [payPeriods.userId, payPeriods.id],
			name: "payslips_period_fk",
		}).onDelete("cascade"),
		index("payslips_user_status_idx").on(
			t.userId,
			t.status,
			t.finalizedAt.desc(),
		),
		check(
			"payslips_net_ck",
			sql`${t.netPayCentavos} = ${t.grossPayCentavos} - ${t.totalDeductionsCentavos}`,
		),
	],
);

export const payslipLineItems = pgTable(
	"payslip_line_items",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text().notNull(),
		payslipId: integer().notNull(),
		section: e.lineItemSection().notNull(),
		category: e.lineItemCategory().notNull(),
		code: text().notNull(),
		label: text().notNull(),
		/** Minutes or days, per `unit`. Null for fixed amounts. */
		quantity: integer(),
		unit: text(),
		rateMicroCentavos: bigint({ mode: "number" }),
		multiplierPpm: integer(),
		/** Always positive; `section` carries the sign. */
		amountCentavos: bigint({ mode: "number" }).notNull(),

		/**
		 * Deliberately decoupled from `section`.
		 *
		 * Late, undertime and absence are *displayed* under deductions but they
		 * reduce compensation income rather than being deducted from it. Treating
		 * them as ordinary deductions would compute withholding tax on a gross the
		 * employee never earned.
		 */
		reducesTaxableGross: boolean().notNull().default(false),
		isTaxable: boolean().notNull().default(true),
		isStatutory: boolean().notNull().default(false),
		sortOrder: smallint().notNull().default(0),

		/**
		 * Captured at computation time, never recomputed. Re-deriving this later
		 * against current bracket tables would explain an old payslip using new
		 * rules — confidently wrong, and very hard to notice.
		 */
		computation: jsonb().$type<LineItemComputation>(),
		sourceType: text(),
		sourceId: integer(),
		meta: jsonb(),
	},
	(t) => [
		index("payslip_line_items_payslip_idx").on(t.payslipId, t.sortOrder),
		index("payslip_line_items_user_cat_idx").on(t.userId, t.category),
		foreignKey({
			columns: [t.userId, t.payslipId],
			foreignColumns: [payslips.userId, payslips.id],
			name: "payslip_line_items_payslip_fk",
		}).onDelete("cascade"),
		check("payslip_line_items_amount_ck", sql`${t.amountCentavos} >= 0`),
	],
);

/** Standing allowances, de minimis benefits, and loan amortizations. */
export const recurringAdjustments = pgTable(
	"recurring_adjustments",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		section: e.lineItemSection().notNull(),
		category: e.lineItemCategory().notNull(),
		code: text().notNull(),
		label: text().notNull(),
		amountCentavos: bigint({ mode: "number" }).notNull(),
		isTaxable: boolean().notNull().default(true),
		timing: e.deductionTiming().notNull().default("every_cutoff"),
		effectiveFrom: date({ mode: "string" }).notNull(),
		effectiveTo: date({ mode: "string" }),

		/* loan support */
		principalCentavos: bigint({ mode: "number" }),
		remainingCentavos: bigint({ mode: "number" }),
		installmentsTotal: smallint(),
		installmentsPaid: smallint().notNull().default(0),

		isActive: boolean().notNull().default(true),
		notes: text(),
		...auditCols,
	},
	(t) => [
		index("recurring_adjustments_lookup_idx").on(
			t.userId,
			t.isActive,
			t.effectiveFrom,
		),
		uniqueIndex("recurring_adjustments_code_uq").on(
			t.userId,
			t.code,
			t.effectiveFrom,
		),
		check("recurring_adjustments_amount_ck", sql`${t.amountCentavos} >= 0`),
	],
);
