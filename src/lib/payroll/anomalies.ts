/**
 * Deterministic detection of problems in a time record.
 *
 * Detection is code, not a language model. "Three days have no clock-out" is a
 * filter over rows; asking a model to scan them would miss some and invent
 * others, and in a payroll app that is not an acceptable failure mode. It is
 * also unit-testable, costs nothing to run on every page load, keeps working
 * when the AI provider is down, and gives each finding a stable identity so the
 * same gap is not reported twice under different wording.
 *
 * Every anomaly carries a `defaultMessage` the interface renders immediately and
 * a `facts` map holding the only figures that may be quoted about it. When the
 * assistant narrates these, those are the sole numbers it is permitted to use.
 */

import { formatDuration, type IsoDate } from "./time.ts";
import type { DailyMinutes, PunchSet } from "./types.ts";

export const ANOMALY_CODES = [
	"MISSING_TIME_IN",
	"MISSING_TIME_OUT",
	"INCOMPLETE_PUNCHES",
	"NO_RECORD_ON_SCHEDULED_DAY",
	"IMPLAUSIBLE_DURATION",
	"OUT_BEFORE_IN",
	"LATE_SPIKE",
	"OT_SPIKE",
	"CUTOFF_CLOSING_INCOMPLETE",
	"LEAVE_EXPIRING",
	"UNAPPROVED_OVERTIME",
] as const;
export type AnomalyCode = (typeof ANOMALY_CODES)[number];

export type AnomalySeverity = "info" | "warning" | "critical";

export interface Anomaly {
	code: AnomalyCode;
	severity: AnomalySeverity;
	title: string;
	dates: string[];
	/** Pre-computed values. The only figures that may be cited for this finding. */
	facts: Record<string, string>;
	defaultMessage: string;
}

export interface AnomalyDay {
	date: IsoDate;
	punches: PunchSet;
	minutes: DailyMinutes;
	hasRecord: boolean;
	isScheduledWorkday: boolean;
}

export interface AnomalyInput {
	today: IsoDate;
	/** Days in the window being examined, usually the current cutoff. */
	days: AnomalyDay[];
	currentCutoff: { start: string; end: string; daysRemaining: number };
	/** Totals for the same measure over previous periods, oldest first. */
	baseline: {
		lateMinutes: number[];
		overtimeMinutes: number[];
	};
	periodLateMinutes: number;
	periodOvertimeMinutes: number;
	leaveBalances: Array<{
		code: string;
		name: string;
		balanceMinutes: number;
		expiresOn: string | null;
	}>;
	standardWorkMinutes: number;
}

/** A shift longer than this is almost certainly a typo rather than a long day. */
const IMPLAUSIBLE_MINUTES = 16 * 60;
/** Periods of history required before a spike means anything. */
const MIN_BASELINE_PERIODS = 4;
/** Absolute floor for a spike, so identical history does not flag every wobble. */
const MIN_SPIKE_DELTA_MINUTES = 30;
/** How close to the end of a cutoff before unfilled days become urgent. */
const CUTOFF_CLOSING_DAYS = 2;

export function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

/**
 * Median absolute deviation — a spread measure that a single outlier cannot
 * inflate, unlike a standard deviation. The point is that one unusual month
 * should not raise the bar so far that the next one goes unnoticed.
 */
export function medianAbsoluteDeviation(
	values: readonly number[],
	centre = median(values),
): number {
	if (values.length === 0) return 0;
	return median(values.map((value) => Math.abs(value - centre)));
}

/**
 * Whether `current` stands out against the user's own history.
 *
 * Thresholds are relative to the person rather than fixed constants: a
 * consistently late arriver and a punctual one need different bars, and a fixed
 * one would be wrong for both.
 */
