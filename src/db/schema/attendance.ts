import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	smallint,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
/**
 * `DtrFlag` and `ScheduleSnapshot` are owned by the payroll engine — see
 * `#/lib/payroll/types.ts`. Freezing the schedule onto each row is what stops a
 * later schedule edit from silently changing the meaning of historical
 * `lateMinutes` values.
 */
import type { DtrFlag, ScheduleSnapshot } from "#/lib/payroll/types.ts";
import { auditCols } from "./_shared.ts";
import { holidays } from "./calendar.ts";
import * as e from "./enums.ts";
import { userProfiles } from "./identity.ts";

/**
 * One row per work date the user actually entered.
 *
 * Rows are sparse on purpose. A scheduled workday with no row is a *data-entry
 * gap*, not an absence, and silently treating it as one would quietly destroy
 * someone's pay — so the payroll engine reports it as a warning that blocks
 * finalization instead.
 */
export const dailyTimeRecords = pgTable(
	"daily_time_records",
	{
		id: integer().primaryKey().generatedAlwaysAsIdentity(),
		userId: text()
			.notNull()
			.references(() => userProfiles.userId, { onDelete: "cascade" }),
		/** Local calendar day in Asia/Manila. Never a timestamp, never UTC-shifted. */
		workDate: date({ mode: "string" }).notNull(),

		/* ------------------------------- raw entry ----------------------------
		 * Minutes since local midnight OF `workDate`. May exceed 1440 for a shift
		 * that runs past midnight (1530 = 01:30 the next morning), which keeps the
		 * record anchored to the date the shift started and so keeps cutoff
		 * assignment unambiguous.
		 * -------------------------------------------------------------------- */
		amInMinute: smallint(),
		amOutMinute: smallint(),
		pmInMinute: smallint(),
		pmOutMinute: smallint(),

		/* ----------------------------- classification ------------------------ */
		dayKind: e.dayKind().notNull().default("regular_workday"),
		status: e.attendanceStatus().notNull().default("present"),
		isRestDay: boolean().notNull().default(false),
		holidayId: integer().references(() => holidays.id, {
			onDelete: "set null",
		}),
		scheduleId: integer(),
		scheduleSnapshot: jsonb().$type<ScheduleSnapshot>(),

		/* ------------------------------- derived ------------------------------
		 * Denormalized at save time so dashboard aggregates are SQL `SUM()` rather
		 * than JS over a year of rows. Kept honest by `scheduleSnapshot` plus
		 * `computeVersion` and a recompute job.
		 * -------------------------------------------------------------------- */
		/** Minutes actually inside a punched session — what "hours worked" means. */
		workedMinutes: smallint().notNull().default(0),
		/** Minutes payroll credits: standard less late, undertime and unpaid leave. */
		creditedRegularMinutes: smallint().notNull().default(0),
		lateMinutes: smallint().notNull().default(0),
		undertimeMinutes: smallint().notNull().default(0),
		overtimeMinutes: smallint().notNull().default(0),
		approvedOvertimeMinutes: smallint(),
		nightDiffMinutes: smallint().notNull().default(0),
		nightDiffOvertimeMinutes: smallint().notNull().default(0),
		paidLeaveMinutes: smallint().notNull().default(0),
		unpaidMinutes: smallint().notNull().default(0),

		flags: jsonb().$type<DtrFlag[]>().notNull().default(sql`'[]'::jsonb`),
		remarks: text(),
		source: text().notNull().default("manual"),

		/** Bumped when the engine changes, so stale rows are findable. */
		computeVersion: smallint().notNull().default(1),
		computedAt: timestamp({ withTimezone: true, mode: "date" }),
		/** Set on payslip finalize; edits then require an audited unlock. */
		lockedByPayslipId: integer(),
		...auditCols,
	},
	(t) => [
		uniqueIndex("dtr_user_date_uq").on(t.userId, t.workDate),
		index("dtr_user_date_desc_idx").on(t.userId, t.workDate.desc()),
		index("dtr_user_kind_idx").on(t.userId, t.dayKind, t.workDate),
		index("dtr_user_status_idx").on(t.userId, t.status, t.workDate),
		check(
			"dtr_punch_bounds_ck",
			sql`
				coalesce(${t.amInMinute}, 0) BETWEEN 0 AND 2880
				AND coalesce(${t.amOutMinute}, 0) BETWEEN 0 AND 2880
				AND coalesce(${t.pmInMinute}, 0) BETWEEN 0 AND 2880
				AND coalesce(${t.pmOutMinute}, 0) BETWEEN 0 AND 2880
			`,
		),
		check(
			"dtr_punch_order_ck",
			sql`
				(${t.amInMinute} IS NULL OR ${t.amOutMinute} IS NULL OR ${t.amOutMinute} >= ${t.amInMinute})
				AND (${t.pmInMinute} IS NULL OR ${t.pmOutMinute} IS NULL OR ${t.pmOutMinute} >= ${t.pmInMinute})
				AND (${t.amOutMinute} IS NULL OR ${t.pmInMinute} IS NULL OR ${t.pmInMinute} >= ${t.amOutMinute})
			`,
		),
	],
);
