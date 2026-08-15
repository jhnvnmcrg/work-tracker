import { describe, expect, it } from "vitest";
import {
	type Anomaly,
	type AnomalyDay,
	type AnomalyInput,
	anomalyKey,
	detectAnomalies,
	isSpike,
	median,
	medianAbsoluteDeviation,
} from "./anomalies.ts";
import { assertIsoDate } from "./time.ts";
import type { DailyMinutes, DtrFlag, PunchSet } from "./types.ts";

const TODAY = assertIsoDate("2026-08-14");

const minutes = (over: Partial<DailyMinutes> = {}): DailyMinutes => ({
	workedMinutes: 480,
	creditedRegularMinutes: 480,
	lateMinutes: 0,
	undertimeMinutes: 0,
	overtimeMinutes: 0,
	nightDiffMinutes: 0,
	nightDiffOvertimeMinutes: 0,
	paidLeaveMinutes: 0,
	unpaidMinutes: 0,
	flags: [],
	...over,
});

const day = (
	date: string,
	over: Partial<AnomalyDay> & { flags?: DtrFlag[]; punches?: PunchSet } = {},
): AnomalyDay => ({
	date: assertIsoDate(date),
	punches: over.punches ?? { amIn: 480, amOut: 720, pmIn: 780, pmOut: 1020 },
	minutes: over.minutes ?? minutes({ flags: over.flags ?? [] }),
	hasRecord: over.hasRecord ?? true,
	isScheduledWorkday: over.isScheduledWorkday ?? true,
});

function input(over: Partial<AnomalyInput> = {}): AnomalyInput {
	return {
		today: TODAY,
		days: [],
		currentCutoff: { start: "2026-08-01", end: "2026-08-16", daysRemaining: 2 },
		baseline: { lateMinutes: [], overtimeMinutes: [] },
		periodLateMinutes: 0,
		periodOvertimeMinutes: 0,
		leaveBalances: [],
		standardWorkMinutes: 480,
		...over,
	};
}

const codes = (found: Anomaly[]) => found.map((a) => a.code);
const byCode = (found: Anomaly[], code: string) =>
	found.find((a) => a.code === code);

describe("statistics", () => {
	it("computes a median for odd and even counts", () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([])).toBe(0);
	});

	it("computes a median absolute deviation", () => {
		expect(medianAbsoluteDeviation([1, 1, 1, 1])).toBe(0);
		expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1);
	});

	it("is not thrown off by a single outlier, unlike a standard deviation", () => {
		const steady = [10, 10, 10, 10, 10];
		const withOutlier = [10, 10, 10, 10, 1000];
		// The centre barely moves, so the next unusual value is still detectable.
		expect(median(withOutlier)).toBe(median(steady));
	});
});

describe("isSpike", () => {
	it("stays silent until there is enough history", () => {
		expect(isSpike(500, [10, 10]).spike).toBe(false);
		expect(isSpike(500, [10, 10, 10]).spike).toBe(false);
		expect(isSpike(500, [10, 10, 10, 10]).spike).toBe(true);
	});

	it("flags a value well above the personal baseline", () => {
		expect(isSpike(200, [20, 25, 15, 30, 20]).spike).toBe(true);
	});

	it("does not flag ordinary variation", () => {
		expect(isSpike(30, [20, 25, 15, 30, 20]).spike).toBe(false);
	});

	it("needs a real jump even when history is perfectly flat", () => {
		// With zero spread, a one-minute difference must not count as a spike.
		expect(isSpike(101, [100, 100, 100, 100]).spike).toBe(false);
		expect(isSpike(200, [100, 100, 100, 100]).spike).toBe(true);
	});

	it("adapts to the individual rather than a fixed threshold", () => {
		const punctual = [0, 0, 2, 0, 1];
		const habituallyLate = [180, 200, 190, 210, 195];
		// 60 minutes is a spike for one person and unremarkable for the other.
		expect(isSpike(60, punctual).spike).toBe(true);
		expect(isSpike(60, habituallyLate).spike).toBe(false);
	});
});

