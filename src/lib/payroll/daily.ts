/**
 * Turns the four daily punches into minutes.
 *
 * This is where the subtle bugs live, so the module is pure: it takes plain
 * data and returns plain data, with no clock and no database. `today` is an
 * input precisely so "is this in the future?" stays deterministic.
 */

import { MINUTES_PER_DAY, overlapMinutes } from "./time.ts";
import type {
	DailyInput,
	DailyMinutes,
	DailyResult,
	DtrFlag,
	LeaveContext,
	PunchPolicy,
	PunchSet,
	ScheduleSnapshot,
} from "./types.ts";

/**
 * Largest gap allowed between two consecutive punches when resolving a midnight
 * crossing. A night shift clocking out at 01:30 is a few hours past the previous
 * punch; a transposed-digit typo would imply nearly a full day, and gets flagged
 * instead of silently becoming a 23-hour session.
 */
const MAX_PUNCH_GAP_MINUTES = 16 * 60;

/** Upper bound standing in for "end of day" in interval maths. */
const DAY_END = 2 * MINUTES_PER_DAY;

const PUNCH_ORDER = ["amIn", "amOut", "pmIn", "pmOut"] as const;

/** An `[start, end)` span of worked time. */
interface Session {
	start: number;
	end: number;
}

function roundPunch(
	minute: number,
	step: number,
	mode: PunchPolicy["punchRoundingMode"],
	isClockIn: boolean,
): number {
	if (step <= 0 || mode === "none") return minute;
	const down = Math.floor(minute / step) * step;
	const up = Math.ceil(minute / step) * step;
	switch (mode) {
		case "nearest":
			return minute - down < up - minute ? down : up;
		// Favouring the employee means starting the clock earlier and stopping it
		// later; favouring the employer does the reverse.
		case "employee_favored":
			return isClockIn ? down : up;
		case "employer_favored":
			return isClockIn ? up : down;
	}
}

/**
 * Resolves midnight crossings and applies rounding.
 *
 * Punches are stored relative to midnight of the *work date*, so a clock-out at
 * 01:30 the next morning becomes 1530 rather than moving to another row. That is
 * what keeps a night shift's cutoff assignment unambiguous.
 */
export function normalizePunches(
	punches: PunchSet,
	policy: PunchPolicy,
): { punches: PunchSet; flags: DtrFlag[] } {
	const flags = new Set<DtrFlag>();
	const out: PunchSet = { ...punches };
	let previous: number | null = null;

	for (const key of PUNCH_ORDER) {
		const raw = out[key];
		if (raw === null || raw === undefined) continue;

		const isClockIn = key === "amIn" || key === "pmIn";
		let value = roundPunch(
			raw,
			policy.punchRoundingMinutes,
			policy.punchRoundingMode,
			isClockIn,
		);

		if (previous !== null && value < previous) {
			const bumped = value + MINUTES_PER_DAY;
			if (bumped - previous <= MAX_PUNCH_GAP_MINUTES) {
				value = bumped;
				flags.add("crossed_midnight");
			} else {
				flags.add("out_before_in");
			}
		}

		out[key] = value;
		previous = value;
	}

	return { punches: out, flags: [...flags] };
}

function fillFromSchedule(
	punches: PunchSet,
	schedule: ScheduleSnapshot | null,
): PunchSet {
	if (!schedule) return punches;
	const filled = { ...punches };
	if (
		filled.amIn !== null &&
		filled.amOut === null &&
		schedule.amOut !== null
	) {
		filled.amOut = schedule.amOut;
	}
	if (filled.amOut !== null && filled.amIn === null && schedule.amIn !== null) {
		filled.amIn = schedule.amIn;
	}
	if (
		filled.pmIn !== null &&
		filled.pmOut === null &&
		schedule.pmOut !== null
	) {
		filled.pmOut = schedule.pmOut;
	}
	if (filled.pmOut !== null && filled.pmIn === null && schedule.pmIn !== null) {
		filled.pmIn = schedule.pmIn;
	}
	return filled;
}

/**
 * Builds worked sessions from punches.
 *
 * The two-punch collapse is checked first: a day recorded as only first-in and
 * last-out is how people actually fill in a paper DTR, and treating it as two
 * broken sessions would throw the whole day away.
 */
