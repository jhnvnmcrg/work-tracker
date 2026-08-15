import type { DailyMinutes, DtrFlag } from "./types.ts";

export interface DtrTotals {
	workedMinutes: number;
	lateMinutes: number;
	undertimeMinutes: number;
	overtimeMinutes: number;
	paidLeaveMinutes: number;
	unpaidMinutes: number;
	daysWithRecord: number;
	daysNeedingAttention: number;
}

/** Flags that mean the record needs fixing, as opposed to merely describing the day. */
export const ATTENTION_FLAGS: ReadonlySet<DtrFlag> = new Set<DtrFlag>([
	"missing_punch",
	"out_before_in",
	"overlapping_sessions",
	"no_schedule",
]);

export function needsAttention(minutes: DailyMinutes): boolean {
	return minutes.flags.some((flag) => ATTENTION_FLAGS.has(flag));
}

/**
 * Rolls a set of days into totals.
 *
 * Deliberately the *only* implementation, used by the server response, by the
 * optimistic client update, and by the per-cutoff filter in the UI. If an
 * optimistic total were computed differently from the server's, the totals bar
 * would show one number on keypress and correct itself a moment later — the
 * single most likely bug on this screen.
 */
export function sumTotals(
	days: ReadonlyArray<{ minutes: DailyMinutes; hasRecord?: boolean }>,
): DtrTotals {
	const totals: DtrTotals = {
		workedMinutes: 0,
		lateMinutes: 0,
		undertimeMinutes: 0,
		overtimeMinutes: 0,
		paidLeaveMinutes: 0,
		unpaidMinutes: 0,
		daysWithRecord: 0,
		daysNeedingAttention: 0,
	};

	for (const day of days) {
		totals.workedMinutes += day.minutes.workedMinutes;
		totals.lateMinutes += day.minutes.lateMinutes;
		totals.undertimeMinutes += day.minutes.undertimeMinutes;
		totals.overtimeMinutes += day.minutes.overtimeMinutes;
		totals.paidLeaveMinutes += day.minutes.paidLeaveMinutes;
		totals.unpaidMinutes += day.minutes.unpaidMinutes;
		if (day.hasRecord) totals.daysWithRecord += 1;
		if (needsAttention(day.minutes)) totals.daysNeedingAttention += 1;
	}

	return totals;
}