describe("punch problems", () => {
	it("finds a missing clock-out", () => {
		const found = detectAnomalies(
			input({
				days: [
					day("2026-08-03"),
					day("2026-08-04", {
						punches: { amIn: 480, amOut: 720, pmIn: 780, pmOut: null },
					}),
				],
			}),
		);
		expect(codes(found)).toContain("MISSING_TIME_OUT");
		expect(byCode(found, "MISSING_TIME_OUT")?.dates).toEqual(["2026-08-04"]);
		expect(byCode(found, "MISSING_TIME_OUT")?.severity).toBe("critical");
	});

	it("finds a missing clock-in", () => {
		const found = detectAnomalies(
			input({
				days: [
					day("2026-08-04", {
						punches: { amIn: null, amOut: 720, pmIn: 780, pmOut: 1020 },
					}),
				],
			}),
		);
		expect(codes(found)).toContain("MISSING_TIME_IN");
	});

	it("finds times recorded out of order", () => {
		const found = detectAnomalies(
			input({ days: [day("2026-08-04", { flags: ["out_before_in"] })] }),
		);
		expect(codes(found)).toContain("OUT_BEFORE_IN");
	});

	it("finds an implausibly long day", () => {
		const found = detectAnomalies(
			input({
				days: [
					day("2026-08-04", { minutes: minutes({ workedMinutes: 1_100 }) }),
				],
			}),
		);
		expect(codes(found)).toContain("IMPLAUSIBLE_DURATION");
		expect(byCode(found, "IMPLAUSIBLE_DURATION")?.facts.longest).toBe(
			"18h 20m",
		);
	});

	it("says nothing about a complete day", () => {
		const found = detectAnomalies(
			input({ days: [day("2026-08-03"), day("2026-08-04")] }),
		);
		expect(found).toEqual([]);
	});
});

describe("gaps", () => {
	it("reports a scheduled workday with no entry", () => {
		const found = detectAnomalies(
			input({
				days: [day("2026-08-03", { hasRecord: false })],
				currentCutoff: {
					start: "2026-08-01",
					end: "2026-08-16",
					daysRemaining: 10,
				},
			}),
		);
		expect(codes(found)).toContain("NO_RECORD_ON_SCHEDULED_DAY");
		expect(byCode(found, "NO_RECORD_ON_SCHEDULED_DAY")?.defaultMessage).toMatch(
			/gaps, not absences/,
		);
	});

	it("escalates the same gap as the cutoff closes", () => {
		const found = detectAnomalies(
			input({
				days: [day("2026-08-03", { hasRecord: false })],
				currentCutoff: {
					start: "2026-08-01",
					end: "2026-08-16",
					daysRemaining: 1,
				},
			}),
		);
		expect(codes(found)).toContain("CUTOFF_CLOSING_INCOMPLETE");
		expect(byCode(found, "CUTOFF_CLOSING_INCOMPLETE")?.severity).toBe(
			"critical",
		);
	});

	it("ignores a rest day with no entry", () => {
		const found = detectAnomalies(
			input({
				days: [
					day("2026-08-08", { hasRecord: false, isScheduledWorkday: false }),
				],
			}),
		);
		expect(found).toEqual([]);
	});

	it("ignores a future workday that is simply not filled in yet", () => {
		const found = detectAnomalies(
			input({
				days: [
					day("2026-08-20", { hasRecord: false }),
					day("2026-08-21", {
						hasRecord: true,
						punches: { amIn: 480, amOut: null, pmIn: null, pmOut: null },
					}),
				],
			}),
		);
		expect(found).toEqual([]);
	});
});