function buildSessions(
	punches: PunchSet,
	policy: PunchPolicy,
	schedule: ScheduleSnapshot | null,
): { sessions: Session[]; breakDeduction: number; flags: DtrFlag[] } {
	const flags = new Set<DtrFlag>();
	const { amIn, amOut, pmIn, pmOut } = punches;

	const isTwoPunchDay =
		policy.allowTwoPunchDay &&
		amIn !== null &&
		pmOut !== null &&
		amOut === null &&
		pmIn === null;

	if (isTwoPunchDay) {
		flags.add("two_punch_day");
		return {
			sessions: [{ start: amIn, end: pmOut }],
			breakDeduction: schedule?.breakMinutes ?? 0,
			flags: [...flags],
		};
	}

	const sessions: Session[] = [];

	if (amIn !== null && amOut !== null) {
		if (amOut > amIn) sessions.push({ start: amIn, end: amOut });
	} else if (amIn !== null || amOut !== null) {
		flags.add("missing_punch");
	}

	if (pmIn !== null && pmOut !== null) {
		if (pmOut > pmIn) sessions.push({ start: pmIn, end: pmOut });
	} else if (pmIn !== null || pmOut !== null) {
		flags.add("missing_punch");
	}

	if (
		amOut !== null &&
		pmIn !== null &&
		pmIn < amOut &&
		!flags.has("out_before_in")
	) {
		flags.add("overlapping_sessions");
	}

	return { sessions, breakDeduction: 0, flags: [...flags] };
}

/**
 * Lateness against a scheduled start.
 *
 * `graceForfeits` is the difference between a courtesy and a threshold: with
 * five minutes of grace, arriving at 08:06 is one minute late under a courtesy
 * and six minutes late under a threshold.
 */
function lateAgainst(
	actualIn: number | null,
	scheduledIn: number | null,
	policy: PunchPolicy,
): number {
	if (actualIn === null || scheduledIn === null) return 0;
	const raw = actualIn - scheduledIn;
	if (raw <= 0) return 0;
	if (raw <= policy.graceMinutes) return 0;
	return policy.graceForfeits ? raw : raw - policy.graceMinutes;
}

function undertimeAgainst(
	actualOut: number | null,
	scheduledOut: number | null,
): number {
	if (actualOut === null || scheduledOut === null) return 0;
	return Math.max(0, scheduledOut - actualOut);
}

/**
 * Which halves of the day a leave record excuses.
 *
 * This is why `leaveRequestDays.portion` exists rather than a bare minute count:
 * a morning half-day must forgive a late morning arrival while still holding the
 * afternoon session to the schedule.
 */
function excusedHalves(
	leave: LeaveContext | null,
	schedule: ScheduleSnapshot | null,
): { am: boolean; pm: boolean } {
	if (!leave) return { am: false, pm: false };
	switch (leave.portion) {
		case "full":
			return { am: true, pm: true };
		case "am":
			return { am: true, pm: false };
		case "pm":
			return { am: false, pm: true };
		case "custom": {
			const { startMinute: s, endMinute: e } = leave;
			if (s === null || e === null || !schedule)
				return { am: false, pm: false };
			const covers = (from: number | null, to: number | null) =>
				from !== null && to !== null && s <= from && e >= to;
			return {
				am: covers(schedule.amIn, schedule.amOut),
				pm: covers(schedule.pmIn, schedule.pmOut),
			};
		}
	}
}

/** Minutes of `sessions` falling inside `[from, to)`. */
function minutesWithin(sessions: Session[], from: number, to: number): number {
	let total = 0;
	for (const s of sessions) total += overlapMinutes(s.start, s.end, from, to);
	return total;
}

/**
 * Night-differential minutes.
 *
 * The extended-minutes representation pays off here: a window that wraps
 * midnight is a single interval `[1320, 1800)` rather than a special case, and
 * the early hours of the work date itself are `[0, 360)`.
 */
function nightMinutes(
	sessions: Session[],
	policy: PunchPolicy,
	restrictTo?: { from: number; to: number },
): number {
	if (!policy.nightDiffEnabled) return 0;
	const windows: Array<[number, number]> = [
		[0, policy.nightDiffEndMinute],
		[policy.nightDiffStartMinute, policy.nightDiffEndMinute + MINUTES_PER_DAY],
	];
	let total = 0;
	for (const s of sessions) {
		const start = restrictTo ? Math.max(s.start, restrictTo.from) : s.start;
		const end = restrictTo ? Math.min(s.end, restrictTo.to) : s.end;
		if (end <= start) continue;
		for (const [wFrom, wTo] of windows) {
			total += overlapMinutes(start, end, wFrom, wTo);
		}
	}
	return total;
}

/** Statuses where the user is away but the day is not deducted. */
const FULLY_EXCUSED_STATUSES = new Set(["official_business", "suspended"]);

