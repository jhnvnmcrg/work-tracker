import { describe, expect, it } from "vitest";
import { expandLeaveRange, summarizeBalances } from "./leave.ts";
import { assertIsoDate, dayOfWeek, type IsoDate } from "./time.ts";
import type { ScheduleSnapshot } from "./types.ts";

const d = assertIsoDate;

const WORKDAY: ScheduleSnapshot = {
	scheduleId: 1,
	amIn: 480,
	amOut: 720,
	pmIn: 780,
	pmOut: 1020,
	standardWorkMinutes: 480,
	breakMinutes: 60,
	isRestDay: false,
};

const REST: ScheduleSnapshot = { ...WORKDAY, isRestDay: true };

/** Monday–Friday working, Saturday and Sunday off. */
const scheduleFor = (date: IsoDate): ScheduleSnapshot => {
	const weekday = dayOfWeek(date);
	return weekday === 0 || weekday === 6 ? REST : WORKDAY;
};

const noHolidays = () => false;

describe("expandLeaveRange", () => {
	it("expands a plain three-day range", () => {
		// 2026-08-03 is a Monday.
		const result = expandLeaveRange({
			startDate: d("2026-08-03"),
			endDate: d("2026-08-05"),
			halfDayStart: false,
			halfDayEnd: false,
			isPaid: true,
			scheduleFor,
			isHoliday: noHolidays,
		});
		expect(result.days.map((x) => x.leaveDate)).toEqual([
			"2026-08-03",
			"2026-08-04",
			"2026-08-05",
		]);
		expect(result.totalMinutes).toBe(1440); // 3 x 8h
		expect(result.skipped).toEqual([]);
	});

	it("skips the weekend instead of charging for it", () => {
		// Friday 7th through Tuesday 11th spans a Saturday and Sunday.
		const result = expandLeaveRange({
			startDate: d("2026-08-07"),
			endDate: d("2026-08-11"),
			halfDayStart: false,
			halfDayEnd: false,
			isPaid: true,
			scheduleFor,
			isHoliday: noHolidays,
		});
		expect(result.days.map((x) => x.leaveDate)).toEqual([
			"2026-08-07",
			"2026-08-10",
			"2026-08-11",
		]);
		expect(result.totalMinutes).toBe(1440); // 3 days, not 5
		expect(result.skipped).toEqual([
			{ date: "2026-08-08", reason: "rest_day" },
			{ date: "2026-08-09", reason: "rest_day" },
		]);
	});

	it("skips a holiday falling inside the range", () => {
		const result = expandLeaveRange({
			startDate: d("2026-08-03"),
			endDate: d("2026-08-05"),
			halfDayStart: false,
			halfDayEnd: false,
			isPaid: true,
			scheduleFor,
			isHoliday: (date) => date === "2026-08-04",
		});
		expect(result.days.map((x) => x.leaveDate)).toEqual([
			"2026-08-03",
			"2026-08-05",
		]);
		expect(result.skipped).toEqual([{ date: "2026-08-04", reason: "holiday" }]);
		expect(result.totalMinutes).toBe(960);
	});

	it("charges half a day when leave starts at midday", () => {
		const result = expandLeaveRange({
			startDate: d("2026-08-03"),
			endDate: d("2026-08-05"),
			halfDayStart: true,
			halfDayEnd: false,
			isPaid: true,
			scheduleFor,
			isHoliday: noHolidays,
		});
		expect(result.days[0]).toMatchObject({
			leaveDate: "2026-08-03",
			portion: "pm",
			minutes: 240,
		});
		expect(result.totalMinutes).toBe(240 + 480 + 480);
	});

	it("charges half a day when leave ends at midday", () => {
		const result = expandLeaveRange({
			startDate: d("2026-08-03"),
			endDate: d("2026-08-05"),
			halfDayStart: false,
			halfDayEnd: true,
			isPaid: true,
			scheduleFor,
			isHoliday: noHolidays,
		});
		expect(result.days[2]).toMatchObject({
			leaveDate: "2026-08-05",
			portion: "am",
			minutes: 240,
		});
		expect(result.totalMinutes).toBe(480 + 480 + 240);
	});

	it("applies half days to the days actually consumed, not the requested endpoints", () => {
		// Requested Saturday to Tuesday: Saturday and Sunday drop out, so the
		// leading half-day must land on Monday.
		const result = expandLeaveRange({
			startDate: d("2026-08-08"),
			endDate: d("2026-08-11"),
			halfDayStart: true,
			halfDayEnd: false,
			isPaid: true,
			scheduleFor,
			isHoliday: noHolidays,
		});
		expect(result.days[0]).toMatchObject({
			leaveDate: "2026-08-10",
			portion: "pm",
		});
	});

	it("treats a single half day sensibly", () => {
		const base = {
			startDate: d("2026-08-03"),
			endDate: d("2026-08-03"),
			isPaid: true,
			scheduleFor,
			isHoliday: noHolidays,
		};
		expect(
			expandLeaveRange({ ...base, halfDayStart: true, halfDayEnd: false })
				.days[0],
		).toMatchObject({ portion: "pm", minutes: 240 });
		expect(
			expandLeaveRange({ ...base, halfDayStart: false, halfDayEnd: true })
				.days[0],
		).toMatchObject({ portion: "am", minutes: 240 });
		expect(
			expandLeaveRange({ ...base, halfDayStart: false, halfDayEnd: false })
				.days[0],
		).toMatchObject({ portion: "full", minutes: 480 });
	});

	it("returns nothing for a range made entirely of rest days", () => {
		const result = expandLeaveRange({
			startDate: d("2026-08-08"),
			endDate: d("2026-08-09"),
			halfDayStart: false,
			halfDayEnd: false,
			isPaid: true,
			scheduleFor,
			isHoliday: noHolidays,
		});
		expect(result.days).toEqual([]);
		expect(result.totalMinutes).toBe(0);
	});

	it("carries the paid flag onto every day", () => {
		const result = expandLeaveRange({
			startDate: d("2026-08-03"),
			endDate: d("2026-08-04"),
			halfDayStart: false,
			halfDayEnd: false,
			isPaid: false,
			scheduleFor,
			isHoliday: noHolidays,
		});
		expect(result.days.every((day) => day.isPaid === false)).toBe(true);
	});
});

