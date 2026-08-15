import { afterAll, describe, expect, it } from "vitest";
import {
	addDays,
	assertIsoDate,
	cutoffBounds,
	cutoffForDate,
	dayOfWeek,
	daysInMonth,
	diffDays,
	eachDate,
	formatDuration,
	formatHHmm,
	monthKeyOf,
	nextCutoff,
	overlapMinutes,
	parsePeriodKey,
	parseTimeInput,
	previousCutoff,
	todayInManila,
	toIsoDate,
} from "./time.ts";

const d = assertIsoDate;

/* ------------------------------------------------------------------------- */
/* Timezone invariance                                                        */
/*                                                                            */
/* The highest-value test here. A single `getDay()` in place of `getUTCDay()`  */
/* shifts an entire month's cutoff assignment, and it only reproduces on a     */
/* server west of UTC. Node applies `process.env.TZ` changes at runtime, so    */
/* the whole suite can be replayed under several zones in-process.            */
/* ------------------------------------------------------------------------- */

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
	process.env.TZ = ORIGINAL_TZ;
});

describe.each([
	"UTC",
	"Asia/Manila",
	"America/New_York",
	"Pacific/Kiritimati",
])("timezone invariance under TZ=%s", (tz) => {
	const withTz = <T>(fn: () => T): T => {
		process.env.TZ = tz;
		try {
			return fn();
		} finally {
			process.env.TZ = ORIGINAL_TZ;
		}
	};

	it("keeps day-of-week stable", () => {
		// 2026-08-15 is a Saturday.
		expect(withTz(() => dayOfWeek(d("2026-08-15")))).toBe(6);
		expect(withTz(() => dayOfWeek(d("2026-08-17")))).toBe(1);
		expect(withTz(() => dayOfWeek(d("2026-01-01")))).toBe(4);
	});

	it("keeps date arithmetic stable across month and year edges", () => {
		expect(withTz(() => addDays(d("2026-08-31"), 1))).toBe("2026-09-01");
		expect(withTz(() => addDays(d("2026-12-31"), 1))).toBe("2027-01-01");
		expect(withTz(() => addDays(d("2026-01-01"), -1))).toBe("2025-12-31");
		// 2028 is a leap year.
		expect(withTz(() => addDays(d("2028-02-28"), 1))).toBe("2028-02-29");
		expect(withTz(() => addDays(d("2026-02-28"), 1))).toBe("2026-03-01");
	});

	it("keeps cutoff resolution stable", () => {
		expect(withTz(() => cutoffForDate(d("2026-08-16")).half)).toBe(1);
		expect(withTz(() => cutoffForDate(d("2026-08-17")).half)).toBe(2);
		expect(withTz(() => cutoffBounds(2026, 2, 2).dayCount)).toBe(12);
	});

	it("keeps eachDate stable", () => {
		const range = withTz(() => eachDate(d("2026-02-26"), d("2026-03-02")));
		expect(range).toEqual([
			"2026-02-26",
			"2026-02-27",
			"2026-02-28",
			"2026-03-01",
			"2026-03-02",
		]);
	});

	it("resolves the Manila calendar date regardless of host zone", () => {
		// 15:30Z is 23:30 in Manila — still the 15th.
		expect(withTz(() => todayInManila(new Date("2026-08-15T15:30:00Z")))).toBe(
			"2026-08-15",
		);
		// 16:30Z is 00:30 the next day in Manila.
		expect(withTz(() => todayInManila(new Date("2026-08-15T16:30:00Z")))).toBe(
			"2026-08-16",
		);
	});
});

/* ------------------------------------------------------------------------- */
/* Cutoffs: 1–16 and 17–end of month                                          */
/* ------------------------------------------------------------------------- */

