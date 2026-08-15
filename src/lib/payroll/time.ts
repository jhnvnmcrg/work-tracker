/**
 * Date and clock-time primitives for the payroll engine.
 *
 * Two invariants hold everywhere in this file, and breaking either one produces
 * bugs that only reproduce on a server in a different timezone:
 *
 *  1. A business date is the string "YYYY-MM-DD", never a JS `Date`. `Date`s
 *     only appear as a local implementation detail inside these functions.
 *  2. All date arithmetic uses `Date.UTC` / `getUTC*`. A bare `getDay()` or
 *     `getMonth()` reads the host timezone and would shift entire pay periods.
 *
 * The single exception is {@link todayInManila}, which is the only function
 * permitted to consult the real clock and an IANA timezone.
 */

export const MANILA_TZ = "Asia/Manila";

/** A local calendar date, "YYYY-MM-DD". */
export type IsoDate = string & { readonly __brand: "IsoDate" };

/**
 * Minutes elapsed since local midnight of the anchoring work date.
 *
 * May exceed 1440: a shift that clocks out at 01:30 the next morning is 1530,
 * which keeps the record anchored to the date the shift started.
 */
export type DayMinutes = number;

export const MINUTES_PER_DAY = 1440;

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isIsoDate(value: string): value is IsoDate {
	return ISO_DATE_RE.test(value);
}

export function assertIsoDate(value: string): IsoDate {
	if (!isIsoDate(value)) {
		throw new Error(`Expected a YYYY-MM-DD date, received "${value}"`);
	}
	return value;
}

