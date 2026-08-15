/**
 * Domain vocabulary shared by the payroll engine and the database schema.
 *
 * This file is the single source of truth: `src/db/schema/enums.ts` builds its
 * `pgEnum`s from these arrays. The dependency only runs that way — a Biome rule
 * stops anything under `src/lib/payroll/` from importing the schema, which is
 * what keeps the engine pure and testable without a database.
 */

import type { DayMinutes, IsoDate } from "./time.ts";

export const DAY_KINDS = [
	"regular_workday",
	"rest_day",
	"regular_holiday",
	"special_non_working",
	"special_working",
] as const;
export type DayKind = (typeof DAY_KINDS)[number];

export const ATTENDANCE_STATUSES = [
	"present",
	"absent",
	"on_leave",
	"half_day_leave",
	"official_business",
	"no_work",
	"suspended",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const LEAVE_DAY_PORTIONS = ["full", "am", "pm", "custom"] as const;
export type LeaveDayPortion = (typeof LEAVE_DAY_PORTIONS)[number];

export const PUNCH_ROUNDING_MODES = [
	"none",
	"nearest",
	"employee_favored",
	"employer_favored",
] as const;
export type PunchRoundingMode = (typeof PUNCH_ROUNDING_MODES)[number];

export const MISSING_PUNCH_POLICIES = [
	"flag_only",
	"assume_schedule",
	"treat_as_absent",
] as const;
export type MissingPunchPolicy = (typeof MISSING_PUNCH_POLICIES)[number];

export const UNACCOUNTED_DAY_POLICIES = ["warn", "absent"] as const;
export type UnaccountedDayPolicy = (typeof UNACCOUNTED_DAY_POLICIES)[number];

/** Conditions worth surfacing on a row without refusing the entry. */
export const DTR_FLAGS = [
	"missing_punch",
	"out_before_in",
	"no_schedule",
	"two_punch_day",
	"overlapping_sessions",
	"crossed_midnight",
	"unapproved_overtime",
	"future_date",
	"manual_override",
	/** Worked a premium day while premiums are disabled. */
	"holiday_premium_not_applied",
	"rest_day_premium_not_applied",
] as const;
export type DtrFlag = (typeof DTR_FLAGS)[number];

/* -------------------------------------------------------------------------- */

/** The four daily punches, as minutes since local midnight of the work date. */
export interface PunchSet {
	amIn: DayMinutes | null;
	amOut: DayMinutes | null;
	pmIn: DayMinutes | null;
	pmOut: DayMinutes | null;
}

export const EMPTY_PUNCHES: PunchSet = {
	amIn: null,
	amOut: null,
	pmIn: null,
	pmOut: null,
};

/** The schedule in force for a date, frozen onto the record once computed. */
export interface ScheduleSnapshot {
	scheduleId: number;
	amIn: DayMinutes | null;
	amOut: DayMinutes | null;
	pmIn: DayMinutes | null;
	pmOut: DayMinutes | null;
	standardWorkMinutes: number;
	breakMinutes: number;
	isRestDay: boolean;
}

export interface LeaveContext {
	portion: LeaveDayPortion;
	minutes: number;
	/** Only meaningful when `portion` is "custom". */
	startMinute: DayMinutes | null;
	endMinute: DayMinutes | null;
	isPaid: boolean;
}

export interface PunchPolicy {
	graceMinutes: number;
	/** When true, exceeding grace forfeits it entirely. */
	graceForfeits: boolean;
	allowTwoPunchDay: boolean;
	punchRoundingMinutes: number;
	punchRoundingMode: PunchRoundingMode;
	missingPunchPolicy: MissingPunchPolicy;
	minOvertimeMinutes: number;
	overtimeRequiresApproval: boolean;
	countPreShiftOvertime: boolean;
	nightDiffEnabled: boolean;
	nightDiffStartMinute: DayMinutes;
	nightDiffEndMinute: DayMinutes;
	/** Holiday and rest-day multipliers. Off in v1. */
	premiumsEnabled: boolean;
}

export const DEFAULT_PUNCH_POLICY: PunchPolicy = {
	graceMinutes: 0,
	graceForfeits: false,
	allowTwoPunchDay: true,
	punchRoundingMinutes: 0,
	punchRoundingMode: "none",
	missingPunchPolicy: "flag_only",
	minOvertimeMinutes: 30,
	overtimeRequiresApproval: true,
	countPreShiftOvertime: false,
	nightDiffEnabled: false,
	nightDiffStartMinute: 1320,
	nightDiffEndMinute: 360,
	premiumsEnabled: false,
};

export interface DailyMinutes {
	/** Minutes actually inside a punched session — "hours worked". */
	workedMinutes: number;
	/** Standard hours less late, undertime and unpaid time. Informational. */
	creditedRegularMinutes: number;
	lateMinutes: number;
	undertimeMinutes: number;
	overtimeMinutes: number;
	nightDiffMinutes: number;
	nightDiffOvertimeMinutes: number;
	/** Covered by paid leave, so not deducted. */
	paidLeaveMinutes: number;
	/** Scheduled but neither worked nor paid — what drives absence deductions. */
	unpaidMinutes: number;
	flags: DtrFlag[];
}

export interface DailyInput {
	date: IsoDate;
	/** Passed in rather than read from the clock, to keep the engine pure. */
	today: IsoDate;
	punches: PunchSet;
	schedule: ScheduleSnapshot | null;
	dayKind: DayKind;
	status: AttendanceStatus;
	isRestDay: boolean;
	leave: LeaveContext | null;
	policy: PunchPolicy;
	approvedOvertimeMinutes: number | null;
}

export interface DailyResult {
	/** Normalized and safe to persist — midnight crossings already resolved. */
	punches: PunchSet;
	minutes: DailyMinutes;
}
