/**
 * Philippine holidays that are determinate from the calendar alone.
 *
 * Scope is deliberately narrow. Included here are only holidays whose date is
 * fixed by statute or computable by a published rule. Deliberately excluded:
 *
 *  - Eid'l Fitr and Eid'l Adha, whose dates follow lunar observation and are set
 *    by proclamation each year (RA 9177, RA 9849).
 *  - Additional special days a President may proclaim for a given year, such as
 *    Chinese New Year, EDSA anniversary, Christmas Eve or New Year's Eve.
 *
 * Those must be entered by hand once the year's proclamation is published.
 * Generating a plausible-looking date for them would be worse than omitting
 * them: a wrong holiday silently changes what a day is worth.
 *
 * Every generated row carries a citation, and the caller is expected to check
 * the list against the year's official proclamation before relying on it.
 */

import { addDays, dayOfWeek, type IsoDate, toIsoDate } from "./time.ts";

export type PhHolidayKind = "regular" | "special_non_working";

export interface PhHoliday {
	holidayDate: IsoDate;
	name: string;
	kind: PhHolidayKind;
	citation: string;
}

/**
 * Easter Sunday, by the anonymous Gregorian algorithm (Meeus/Jones/Butcher).
 *
 * Maundy Thursday, Good Friday and Black Saturday are all defined relative to
 * it, so this is the only movable-date rule the app needs.
 */
export function easterSunday(year: number): IsoDate {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return toIsoDate(year, month, day);
}

/** National Heroes Day is the last Monday of August. */
export function lastMondayOfAugust(year: number): IsoDate {
	let date = toIsoDate(year, 8, 31);
	while (dayOfWeek(date) !== 1) date = addDays(date, -1);
	return date;
}

const FIXED_REGULAR: Array<[month: number, day: number, name: string]> = [
	[1, 1, "New Year's Day"],
	[4, 9, "Araw ng Kagitingan"],
	[5, 1, "Labor Day"],
	[6, 12, "Independence Day"],
	[11, 30, "Bonifacio Day"],
	[12, 25, "Christmas Day"],
	[12, 30, "Rizal Day"],
];

const FIXED_SPECIAL: Array<
	[month: number, day: number, name: string, citation: string]
> = [
	[8, 21, "Ninoy Aquino Day", "RA 9256"],
	[11, 1, "All Saints' Day", "Administrative Code (EO 292), as amended"],
	[12, 8, "Feast of the Immaculate Conception", "RA 10966"],
	[12, 31, "Last day of the year", "Administrative Code (EO 292), as amended"],
];

const REGULAR_CITATION = "RA 9492, amending the Administrative Code (EO 292)";

/**
 * The determinate Philippine holidays for a year, sorted by date.
 *
 * See the module note for what is intentionally missing.
 */
export function phHolidaysForYear(year: number): PhHoliday[] {
	const easter = easterSunday(year);

	const holidays: PhHoliday[] = [
		...FIXED_REGULAR.map(([month, day, name]) => ({
			holidayDate: toIsoDate(year, month, day),
			name,
			kind: "regular" as const,
			citation: REGULAR_CITATION,
		})),
		{
			holidayDate: addDays(easter, -3),
			name: "Maundy Thursday",
			kind: "regular",
			citation: REGULAR_CITATION,
		},
		{
			holidayDate: addDays(easter, -2),
			name: "Good Friday",
			kind: "regular",
			citation: REGULAR_CITATION,
		},
		{
			holidayDate: lastMondayOfAugust(year),
			name: "National Heroes Day",
			kind: "regular",
			citation: REGULAR_CITATION,
		},
		{
			holidayDate: addDays(easter, -1),
			name: "Black Saturday",
			kind: "special_non_working",
			citation: "Administrative Code (EO 292), as amended",
		},
		...FIXED_SPECIAL.map(([month, day, name, citation]) => ({
			holidayDate: toIsoDate(year, month, day),
			name,
			kind: "special_non_working" as const,
			citation,
		})),
	];

	return holidays.sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
}

/** Holidays this generator cannot determine, surfaced to the user as a prompt. */
export const PROCLAMATION_ONLY_HOLIDAYS = [
	"Eid'l Fitr (lunar observation, proclaimed annually)",
	"Eid'l Adha (lunar observation, proclaimed annually)",
	"Chinese New Year (proclaimed annually)",
	"EDSA People Power Anniversary (proclaimed annually)",
	"Christmas Eve and New Year's Eve (proclaimed in some years)",
] as const;