describe("trends", () => {
	it("reports a lateness spike against the user's own history", () => {
		const found = detectAnomalies(
			input({
				periodLateMinutes: 240,
				baseline: { lateMinutes: [10, 12, 8, 15, 11], overtimeMinutes: [] },
			}),
		);
		expect(codes(found)).toContain("LATE_SPIKE");
		expect(byCode(found, "LATE_SPIKE")?.facts).toEqual({
			thisPeriod: "4h 00m",
			usual: "0h 11m",
		});
	});

	it("reports an overtime spike", () => {
		const found = detectAnomalies(
			input({
				periodOvertimeMinutes: 600,
				baseline: { lateMinutes: [], overtimeMinutes: [60, 45, 70, 55, 60] },
			}),
		);
		expect(codes(found)).toContain("OT_SPIKE");
	});

	it("stays quiet without enough history", () => {
		const found = detectAnomalies(
			input({
				periodLateMinutes: 240,
				baseline: { lateMinutes: [10, 12], overtimeMinutes: [] },
			}),
		);
		expect(codes(found)).not.toContain("LATE_SPIKE");
	});
});

describe("leave expiry", () => {
	it("warns about credits expiring soon", () => {
		const found = detectAnomalies(
			input({
				leaveBalances: [
					{
						code: "VL",
						name: "Vacation leave",
						balanceMinutes: 3_600,
						expiresOn: "2026-09-30",
					},
				],
			}),
		);
		expect(codes(found)).toContain("LEAVE_EXPIRING");
		expect(byCode(found, "LEAVE_EXPIRING")?.facts).toMatchObject({
			code: "VL",
			days: "7.5",
			expiresOn: "2026-09-30",
		});
	});

	it("says nothing about a distant expiry, a zero balance, or a past date", () => {
		const base = {
			code: "VL",
			name: "Vacation leave",
			balanceMinutes: 3_600,
		};
		for (const balance of [
			{ ...base, expiresOn: "2027-12-31" },
			{ ...base, balanceMinutes: 0, expiresOn: "2026-09-01" },
			{ ...base, expiresOn: "2026-01-01" },
			{ ...base, expiresOn: null },
		]) {
			expect(
				codes(detectAnomalies(input({ leaveBalances: [balance] }))),
			).not.toContain("LEAVE_EXPIRING");
		}
	});
});

describe("output contract", () => {
	it("sorts the most serious findings first", () => {
		const found = detectAnomalies(
			input({
				days: [
					day("2026-08-03", { hasRecord: false }),
					day("2026-08-04", {
						punches: { amIn: 480, amOut: 720, pmIn: 780, pmOut: null },
					}),
				],
				currentCutoff: {
					start: "2026-08-01",
					end: "2026-08-16",
					daysRemaining: 10,
				},
				periodLateMinutes: 240,
				baseline: { lateMinutes: [10, 12, 8, 15, 11], overtimeMinutes: [] },
			}),
		);
		const severities = found.map((a) => a.severity);
		expect(severities[0]).toBe("critical");
		expect(severities.at(-1)).toBe("info");
	});

	it("gives every finding a message that can stand alone without AI", () => {
		const found = detectAnomalies(
			input({
				days: [
					day("2026-08-04", {
						punches: { amIn: 480, amOut: 720, pmIn: 780, pmOut: null },
					}),
				],
			}),
		);
		for (const anomaly of found) {
			expect(anomaly.defaultMessage.length).toBeGreaterThan(10);
			expect(anomaly.title.length).toBeGreaterThan(0);
			expect(Object.keys(anomaly.facts).length).toBeGreaterThan(0);
		}
	});

	it("gives each finding a stable identity", () => {
		const args = input({
			days: [
				day("2026-08-04", {
					punches: { amIn: 480, amOut: 720, pmIn: 780, pmOut: null },
				}),
			],
		});
		const first = detectAnomalies(args).map(anomalyKey);
		const second = detectAnomalies(args).map(anomalyKey);
		expect(first).toEqual(second);
		expect(first[0]).toBe("MISSING_TIME_OUT:2026-08-04");
	});
});
