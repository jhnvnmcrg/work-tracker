/**
 * Expanding a leave request into the individual days it consumes.
 *
 * Pure: the caller supplies the schedule and holiday lookups, so this is
 * testable without a database and behaves identically on the server and in an
 * optimistic client update.
 */

import { eachDate, type IsoDate } from "./time.ts";
import type { LeaveDayPortion, ScheduleSnapshot } from "./types.ts";

export interface ExpandedLeaveDay {
	leaveDate: IsoDate;
	portion: LeaveDayPortion;
	minutes: number;
	startMinute: number | null;
	endMinute: number | null;
	isPaid: boolean;
}

export type SkipReason = "rest_day" | "holiday" | "no_schedule";

export interface LeaveExpansion {
	days: ExpandedLeaveDay[];
	skipped: Array<{ date: IsoDate; reason: SkipReason }>;
	totalMinutes: number;
}

export interface LeaveExpansionInput {
	startDate: IsoDate;
	endDate: IsoDate;
	/** Leave begins at midday on the first day — that day is an afternoon. */
	halfDayStart: boolean;
	/** Leave ends at midday on the last day — that day is a morning. */
	halfDayEnd: boolean;
	isPaid: boolean;
	scheduleFor: (date: IsoDate) => ScheduleSnapshot | null;
	isHoliday: (date: IsoDate) => boolean;
}

function amMinutes(schedule: ScheduleSnapshot): number {
	if (schedule.amIn !== null && schedule.amOut !== null) {
		return schedule.amOut - schedule.amIn;
	}
	return Math.floor(schedule.standardWorkMinutes / 2);
}

function pmMinutes(schedule: ScheduleSnapshot): number {
	if (schedule.pmIn !== null && schedule.pmOut !== null) {
		return schedule.pmOut - schedule.pmIn;
	}
	return schedule.standardWorkMinutes - amMinutes(schedule);
}

/**
 * Expands a date range into the working days it actually consumes.
 *
 * Rest days and holidays are skipped rather than deducted: taking three days of
 * vacation over a weekend must not cost five days of credit, and a holiday is
 * already non-working. The skipped days are returned so the UI can say why the
 * request cost less than the span suggests.
 */
export function expandLeaveRange(input: LeaveExpansionInput): LeaveExpansion {
	const dates = eachDate(input.startDate, input.endDate);
	const days: ExpandedLeaveDay[] = [];
	const skipped: LeaveExpansion["skipped"] = [];

	for (const date of dates) {
		const schedule = input.scheduleFor(date);
		if (!schedule) {
			skipped.push({ date, reason: "no_schedule" });
			continue;
		}
		if (schedule.isRestDay) {
			skipped.push({ date, reason: "rest_day" });
			continue;
		}
		if (input.isHoliday(date)) {
			skipped.push({ date, reason: "holiday" });
			continue;
		}
		days.push({
			leaveDate: date,
			portion: "full",
			minutes: schedule.standardWorkMinutes,
			startMinute: null,
			endMinute: null,
			isPaid: input.isPaid,
		});
	}

	if (days.length > 0) {
		// Half days apply to the first and last *consumed* days, which are not
		// necessarily the requested endpoints once weekends have been dropped.
		const first = days[0];
		const last = days[days.length - 1];
		const isSingleDay = days.length === 1;

		const applyHalf = (
			day: ExpandedLeaveDay,
			portion: Exclude<LeaveDayPortion, "full" | "custom">,
		) => {
			const schedule = input.scheduleFor(day.leaveDate);
			if (!schedule) return;
			day.portion = portion;
			day.minutes =
				portion === "am" ? amMinutes(schedule) : pmMinutes(schedule);
		};

		if (isSingleDay) {
			// Both flags on one day is contradictory; a leading half-day wins and
			// the day is treated as an afternoon.
			if (input.halfDayStart) applyHalf(first, "pm");
			else if (input.halfDayEnd) applyHalf(first, "am");
		} else {
			if (input.halfDayStart) applyHalf(first, "pm");
			if (input.halfDayEnd) applyHalf(last, "am");
		}
	}

	return {
		days,
		skipped,
		totalMinutes: days.reduce((sum, day) => sum + day.minutes, 0),
	};
}

/* -------------------------------------------------------------------------- */
/* Balances                                                                    */
/* -------------------------------------------------------------------------- */

export interface LedgerEntry {
	leaveTypeId: number;
	creditYear: number;
	deltaMinutes: number;
}

export interface LeaveBalance {
	leaveTypeId: number;
	creditYear: number;
	earnedMinutes: number;
	usedMinutes: number;
	balanceMinutes: number;
}

/**
 * Balances are always summed from the append-only ledger, never cached.
 *
 * A stored balance column drifts the moment a request is edited or a payslip
 * voided, and reconciling it becomes a recurring source of bugs. At personal
 * scale the sum is free.
 */
export function summarizeBalances(
	entries: readonly LedgerEntry[],
): LeaveBalance[] {
	const byKey = new Map<string, LeaveBalance>();

	for (const entry of entries) {
		const key = `${entry.leaveTypeId}:${entry.creditYear}`;
		let balance = byKey.get(key);
		if (!balance) {
			balance = {
				leaveTypeId: entry.leaveTypeId,
				creditYear: entry.creditYear,
				earnedMinutes: 0,
				usedMinutes: 0,
				balanceMinutes: 0,
			};
			byKey.set(key, balance);
		}
		if (entry.deltaMinutes >= 0) balance.earnedMinutes += entry.deltaMinutes;
		else balance.usedMinutes += -entry.deltaMinutes;
		balance.balanceMinutes += entry.deltaMinutes;
	}

	return [...byKey.values()].sort(
		(a, b) => a.creditYear - b.creditYear || a.leaveTypeId - b.leaveTypeId,
	);
}