export function isSpike(
	current: number,
	history: readonly number[],
): { spike: boolean; median: number; threshold: number } {
	const centre = median(history);
	const spread = medianAbsoluteDeviation(history, centre);
	const threshold = Math.max(
		centre + 2 * spread,
		centre + MIN_SPIKE_DELTA_MINUTES,
	);
	return {
		spike: history.length >= MIN_BASELINE_PERIODS && current > threshold,
		median: centre,
		threshold,
	};
}

function push(
	list: Anomaly[],
	anomaly: Omit<Anomaly, "dates"> & { dates?: string[] },
) {
	list.push({ ...anomaly, dates: anomaly.dates ?? [] });
}

export function detectAnomalies(input: AnomalyInput): Anomaly[] {
	const found: Anomaly[] = [];
	// Only days that have already happened can have a gap in them.
	const elapsed = input.days.filter((day) => day.date <= input.today);

	/* ---------------------------- punch problems --------------------------- */

	const missingOut = elapsed.filter(
		(day) =>
			day.hasRecord &&
			((day.punches.amIn !== null && day.punches.amOut === null) ||
				(day.punches.pmIn !== null && day.punches.pmOut === null)),
	);
	if (missingOut.length > 0) {
		push(found, {
			code: "MISSING_TIME_OUT",
			severity: "critical",
			title: "Missing clock-out",
			dates: missingOut.map((day) => day.date),
			facts: { days: String(missingOut.length) },
			defaultMessage: `${missingOut.length} day(s) have a clock-in with no matching clock-out. Those hours are not being counted.`,
		});
	}

	const missingIn = elapsed.filter(
		(day) =>
			day.hasRecord &&
			((day.punches.amOut !== null && day.punches.amIn === null) ||
				(day.punches.pmOut !== null && day.punches.pmIn === null)),
	);
	if (missingIn.length > 0) {
		push(found, {
			code: "MISSING_TIME_IN",
			severity: "critical",
			title: "Missing clock-in",
			dates: missingIn.map((day) => day.date),
			facts: { days: String(missingIn.length) },
			defaultMessage: `${missingIn.length} day(s) have a clock-out with no matching clock-in.`,
		});
	}

	const outBeforeIn = elapsed.filter((day) =>
		day.minutes.flags.includes("out_before_in"),
	);
	if (outBeforeIn.length > 0) {
		push(found, {
			code: "OUT_BEFORE_IN",
			severity: "critical",
			title: "Times out of order",
			dates: outBeforeIn.map((day) => day.date),
			facts: { days: String(outBeforeIn.length) },
			defaultMessage: `${outBeforeIn.length} day(s) have a clock-out earlier than the matching clock-in, so they count as zero hours.`,
		});
	}

	const implausible = elapsed.filter(
		(day) => day.minutes.workedMinutes > IMPLAUSIBLE_MINUTES,
	);
	if (implausible.length > 0) {
		push(found, {
			code: "IMPLAUSIBLE_DURATION",
			severity: "warning",
			title: "Implausibly long day",
			dates: implausible.map((day) => day.date),
			facts: {
				days: String(implausible.length),
				longest: formatDuration(
					Math.max(...implausible.map((day) => day.minutes.workedMinutes)),
				),
			},
			defaultMessage: `${implausible.length} day(s) record more than 16 hours worked, which usually means a mistyped time.`,
		});
	}

	/* ------------------------------- gaps ---------------------------------- */

	const noRecord = elapsed.filter(
		(day) => day.isScheduledWorkday && !day.hasRecord,
	);
	if (noRecord.length > 0) {
		push(found, {
			code: "NO_RECORD_ON_SCHEDULED_DAY",
			severity: "warning",
			title: "Workday not filled in",
			dates: noRecord.map((day) => day.date),
			facts: { days: String(noRecord.length) },
			defaultMessage: `${noRecord.length} scheduled workday(s) have no entry at all. They are treated as gaps, not absences, so nothing is deducted — but the payslip cannot be finalized until they are filled in.`,
		});
	}

	// The same gap becomes urgent as the cutoff closes.
	if (
		noRecord.length > 0 &&
		input.currentCutoff.daysRemaining <= CUTOFF_CLOSING_DAYS &&
		input.currentCutoff.daysRemaining >= 0
	) {
		push(found, {
			code: "CUTOFF_CLOSING_INCOMPLETE",
			severity: "critical",
			title: "Cutoff closing with gaps",
			dates: noRecord.map((day) => day.date),
			facts: {
				days: String(noRecord.length),
				daysRemaining: String(input.currentCutoff.daysRemaining),
				cutoffEnd: input.currentCutoff.end,
			},
			defaultMessage: `This cutoff ends in ${input.currentCutoff.daysRemaining} day(s) and ${noRecord.length} workday(s) are still blank.`,
		});
	}

	const unapproved = elapsed.filter((day) =>
		day.minutes.flags.includes("unapproved_overtime"),
	);
	if (unapproved.length > 0) {
		push(found, {
			code: "UNAPPROVED_OVERTIME",
			severity: "info",
			title: "Overtime beyond what was approved",
			dates: unapproved.map((day) => day.date),
			facts: { days: String(unapproved.length) },
			defaultMessage: `${unapproved.length} day(s) recorded more overtime than was approved. The excess is not paid.`,
		});
	}

	/* ------------------------------ trends --------------------------------- */

	const lateSpike = isSpike(
		input.periodLateMinutes,
		input.baseline.lateMinutes,
	);
	if (lateSpike.spike) {
		push(found, {
			code: "LATE_SPIKE",
			severity: "info",
			title: "More lateness than usual",
			facts: {
				thisPeriod: formatDuration(input.periodLateMinutes),
				usual: formatDuration(Math.round(lateSpike.median)),
			},
			defaultMessage: `Lateness this period is ${formatDuration(input.periodLateMinutes)} against a usual ${formatDuration(Math.round(lateSpike.median))}.`,
		});
	}

	const otSpike = isSpike(
		input.periodOvertimeMinutes,
		input.baseline.overtimeMinutes,
	);
	if (otSpike.spike) {
		push(found, {
			code: "OT_SPIKE",
			severity: "info",
			title: "More overtime than usual",
			facts: {
				thisPeriod: formatDuration(input.periodOvertimeMinutes),
				usual: formatDuration(Math.round(otSpike.median)),
			},
			defaultMessage: `Overtime this period is ${formatDuration(input.periodOvertimeMinutes)} against a usual ${formatDuration(Math.round(otSpike.median))}.`,
		});
	}

	/* ------------------------------- leave --------------------------------- */

	for (const balance of input.leaveBalances) {
		if (balance.expiresOn === null) continue;
		if (balance.balanceMinutes <= 0) continue;
		if (balance.expiresOn < input.today) continue;

		const daysUntil = Math.round(
			(Date.parse(`${balance.expiresOn}T00:00:00Z`) -
				Date.parse(`${input.today}T00:00:00Z`)) /
				86_400_000,
		);
		if (daysUntil > 60) continue;

		const leaveDays = (
			balance.balanceMinutes / input.standardWorkMinutes
		).toFixed(1);
		push(found, {
			code: "LEAVE_EXPIRING",
			severity: "info",
			title: "Leave credits expiring",
			facts: {
				code: balance.code,
				days: leaveDays,
				expiresOn: balance.expiresOn,
				daysUntil: String(daysUntil),
			},
			defaultMessage: `${leaveDays} day(s) of ${balance.name} expire on ${balance.expiresOn}, in ${daysUntil} day(s).`,
		});
	}

	const order: Record<AnomalySeverity, number> = {
		critical: 0,
		warning: 1,
		info: 2,
	};
	return found.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Stable identity for an anomaly, so the same finding is not reported twice. */
export function anomalyKey(anomaly: Anomaly): string {
	return `${anomaly.code}:${anomaly.dates.join(",")}`;
}