describe("summarizeBalances", () => {
	it("nets credits against usage per type and credit year", () => {
		const balances = summarizeBalances([
			{ leaveTypeId: 1, creditYear: 2026, deltaMinutes: 7200 }, // 15 days
			{ leaveTypeId: 1, creditYear: 2026, deltaMinutes: -1440 }, // 3 days used
			{ leaveTypeId: 2, creditYear: 2026, deltaMinutes: 7200 },
		]);
		expect(balances).toEqual([
			{
				leaveTypeId: 1,
				creditYear: 2026,
				earnedMinutes: 7200,
				usedMinutes: 1440,
				balanceMinutes: 5760,
			},
			{
				leaveTypeId: 2,
				creditYear: 2026,
				earnedMinutes: 7200,
				usedMinutes: 0,
				balanceMinutes: 7200,
			},
		]);
	});

	it("keeps credit years separate", () => {
		const balances = summarizeBalances([
			{ leaveTypeId: 1, creditYear: 2025, deltaMinutes: 4800 },
			{ leaveTypeId: 1, creditYear: 2026, deltaMinutes: 7200 },
		]);
		expect(balances).toHaveLength(2);
		expect(balances[0].creditYear).toBe(2025);
	});

	it("allows a negative balance rather than clamping it", () => {
		// Over-consumption is a real condition that must stay visible.
		const [balance] = summarizeBalances([
			{ leaveTypeId: 1, creditYear: 2026, deltaMinutes: 480 },
			{ leaveTypeId: 1, creditYear: 2026, deltaMinutes: -960 },
		]);
		expect(balance.balanceMinutes).toBe(-480);
	});

	it("returns nothing for an empty ledger", () => {
		expect(summarizeBalances([])).toEqual([]);
	});
});