export function isMonthKey(value: string): boolean {
	return MONTH_KEY_RE.test(value);
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Builds an IsoDate from calendar parts. `month` is 1-based. */
export function toIsoDate(year: number, month: number, day: number): IsoDate {
	return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}` as IsoDate;
}

/** Splits an IsoDate into parts. `month` is 1-based. */
export function dateParts(date: IsoDate): {
	year: number;
	month: number;
	day: number;
} {
	return {
		year: Number(date.slice(0, 4)),
		month: Number(date.slice(5, 7)),
		day: Number(date.slice(8, 10)),
	};
}

/** Epoch milliseconds at UTC midnight of the date. Internal use only. */
function toUtcMs(date: IsoDate): number {
	const { year, month, day } = dateParts(date);
	return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): IsoDate {
	const d = new Date(ms);
	return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
	return new Date(toUtcMs(date)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function addDays(date: IsoDate, days: number): IsoDate {
	return fromUtcMs(toUtcMs(date) + days * 86_400_000);
}

/** Whole days from `from` to `to`. Negative when `to` precedes `from`. */
export function diffDays(from: IsoDate, to: IsoDate): number {
	return Math.round((toUtcMs(to) - toUtcMs(from)) / 86_400_000);
}

/** Every date from `start` to `end`, inclusive. Empty if `end` precedes `start`. */
export function eachDate(start: IsoDate, end: IsoDate): IsoDate[] {
	const out: IsoDate[] = [];
	const last = toUtcMs(end);
	for (let ms = toUtcMs(start); ms <= last; ms += 86_400_000) {
		out.push(fromUtcMs(ms));
	}
	return out;
}

/** `month` is 1-based. Handles leap years. */
export function daysInMonth(year: number, month: number): number {
	// Day 0 of the following month is the last day of this one.
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM" for the month containing `date`. */
export function monthKeyOf(date: IsoDate): string {
	return date.slice(0, 7);
}

export function parseMonthKey(monthKey: string): {
	year: number;
	month: number;
} {
	if (!isMonthKey(monthKey)) {
		throw new Error(`Expected a YYYY-MM month key, received "${monthKey}"`);
	}
	return {
		year: Number(monthKey.slice(0, 4)),
		month: Number(monthKey.slice(5, 7)),
	};
}

/**
 * Today's calendar date in Manila, independent of where the server runs.
 *
 * The only function here that consults the real clock or an IANA timezone.
 */
export function todayInManila(now: Date = new Date()): IsoDate {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: MANILA_TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);

	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);

	return toIsoDate(get("year"), get("month"), get("day"));
}

/* ------------------------------------------------------------------------- */
/* Pay periods: the 1–16 and 17–end-of-month cutoffs                          */
/* ------------------------------------------------------------------------- */

/** 1 = the 1st–16th cutoff. 2 = the 17th–end-of-month cutoff. */
export type CutoffHalf = 1 | 2;

export interface CutoffBounds {
	year: number;
	month: number;
	half: CutoffHalf;
	start: IsoDate;
	end: IsoDate;
	/** Always 16 for the first cutoff; 12–15 for the second. */
	dayCount: number;
	/** "2026-08-1" — stable key for routes and caches. */
	periodKey: string;
}

/**
 * Resolves a cutoff to concrete dates.
 *
 * The first cutoff is always exactly 16 days. The second runs from the 17th to
 * the last day of the month, so it is 12 days in a common February, 13 in a
 * leap February, and 14 or 15 otherwise.
 */
export function cutoffBounds(
	year: number,
	month: number,
	half: CutoffHalf,
): CutoffBounds {
	if (!Number.isInteger(month) || month < 1 || month > 12) {
		throw new Error(`Month must be 1-12, received ${month}`);
	}

	const lastDay = daysInMonth(year, month);
	const start = half === 1 ? 1 : 17;
	const end = half === 1 ? 16 : lastDay;

	return {
		year,
		month,
		half,
		start: toIsoDate(year, month, start),
		end: toIsoDate(year, month, end),
		dayCount: end - start + 1,
		periodKey: `${String(year).padStart(4, "0")}-${pad2(month)}-${half}`,
	};
}

/** Which cutoff a date falls in. The 16th is the first, the 17th the second. */
export function cutoffForDate(date: IsoDate): CutoffBounds {
	const { year, month, day } = dateParts(date);
	return cutoffBounds(year, month, day <= 16 ? 1 : 2);
}

const PERIOD_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])-([12])$/;

export function parsePeriodKey(periodKey: string): CutoffBounds {
	const match = PERIOD_KEY_RE.exec(periodKey);
	if (!match) {
		throw new Error(
			`Expected a period key like "2026-08-1", received "${periodKey}"`,
		);
	}
	return cutoffBounds(
		Number(match[1]),
		Number(match[2]),
		Number(match[3]) as CutoffHalf,
	);
}

/** The cutoff following `bounds`, rolling into the next year after December. */
export function nextCutoff(bounds: CutoffBounds): CutoffBounds {
	if (bounds.half === 1) return cutoffBounds(bounds.year, bounds.month, 2);
	return bounds.month === 12
		? cutoffBounds(bounds.year + 1, 1, 1)
		: cutoffBounds(bounds.year, bounds.month + 1, 1);
}

/** The cutoff preceding `bounds`, rolling back into the previous year. */
export function previousCutoff(bounds: CutoffBounds): CutoffBounds {
	if (bounds.half === 2) return cutoffBounds(bounds.year, bounds.month, 1);
	return bounds.month === 1
		? cutoffBounds(bounds.year - 1, 12, 2)
		: cutoffBounds(bounds.year, bounds.month - 1, 2);
}

/* ------------------------------------------------------------------------- */
/* Clock times                                                                */
/* ------------------------------------------------------------------------- */

const TIME_INPUT_RE = /^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/;

/**
 * Parses the shorthand people actually type into a DTR grid.
 *
 * Accepts `8`, `800`, `0800`, `8:00`, `8a`, `8am`, `1pm`, `13:00`, `12:30pm`.
 * Returns minutes since midnight, or `null` when the input is not a time.
 *
 * An empty string returns `null` — callers treat that as "clear this punch",
 * which is distinct from an invalid entry only in that it does not warn.
 */
export function parseTimeInput(raw: string): DayMinutes | null {
	const value = raw.trim().toLowerCase().replace(/\./g, "");
	if (value === "") return null;

	const match = TIME_INPUT_RE.exec(value);
	if (!match) return null;

	const [, headRaw, tailRaw, meridiemRaw] = match;
	// The regex backtracks so packed forms split correctly without a separate
	// branch: "800" -> 8 + "00", "830" -> 8 + "30", "1230" -> 12 + "30".
	let hours = Number(headRaw);
	const minutes = tailRaw === undefined ? 0 : Number(tailRaw);

	if (minutes > 59) return null;

	if (meridiemRaw) {
		if (hours < 1 || hours > 12) return null;
		const isPm = meridiemRaw.startsWith("p");
		if (hours === 12) hours = isPm ? 12 : 0;
		else if (isPm) hours += 12;
	} else if (hours > 23) {
		return null;
	}

	return hours * 60 + minutes;
}

/**
 * Renders minutes-since-midnight as "HH:mm", marking a next-day time.
 *
 * 482 -> "08:02"; 1530 -> "01:30 (+1d)".
 */
export function formatHHmm(minutes: DayMinutes): string {
	const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
	const withinDay =
		((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	const base = `${pad2(Math.floor(withinDay / 60))}:${pad2(withinDay % 60)}`;
	if (dayOffset === 0) return base;
	return `${base} (${dayOffset > 0 ? "+" : ""}${dayOffset}d)`;
}

/** Renders a duration in minutes as "8h 03m". Never negative-formats. */
export function formatDuration(minutes: number): string {
	const sign = minutes < 0 ? "-" : "";
	const abs = Math.abs(minutes);
	return `${sign}${Math.floor(abs / 60)}h ${pad2(abs % 60)}m`;
}

/** Minutes shared by the half-open intervals [aStart, aEnd) and [bStart, bEnd). */
export function overlapMinutes(
	aStart: number,
	aEnd: number,
	bStart: number,
	bEnd: number,
): number {
	return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}