export function computeDailyMinutes(input: DailyInput): DailyResult {
	const { policy, schedule, leave, status } = input;
	const flags = new Set<DtrFlag>();

	if (!schedule) flags.add("no_schedule");
	if (input.date > input.today) flags.add("future_date");

	const normalized = normalizePunches(input.punches, policy);
	for (const f of normalized.flags) flags.add(f);

	const effectivePunches =
		policy.missingPunchPolicy === "assume_schedule"
			? fillFromSchedule(normalized.punches, schedule)
			: normalized.punches;

	const built = buildSessions(effectivePunches, policy, schedule);
	for (const f of built.flags) flags.add(f);

	// A punch pair that failed to resolve contributes nothing rather than a
	// negative or absurd duration.
	const sessions = flags.has("out_before_in") ? [] : built.sessions;

	const standard = schedule?.standardWorkMinutes ?? 0;
	const rawWorked = sessions.reduce((sum, s) => sum + (s.end - s.start), 0);
	const workedMinutes = Math.max(0, rawWorked - built.breakDeduction);

	const excused = excusedHalves(leave, schedule);
	const isAbsent = status === "absent";
	const isFullyExcused = FULLY_EXCUSED_STATUSES.has(status);

	/* ------------------------------ late / undertime ---------------------- */

	let lateMinutes = 0;
	let undertimeMinutes = 0;

	if (!isAbsent && !isFullyExcused && schedule) {
		if (built.flags.includes("two_punch_day")) {
			// Only the outer bounds are observable on a two-punch day.
			if (!excused.am) {
				lateMinutes += lateAgainst(
					effectivePunches.amIn,
					schedule.amIn,
					policy,
				);
			}
			if (!excused.pm) {
				undertimeMinutes += undertimeAgainst(
					effectivePunches.pmOut,
					schedule.pmOut,
				);
			}
		} else {
			if (!excused.am) {
				lateMinutes += lateAgainst(
					effectivePunches.amIn,
					schedule.amIn,
					policy,
				);
				undertimeMinutes += undertimeAgainst(
					effectivePunches.amOut,
					schedule.amOut,
				);
			}
			if (!excused.pm) {
				lateMinutes += lateAgainst(
					effectivePunches.pmIn,
					schedule.pmIn,
					policy,
				);
				undertimeMinutes += undertimeAgainst(
					effectivePunches.pmOut,
					schedule.pmOut,
				);
			}
		}
	}

	/* ------------------------------ paid / unpaid ------------------------- */

	let paidLeaveMinutes = 0;
	let unpaidMinutes = 0;

	if (isAbsent) {
		lateMinutes = 0;
		undertimeMinutes = 0;
		unpaidMinutes = standard;
	} else if (isFullyExcused) {
		paidLeaveMinutes = standard;
	} else if (leave) {
		if (leave.isPaid) paidLeaveMinutes = leave.minutes;
		else unpaidMinutes = leave.minutes;
	} else if (
		sessions.length === 0 &&
		standard > 0 &&
		!schedule?.isRestDay &&
		!input.isRestDay &&
		status === "present" &&
		// A future workday is simply not filled in yet, not a gap in the record.
		input.date <= input.today
	) {
		// A scheduled workday recorded with no usable punches. Under the default
		// policy this is a data-entry gap, not an absence, so nothing is deducted
		// and the payslip surfaces it as a warning instead.
		flags.add("missing_punch");
		if (policy.missingPunchPolicy === "treat_as_absent") {
			unpaidMinutes = standard;
		}
	}

	/* --------------------------------- overtime --------------------------- */

	const isRestDay = input.isRestDay || schedule?.isRestDay === true;
	let overtimeRaw = 0;
	let otRegion: { from: number; to: number } | null = null;

	if (isRestDay || !schedule || schedule.pmOut === null) {
		// No scheduled window, so every worked minute is beyond it.
		overtimeRaw = workedMinutes;
		otRegion = { from: 0, to: DAY_END };
	} else {
		overtimeRaw = minutesWithin(sessions, schedule.pmOut, DAY_END);
		otRegion = { from: schedule.pmOut, to: DAY_END };
		if (policy.countPreShiftOvertime && schedule.amIn !== null) {
			overtimeRaw += minutesWithin(sessions, 0, schedule.amIn);
		}
	}

	let overtimeMinutes =
		overtimeRaw < policy.minOvertimeMinutes ? 0 : overtimeRaw;

	if (policy.overtimeRequiresApproval && overtimeMinutes > 0) {
		const approved = input.approvedOvertimeMinutes ?? 0;
		if (overtimeMinutes > approved) {
			flags.add("unapproved_overtime");
			overtimeMinutes = approved;
		}
	}

	/* ---------------------------- night differential ---------------------- */

	const nightDiffMinutes = nightMinutes(sessions, policy);
	const nightDiffOvertimeMinutes = otRegion
		? Math.min(nightMinutes(sessions, policy, otRegion), overtimeMinutes)
		: 0;

	/* ------------------------------- premium flags ------------------------ */

	if (workedMinutes > 0 && !policy.premiumsEnabled) {
		if (
			input.dayKind === "regular_holiday" ||
			input.dayKind === "special_non_working"
		) {
			flags.add("holiday_premium_not_applied");
		}
		if (isRestDay) flags.add("rest_day_premium_not_applied");
	}

	const creditedRegularMinutes = Math.max(
		0,
		standard - lateMinutes - undertimeMinutes - unpaidMinutes,
	);

	const minutes: DailyMinutes = {
		workedMinutes,
		creditedRegularMinutes,
		lateMinutes,
		undertimeMinutes,
		overtimeMinutes,
		nightDiffMinutes,
		nightDiffOvertimeMinutes,
		paidLeaveMinutes,
		unpaidMinutes,
		flags: [...flags].sort(),
	};

	return { punches: normalized.punches, minutes };
}