describe("cutoffBounds", () => {
	it("makes the first cutoff exactly 16 days in every month", () => {
		for (let month = 1; month <= 12; month++) {
			const b = cutoffBounds(2026, month, 1);
			expect(b.dayCount, `month ${month}`).toBe(16);
			expect(b.start.endsWith("-01")).toBe(true);
			expect(b.end.endsWith("-16")).toBe(true);
		}
	});

	it("sizes the second cutoff to the month length", () => {
		// Common February: 17–28.
		expect(cutoffBounds(2026, 2, 2)).toMatchObject({
			start: "2026-02-17",
			end: "2026-02-28",
			dayCount: 12,
		});
		// Leap February: 17–29.
		expect(cutoffBounds(2028, 2, 2)).toMatchObject({
			start: "2028-02-17",
			end: "2028-02-29",
			dayCount: 13,
		});
		// 30-day month: 17–30.
		expect(cutoffBounds(2026, 4, 2)).toMatchObject({
			start: "2026-04-17",
			end: "2026-04-30",
			dayCount: 14,
		});
		// 31-day month: 17–31.
		expect(cutoffBounds(2026, 1, 2)).toMatchObject({
			start: "2026-01-17",
			end: "2026-01-31",
			dayCount: 15,
		});
	});

	it("covers every day of the month across both cutoffs, with no gap or overlap", () => {
		for (const [year, month] of [
			[2026, 2],
			[2028, 2],
			[2026, 4],
			[2026, 12],
		] as const) {
			const first = cutoffBounds(year, month, 1);
			const second = cutoffBounds(year, month, 2);
			expect(first.dayCount + second.dayCount).toBe(daysInMonth(year, month));
			expect(addDays(first.end, 1)).toBe(second.start);
		}
	});

	it("rejects an out-of-range month", () => {
		expect(() => cutoffBounds(2026, 0, 1)).toThrow(/Month must be 1-12/);
		expect(() => cutoffBounds(2026, 13, 1)).toThrow(/Month must be 1-12/);
	});
});

describe("cutoffForDate", () => {
	it("splits on the 16th/17th boundary", () => {
		expect(cutoffForDate(d("2026-08-01")).half).toBe(1);
		expect(cutoffForDate(d("2026-08-16")).half).toBe(1);
		expect(cutoffForDate(d("2026-08-17")).half).toBe(2);
		expect(cutoffForDate(d("2026-08-31")).half).toBe(2);
	});

	it("assigns every date of a month to exactly one cutoff containing it", () => {
		for (const date of eachDate(d("2026-02-01"), d("2026-02-28"))) {
			const b = cutoffForDate(date);
			expect(date >= b.start && date <= b.end, date).toBe(true);
		}
	});
});

describe("cutoff navigation", () => {
	it("rolls across the year boundary", () => {
		expect(nextCutoff(cutoffBounds(2026, 12, 2)).periodKey).toBe("2027-01-1");
		expect(previousCutoff(cutoffBounds(2026, 1, 1)).periodKey).toBe(
			"2025-12-2",
		);
	});

	it("round-trips through a period key", () => {
		const b = cutoffBounds(2026, 8, 2);
		expect(parsePeriodKey(b.periodKey)).toEqual(b);
	});

	it("rejects a malformed period key", () => {
		expect(() => parsePeriodKey("2026-08-3")).toThrow();
		expect(() => parsePeriodKey("2026-13-1")).toThrow();
	});
});

/* ------------------------------------------------------------------------- */
/* Clock time                                                                 */
/* ------------------------------------------------------------------------- */

