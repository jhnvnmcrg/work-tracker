import { describe, expect, it } from "vitest";
import {
	easterSunday,
	lastMondayOfAugust,
	phHolidaysForYear,
} from "./ph-holidays.ts";
import { dayOfWeek } from "./time.ts";

describe("easterSunday", () => {
	// Known Gregorian Easter dates.
	it.each([
		[2024, "2024-03-31"],
		[2025, "2025-04-20"],
		[2026, "2026-04-05"],
		[2027, "2027-03-28"],
		[2028, "2028-04-16"],
		[2030, "2030-04-21"],
	])("resolves %i to %s", (year, expected) => {
		expect(easterSunday(year)).toBe(expected);
	});

	it("always lands on a Sunday", () => {
		for (let year = 2020; year <= 2060; year++) {
			expect(dayOfWeek(easterSunday(year)), String(year)).toBe(0);
		}
	});
});

describe("lastMondayOfAugust", () => {
	it("is always a Monday in August", () => {
		for (let year = 2024; year <= 2040; year++) {
			const date = lastMondayOfAugust(year);
			expect(dayOfWeek(date), String(year)).toBe(1);
			expect(date.slice(5, 7)).toBe("08");
		}
	});

	it("leaves fewer than seven days in the month", () => {
		for (let year = 2024; year <= 2040; year++) {
			const day = Number(lastMondayOfAugust(year).slice(8, 10));
			expect(day, String(year)).toBeGreaterThan(24);
		}
	});
});

describe("phHolidaysForYear", () => {
	const holidays = phHolidaysForYear(2026);
	const byName = new Map(holidays.map((h) => [h.name, h]));

	it("includes the fixed-date regular holidays", () => {
		expect(byName.get("New Year's Day")?.holidayDate).toBe("2026-01-01");
		expect(byName.get("Araw ng Kagitingan")?.holidayDate).toBe("2026-04-09");
		expect(byName.get("Labor Day")?.holidayDate).toBe("2026-05-01");
		expect(byName.get("Independence Day")?.holidayDate).toBe("2026-06-12");
		expect(byName.get("Bonifacio Day")?.holidayDate).toBe("2026-11-30");
		expect(byName.get("Christmas Day")?.holidayDate).toBe("2026-12-25");
		expect(byName.get("Rizal Day")?.holidayDate).toBe("2026-12-30");
	});

	it("derives the Holy Week holidays from Easter", () => {
		// Easter 2026 is 5 April.
		expect(byName.get("Maundy Thursday")?.holidayDate).toBe("2026-04-02");
		expect(byName.get("Good Friday")?.holidayDate).toBe("2026-04-03");
		expect(byName.get("Black Saturday")?.holidayDate).toBe("2026-04-04");
	});

	it("places National Heroes Day on the last Monday of August", () => {
		expect(byName.get("National Heroes Day")?.holidayDate).toBe("2026-08-31");
	});

	it("classifies regular and special days correctly", () => {
		expect(byName.get("Christmas Day")?.kind).toBe("regular");
		expect(byName.get("Ninoy Aquino Day")?.kind).toBe("special_non_working");
		expect(byName.get("All Saints' Day")?.kind).toBe("special_non_working");
	});

	it("omits holidays that depend on an annual proclamation", () => {
		const names = holidays.map((h) => h.name).join(" ");
		expect(names).not.toMatch(/Eid/i);
		expect(names).not.toMatch(/Chinese New Year/i);
		expect(names).not.toMatch(/EDSA/i);
	});

	it("cites a source for every entry", () => {
		expect(holidays.every((h) => h.citation.length > 0)).toBe(true);
	});

	it("returns dates sorted and unique", () => {
		const dates = holidays.map((h) => h.holidayDate);
		expect([...dates].sort()).toEqual(dates);
		expect(new Set(dates).size).toBe(dates.length);
	});

	it("produces a consistent set across many years", () => {
		for (let year = 2024; year <= 2035; year++) {
			const list = phHolidaysForYear(year);
			expect(list, String(year)).toHaveLength(15);
			expect(
				list.every((h) => h.holidayDate.startsWith(String(year))),
				String(year),
			).toBe(true);
		}
	});
});
