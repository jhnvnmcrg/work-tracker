import { pgEnum } from "drizzle-orm/pg-core";
import {
	ATTENDANCE_STATUSES,
	DAY_KINDS,
	DEDUCTION_TIMINGS,
	LEAVE_DAY_PORTIONS,
	LINE_ITEM_CATEGORIES,
	LINE_ITEM_SECTIONS,
	MISSING_PUNCH_POLICIES,
	PUNCH_ROUNDING_MODES,
	STATUTORY_KINDS,
	TAX_PERIOD_TYPES,
	UNACCOUNTED_DAY_POLICIES,
} from "#/lib/payroll/types.ts";

/**
 * Domain unions live in Postgres enums; anything expected to churn (line-item
 * codes, audited entity names) stays plain `text`, because adding an enum value
 * later needs `ALTER TYPE ... ADD VALUE`, which cannot run inside a transaction.
 *
 * Unions the payroll engine also reasons about are built from the arrays in
 * `#/lib/payroll/types.ts` so the two definitions cannot drift apart.
 */

/**
 * What the calendar says a day *is*. Derived from the work schedule and holiday
 * table — never typed in by the user.
 *
 * Kept deliberately separate from {@link attendanceStatus}: a regular holiday
 * falling on a scheduled workday is a fact about the calendar, not a claim about
 * whether the user showed up, and collapsing the two makes the pay rules
 * unresolvable.
 */
export const dayKind = pgEnum("day_kind", DAY_KINDS);

/** What the user asserts actually happened that day. */
export const attendanceStatus = pgEnum(
	"attendance_status",
	ATTENDANCE_STATUSES,
);

export const payPeriodHalf = pgEnum("pay_period_half", ["first", "second"]);
export const payPeriodStatus = pgEnum("pay_period_status", ["open", "locked"]);

export const payslipStatus = pgEnum("payslip_status", [
	"draft",
	"finalized",
	"voided",
]);

/** `thirteenth_month` and `final_pay` are reserved; only `regular` is built. */
export const payslipType = pgEnum("payslip_type", [
	"regular",
	"thirteenth_month",
	"final_pay",
	"adjustment",
]);

export const lineItemSection = pgEnum("line_item_section", LINE_ITEM_SECTIONS);

export const lineItemCategory = pgEnum(
	"line_item_category",
	LINE_ITEM_CATEGORIES,
);

/** Which cutoff a monthly deduction is withheld on. */
export const deductionTiming = pgEnum("deduction_timing", DEDUCTION_TIMINGS);

export const holidayKind = pgEnum("holiday_kind", [
	"regular",
	"special_non_working",
	"special_working",
]);

export const holidayScope = pgEnum("holiday_scope", ["national", "local"]);

export const leaveAccrualMode = pgEnum("leave_accrual_mode", [
	"none",
	"monthly",
	"annual",
	"per_cutoff",
]);

export const leaveRequestStatus = pgEnum("leave_request_status", [
	"draft",
	"submitted",
	"approved",
	"rejected",
	"cancelled",
]);

export const leaveDayPortion = pgEnum("leave_day_portion", LEAVE_DAY_PORTIONS);

export const leaveLedgerSource = pgEnum("leave_ledger_source", [
	"opening",
	"accrual",
	"usage",
	"adjustment",
	"forfeiture",
	"conversion",
]);

export const statutoryKind = pgEnum("statutory_kind", STATUTORY_KINDS);

/** BIR publishes a separate withholding table per payroll frequency. */
export const taxPeriodType = pgEnum("tax_period_type", TAX_PERIOD_TYPES);

export const auditAction = pgEnum("audit_action", [
	"create",
	"update",
	"delete",
	"recompute",
	"finalize",
	"void",
	"lock",
	"unlock",
]);

/* --------------------------------- policy -------------------------------- */

export const punchRoundingMode = pgEnum(
	"punch_rounding_mode",
	PUNCH_ROUNDING_MODES,
);

export const rateRoundingMode = pgEnum("rate_rounding_mode", [
	"amounts_only",
	"round_rates",
]);

/**
 * Whether a premium multiplier is added on top of a monthly salary that already
 * covers the day (`incremental`) or replaces it entirely (`gross_up`).
 */
export const holidayPayMode = pgEnum("holiday_pay_mode", [
	"incremental",
	"gross_up",
]);

export const basePaySplitMode = pgEnum("base_pay_split_mode", [
	"half_month_flat",
	"daily_rate_working_days",
	"calendar_proration",
]);

/** A missing punch is a data-entry gap, so the default only flags it. */
export const missingPunchPolicy = pgEnum(
	"missing_punch_policy",
	MISSING_PUNCH_POLICIES,
);

/** Likewise a scheduled workday with no record at all. */
export const unaccountedDayPolicy = pgEnum(
	"unaccounted_day_policy",
	UNACCOUNTED_DAY_POLICIES,
);