describe("parseTimeInput", () => {
	it.each([
		["8", 480],
		["08", 480],
		["800", 480],
		["0800", 480],
		["8:00", 480],
		["8a", 480],
		["8am", 480],
		["8 am", 480],
		["8:02", 482],
		["802", 482],
		["830", 510],
		["1230", 750],
		["12:30", 750],
		["13:00", 780],
		["1pm", 780],
		["1 pm", 780],
		["12pm", 720],
		["12am", 0],
		["12:30pm", 750],
		["1730", 1050],
		["  8:02  ", 482],
		["5:05 P.M.", 1025],
	])("parses %j to %i", (input, expected) => {
		expect(parseTimeInput(input)).toBe(expected);
	});

	it.each([
		[""],
		["   "],
		["abc"],
		["25:00"],
		["24:01"],
		["8:75"],
		["13pm"],
		["0pm"],
		["--"],
		["8:5"],
	])("returns null for %j", (input) => {
		expect(parseTimeInput(input)).toBeNull();
	});
});

describe("formatHHmm", () => {
	it("formats within the day", () => {
		expect(formatHHmm(0)).toBe("00:00");
		expect(formatHHmm(482)).toBe("08:02");
		expect(formatHHmm(1439)).toBe("23:59");
	});

	it("marks a punch after midnight", () => {
		expect(formatHHmm(1440)).toBe("00:00 (+1d)");
		expect(formatHHmm(1530)).toBe("01:30 (+1d)");
	});

	it("round-trips against parseTimeInput within a day", () => {
		for (let m = 0; m < 1440; m += 7) {
			expect(parseTimeInput(formatHHmm(m))).toBe(m);
		}
	});
});

describe("formatDuration", () => {
	it("formats hours and minutes", () => {
		expect(formatDuration(0)).toBe("0h 00m");
		expect(formatDuration(483)).toBe("8h 03m");
		expect(formatDuration(-47)).toBe("-0h 47m");
	});
});

describe("overlapMinutes", () => {
	it("returns the shared span of two intervals", () => {
		expect(overlapMinutes(480, 1020, 780, 1200)).toBe(240);
		expect(overlapMinutes(480, 720, 720, 1020)).toBe(0); // touching, half-open
		expect(overlapMinutes(480, 720, 900, 1020)).toBe(0); // disjoint
		expect(overlapMinutes(480, 1020, 480, 1020)).toBe(540); // identical
	});

	it("handles a night-shift window that runs past midnight as one interval", () => {
		// Worked 22:00 -> 06:00 next day = [1320, 1800).
		// Night-differential window 22:00 -> 06:00 = [1320, 1800).
		expect(overlapMinutes(1320, 1800, 1320, 1800)).toBe(480);
		// Worked 20:00 -> 02:00 = [1200, 1560); only part falls in the window.
		expect(overlapMinutes(1200, 1560, 1320, 1800)).toBe(240);
	});
});

/* ------------------------------------------------------------------------- */
/* Calendar helpers                                                           */
/* ------------------------------------------------------------------------- */

describe("calendar helpers", () => {
	it("computes month lengths including leap years", () => {
		expect(daysInMonth(2026, 2)).toBe(28);
		expect(daysInMonth(2028, 2)).toBe(29);
		expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
		expect(daysInMonth(1900, 2)).toBe(28); // century, not divisible by 400
		expect(daysInMonth(2026, 4)).toBe(30);
		expect(daysInMonth(2026, 12)).toBe(31);
	});

	it("computes day differences", () => {
		expect(diffDays(d("2026-08-01"), d("2026-08-16"))).toBe(15);
		expect(diffDays(d("2026-08-16"), d("2026-08-01"))).toBe(-15);
		expect(diffDays(d("2026-02-28"), d("2026-03-01"))).toBe(1);
	});

	it("builds and reads month keys", () => {
		expect(monthKeyOf(d("2026-08-15"))).toBe("2026-08");
		expect(toIsoDate(2026, 8, 5)).toBe("2026-08-05");
	});

	it("returns an empty range when end precedes start", () => {
		expect(eachDate(d("2026-08-10"), d("2026-08-09"))).toEqual([]);
	});

	it("rejects malformed dates", () => {
		expect(() => d("2026-8-15")).toThrow();
		expect(() => d("2026-13-01")).toThrow();
		expect(() => d("2026-08-32")).toThrow();
	});
});
