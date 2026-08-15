import { describe, expect, it } from "vitest";
import { computeDailyMinutes } from "./daily.ts";
import { formatPeso } from "./money.ts";
import {
	type AdjustmentInput,
	computePayslip,
	type DayForPayslip,
	type PayslipInput,
} from "./payslip.ts";
import { deriveRateBasis } from "./rates.ts";
import type { StatutoryScheduleData } from "./statutory.ts";
import {
	assertIsoDate,
	cutoffBounds,
	dayOfWeek,
	daysInMonth,
	eachDate,
	type IsoDate,
} from "./time.ts";
import {
	DEFAULT_PUNCH_POLICY,
	type PunchSet,
	type ScheduleSnapshot,
} from "./types.ts";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/*                                                                             */
/* The contribution figures below are invented to exercise the arithmetic. The */
/* app ships with these tables empty; nothing here is a real rate.             */
/* -------------------------------------------------------------------------- */

const MONTHLY = 4_500_000; // ₱45,000.00
const TODAY = assertIsoDate("2026-12-31");

const RATES = deriveRateBasis({
	monthlyRateCentavos: MONTHLY,
	workingDaysFactorX100: 31_300,
	dailyHours: 8,
	rateRoundingMode: "amounts_only",
});

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
const REST: ScheduleSnapshot = {
	...WORKDAY,
	isRestDay: true,
	standardWorkMinutes: 0,
};

const scheduleFor = (date: IsoDate) => {
	const weekday = dayOfWeek(date);
	return weekday === 0 || weekday === 6 ? REST : WORKDAY;
};

const SSS: StatutoryScheduleData = {
	id: 100,
	userId: null,
	kind: "sss",
	name: "test SSS",
	effectiveFrom: "2020-01-01",
	effectiveTo: null,
	ratePpm: null,
	employeeSharePpm: null,
	floorCentavos: null,
	ceilingCentavos: null,
	sourceCitation: "test fixture",
	verifiedAt: null,
	brackets: [
		{
			id: 1000,
			periodType: "monthly",
			rangeFromCentavos: 0,
			rangeToCentavos: null,
			salaryCreditCentavos: 4_500_000,
			employeeAmountCentavos: 90_000, // ₱900.00
			employerAmountCentavos: 180_000,
			employerEcAmountCentavos: 3_000,
			employeeMpfCentavos: null,
			employerMpfCentavos: null,
			employeeRatePpm: null,
			employerRatePpm: null,
			capCentavos: null,
			baseAmountCentavos: null,
			excessRatePpm: null,
		},
	],
};

const PHILHEALTH: StatutoryScheduleData = {
	...SSS,
	id: 200,
	kind: "philhealth",
	name: "test PhilHealth",
	ratePpm: 50_000, // 5%
	employeeSharePpm: 500_000, // half
	floorCentavos: 1_000_000,
	ceilingCentavos: 10_000_000,
	brackets: [],
};

const PAGIBIG: StatutoryScheduleData = {
	...SSS,
	id: 300,
	kind: "pagibig",
	name: "test Pag-IBIG",
	ratePpm: null,
	employeeSharePpm: null,
	floorCentavos: null,
	ceilingCentavos: null,
	brackets: [
		{
			...SSS.brackets[0],
			id: 3000,
			salaryCreditCentavos: null,
			employeeAmountCentavos: null,
			employerAmountCentavos: null,
			employerEcAmountCentavos: null,
			employeeRatePpm: 20_000, // 2%
			employerRatePpm: 20_000,
			capCentavos: 1_000_000, // capped at ₱10,000
		},
	],
};

const BIR: StatutoryScheduleData = {
	...SSS,
	id: 400,
	kind: "withholding_tax",
	name: "test BIR",
	brackets: [
		{
			...SSS.brackets[0],
			id: 4000,
			periodType: "semi_monthly",
			rangeFromCentavos: 0,
			rangeToCentavos: 1_041_999,
			salaryCreditCentavos: null,
			employeeAmountCentavos: null,
			employerAmountCentavos: null,
			employerEcAmountCentavos: null,
			baseAmountCentavos: 0,
			excessRatePpm: 0,
		},
		{
			...SSS.brackets[0],
			id: 4001,
			periodType: "semi_monthly",
			rangeFromCentavos: 1_042_000,
			rangeToCentavos: null,
			salaryCreditCentavos: null,
			employeeAmountCentavos: null,
			employerAmountCentavos: null,
			employerEcAmountCentavos: null,
			baseAmountCentavos: 0,
			excessRatePpm: 200_000, // 20% of the excess
		},
	],
};

const SCHEDULES = [SSS, PHILHEALTH, PAGIBIG, BIR];

/** Builds the days of a cutoff, applying per-date punch overrides. */
function buildDays(
	year: number,
	month: number,
	half: 1 | 2,
	overrides: Record<
		string,
		{ punches?: PunchSet; status?: "absent"; approvedOt?: number }
	> = {},
): DayForPayslip[] {
	const bounds = cutoffBounds(year, month, half);
	return eachDate(bounds.start, bounds.end).map((date) => {
		const schedule = scheduleFor(date);
		const override = overrides[date];
		const punches: PunchSet = override?.punches ?? {
			amIn: schedule.isRestDay ? null : schedule.amIn,
			amOut: schedule.isRestDay ? null : schedule.amOut,
			pmIn: schedule.isRestDay ? null : schedule.pmIn,
			pmOut: schedule.isRestDay ? null : schedule.pmOut,
		};
		const status =
			override?.status ?? (schedule.isRestDay ? "no_work" : "present");

		const { minutes } = computeDailyMinutes({
			date,
			today: TODAY,
			punches,
			schedule,
			dayKind: schedule.isRestDay ? "rest_day" : "regular_workday",
			status,
			isRestDay: schedule.isRestDay,
			leave: null,
			policy: DEFAULT_PUNCH_POLICY,
			approvedOvertimeMinutes: override?.approvedOt ?? null,
		});

		return {
			date,
			minutes,
			hasRecord: true,
			isRestDay: schedule.isRestDay,
			isHoliday: false,
			isScheduledWorkday: !schedule.isRestDay,
			standardWorkMinutes: schedule.standardWorkMinutes,
		};
	});
}

function input(
	year: number,
	month: number,
	half: 1 | 2,
	days: DayForPayslip[],
	adjustments: AdjustmentInput[] = [],
): PayslipInput {
	const bounds = cutoffBounds(year, month, half);
	return {
		period: {
			year,
			month,
			half,
			startDate: bounds.start,
			endDate: bounds.end,
			payDate: bounds.end,
			dayCount: bounds.dayCount,
		},
		terms: {
			id: 1,
			monthlyRateCentavos: MONTHLY,
			basePaySplitMode: "half_month_flat",
			sssBasisCentavos: null,
			philhealthBasisCentavos: null,
			pagibigBasisCentavos: null,
			// All three contributions land on the 1–16 cutoff.
			sssTiming: "first_cutoff",
			philhealthTiming: "first_cutoff",
			pagibigTiming: "first_cutoff",
			taxTiming: "every_cutoff",
			taxExempt: false,
			unaccountedDayPolicy: "warn",
		},
		rates: RATES,
		days,
		statutorySchedules: SCHEDULES,
		adjustments,
		calendarDaysInMonth: daysInMonth(year, month),
	};
}

const lineByCode = (result: ReturnType<typeof computePayslip>, code: string) =>
	result.lines.find((line) => line.code === code);

/* -------------------------------------------------------------------------- */
/* Golden payslips                                                             */
/* -------------------------------------------------------------------------- */

describe("golden payslip 1: a plain cutoff, everything worked", () => {
	const result = computePayslip(input(2026, 8, 1, buildDays(2026, 8, 1)));

	it("pays exactly half the monthly rate as base", () => {
		expect(result.basePayCentavos).toBe(2_250_000);
	});

	it("adds no regular pay on top of the flat base", () => {
		// The double-pay trap: base is the only earning on a clean cutoff.
		expect(result.totalEarningsCentavos).toBe(2_250_000);
		expect(result.lines.filter((l) => l.section === "earnings")).toHaveLength(
			1,
		);
	});

	it("withholds all three contributions on the first cutoff", () => {
		expect(lineByCode(result, "SSS_EE")?.amountCentavos).toBe(90_000);
		expect(lineByCode(result, "PHIC_EE")?.amountCentavos).toBe(112_500);
		// 2% of the ₱10,000 cap.
		expect(lineByCode(result, "HDMF_EE")?.amountCentavos).toBe(20_000);
	});

	it("computes tax on compensation net of contributions", () => {
		// Taxable = 22,500 - (900 + 1,125 + 200) = ₱20,275.
		expect(result.taxableGrossCentavos).toBe(2_027_500);
		// 20% of (20,275 - 10,420) = 20% of 9,855 = ₱1,971.00
		expect(lineByCode(result, "BIR_WT")?.amountCentavos).toBe(197_100);
	});

	it("reconciles net against gross and deductions", () => {
		const deductions = 90_000 + 112_500 + 20_000 + 197_100;
		expect(result.totalDeductionsCentavos).toBe(deductions);
		expect(result.netPayCentavos).toBe(2_250_000 - deductions);
		expect(formatPeso(result.netPayCentavos)).toBe("₱18,304.00");
	});

	it("can be finalized", () => {
		expect(result.canFinalize).toBe(true);
	});
});

describe("golden payslip 2: the second cutoff carries no contributions", () => {
	const result = computePayslip(input(2026, 8, 2, buildDays(2026, 8, 2)));

	it("still pays the flat half-month base", () => {
		expect(result.basePayCentavos).toBe(2_250_000);
	});

	it("withholds no contributions, because they land on the first cutoff", () => {
		expect(lineByCode(result, "SSS_EE")).toBeUndefined();
		expect(lineByCode(result, "PHIC_EE")).toBeUndefined();
		expect(lineByCode(result, "HDMF_EE")).toBeUndefined();
	});

	it("taxes the full base, since nothing reduced it", () => {
		expect(result.taxableGrossCentavos).toBe(2_250_000);
		// 20% of (22,500 - 10,420) = ₱2,416.00
		expect(lineByCode(result, "BIR_WT")?.amountCentavos).toBe(241_600);
	});
});

describe("golden payslip 3: a leap-February second cutoff", () => {
	// 17–29 February 2028 is 13 days against 16 for the first cutoff.
	const bounds = cutoffBounds(2028, 2, 2);
	const result = computePayslip(input(2028, 2, 2, buildDays(2028, 2, 2)));

	it("is a short cutoff", () => {
		expect(bounds.dayCount).toBe(13);
	});

	it("does not shrink the base for the shorter cutoff", () => {
		// A monthly salary buys the month, not the days.
		expect(result.basePayCentavos).toBe(2_250_000);
	});

	it("still sums with the first cutoff to exactly the monthly rate", () => {
		const first = computePayslip(input(2028, 2, 1, buildDays(2028, 2, 1)));
		expect(first.basePayCentavos + result.basePayCentavos).toBe(MONTHLY);
	});
});

describe("golden payslip 4: lateness, undertime and approved overtime", () => {
	const days = buildDays(2026, 8, 1, {
		// 2 minutes late on Monday the 3rd.
		"2026-08-03": {
			punches: { amIn: 482, amOut: 720, pmIn: 780, pmOut: 1020 },
		},
		// Left 30 minutes early on Tuesday the 4th.
		"2026-08-04": {
			punches: { amIn: 480, amOut: 720, pmIn: 780, pmOut: 990 },
		},
		// Two hours of approved overtime on Wednesday the 5th.
		"2026-08-05": {
			punches: { amIn: 480, amOut: 720, pmIn: 780, pmOut: 1140 },
			approvedOt: 120,
		},
	});
	const result = computePayslip(input(2026, 8, 1, days));

	it("prices overtime at the hourly rate", () => {
		// 120 minutes at ₱3.5942/min -> ₱431.31
		expect(lineByCode(result, "OT")?.amountCentavos).toBe(43_131);
		expect(lineByCode(result, "OT")?.quantity).toBe(120);
	});

	it("itemises late and undertime as subtractions", () => {
		expect(lineByCode(result, "LATE")?.quantity).toBe(2);
		expect(lineByCode(result, "LATE")?.amountCentavos).toBe(719);
		expect(lineByCode(result, "UT")?.quantity).toBe(30);
		expect(lineByCode(result, "UT")?.amountCentavos).toBe(10_783);
	});

	it("treats those subtractions as reducing taxable income", () => {
		// Displayed under deductions, but they reduce compensation rather than
		// being deducted from it.
		for (const code of ["LATE", "UT"]) {
			const line = lineByCode(result, code);
			expect(line?.section).toBe("deductions");
			expect(line?.reducesTaxableGross).toBe(true);
		}
	});

	it("records which dates produced each line", () => {
		expect(lineByCode(result, "LATE")?.sourceDates).toEqual(["2026-08-03"]);
		expect(lineByCode(result, "OT")?.sourceDates).toEqual(["2026-08-05"]);
	});

	it("reconciles", () => {
		const earnings = 2_250_000 + 43_131;
		expect(result.totalEarningsCentavos).toBe(earnings);
		expect(result.netPayCentavos).toBe(
			result.grossPayCentavos - result.totalDeductionsCentavos,
		);
	});
});

/** Marks every scheduled workday in a cutoff as absent. */
function allAbsent(year: number, month: number, half: 1 | 2) {
	const bounds = cutoffBounds(year, month, half);
	const overrides: Record<string, { status: "absent"; punches: PunchSet }> = {};
	for (const date of eachDate(bounds.start, bounds.end)) {
		if (!scheduleFor(date).isRestDay) {
			overrides[date] = {
				status: "absent",
				punches: { amIn: null, amOut: null, pmIn: null, pmOut: null },
			};
		}
	}
	return overrides;
}

describe("golden payslip 5: absences exceeding the base", () => {
	// Factor 261 matches the Monday-to-Friday schedule, so an absence deducts
	// what a working day earns. The 17–31 August cutoff has 11 workdays at
	// ₱2,068.97, which is ₱22,758.67 against a ₱22,500 base.
	const rates261 = deriveRateBasis({
		monthlyRateCentavos: MONTHLY,
		workingDaysFactorX100: 26_100,
		dailyHours: 8,
		rateRoundingMode: "amounts_only",
	});
	const base = input(2026, 8, 2, buildDays(2026, 8, 2, allAbsent(2026, 8, 2)));
	const result = computePayslip({ ...base, rates: rates261 });

	it("deducts every absent day", () => {
		// 11 days x 480 minutes at the derived per-minute rate. Note this is
		// ₱22,758.62 rather than 11 x the *rounded* ₱2,068.97 daily rate, because
		// precision is carried through and rounded once at the end.
		expect(lineByCode(result, "ABS")?.amountCentavos).toBe(2_275_862);
	});

	it("produces a negative net rather than clamping it", () => {
		// Clamping would hide what is almost always a data-entry error.
		expect(result.netPayCentavos).toBe(2_250_000 - 2_275_862);
		expect(result.netPayCentavos).toBeLessThan(0);
	});

	it("warns about the negative net without blocking finalization", () => {
		const warning = result.warnings.find((w) => w.code === "negative_net");
		expect(warning).toBeDefined();
		expect(warning?.blocksFinalize).toBe(false);
	});

	it("charges no tax when taxable pay is wiped out", () => {
		expect(lineByCode(result, "BIR_WT")).toBeUndefined();
		expect(result.taxableGrossCentavos).toBe(0);
	});
});

describe("the working-days factor must match the schedule", () => {
	it("warns when the factor and the schedule disagree", () => {
		// Factor 313 assumes a six-day week, but the fixture schedule is
		// Monday-to-Friday. Base earns ₱2,250 per workday while an absence only
		// deducts ₱1,725.24, so the two never balance.
		const result = computePayslip(input(2026, 8, 1, buildDays(2026, 8, 1)));
		const warning = result.warnings.find(
			(w) => w.code === "factor_schedule_mismatch",
		);
		expect(warning).toBeDefined();
		expect(warning?.blocksFinalize).toBe(false);
		expect(warning?.message).toMatch(/261/);
	});

	it("is quiet when the factor matches the schedule", () => {
		// 261 against a five-day week: 11 workdays x ₱2,068.97 is within a
		// rounding step of the ₱22,500 half-month base.
		const rates261 = deriveRateBasis({
			monthlyRateCentavos: MONTHLY,
			workingDaysFactorX100: 26_100,
			dailyHours: 8,
			rateRoundingMode: "amounts_only",
		});
		const base = input(2026, 8, 2, buildDays(2026, 8, 2));
		const result = computePayslip({ ...base, rates: rates261 });
		expect(
			result.warnings.find((w) => w.code === "factor_schedule_mismatch"),
		).toBeUndefined();
	});

	it("under-deducts absences when the factor is too high", () => {
		// Documenting the real consequence: with factor 313 and a five-day week,
		// being absent every workday of a cutoff still leaves positive pay.
		const result = computePayslip(
			input(2026, 8, 1, buildDays(2026, 8, 1, allAbsent(2026, 8, 1))),
		);
		expect(result.netPayCentavos).toBeGreaterThan(0);
		// 10 workdays x ₱1,725.24 = ₱17,252.40 against a ₱22,500 base.
		expect(lineByCode(result, "ABS")?.amountCentavos).toBe(1_725_240);
	});
});

describe("golden payslip 6: allowances and a loan", () => {
	const adjustments: AdjustmentInput[] = [
		{
			code: "RICE",
			label: "Rice allowance",
			section: "earnings",
			category: "allowance",
			amountCentavos: 200_000,
			isTaxable: false,
			timing: "first_cutoff",
		},
		{
			code: "TRANSPO",
			label: "Transport allowance",
			section: "earnings",
			category: "allowance",
			amountCentavos: 100_000,
			isTaxable: true,
			timing: "every_cutoff",
		},
		{
			code: "SSSLOAN",
			label: "SSS salary loan",
			section: "deductions",
			category: "loan",
			amountCentavos: 150_000,
			isTaxable: false,
			timing: "first_cutoff",
		},
	];
	const result = computePayslip(
		input(2026, 8, 1, buildDays(2026, 8, 1), adjustments),
	);

	it("adds both allowances to earnings", () => {
		expect(lineByCode(result, "RICE")?.amountCentavos).toBe(200_000);
		expect(lineByCode(result, "TRANSPO")?.amountCentavos).toBe(100_000);
		expect(result.totalEarningsCentavos).toBe(2_250_000 + 200_000 + 100_000);
	});

	it("keeps a non-taxable allowance out of the tax base", () => {
		expect(result.nonTaxableCentavos).toBe(200_000);
		// Taxable = 22,500 + 1,000 - contributions(900 + 1,125 + 200) = ₱21,275
		expect(result.taxableGrossCentavos).toBe(2_127_500);
	});

	it("deducts the loan without reducing taxable income", () => {
		const loan = lineByCode(result, "SSSLOAN");
		expect(loan?.amountCentavos).toBe(150_000);
		// A loan repayment comes out of net pay; it is not an income reduction.
		expect(loan?.reducesTaxableGross).toBe(false);
	});

	it("reconciles", () => {
		expect(result.netPayCentavos).toBe(
			result.grossPayCentavos - result.totalDeductionsCentavos,
		);
	});
});

/* -------------------------------------------------------------------------- */
/* Structural invariants and guards                                            */
/* -------------------------------------------------------------------------- */

describe("invariants", () => {
	const cases = [
		computePayslip(input(2026, 8, 1, buildDays(2026, 8, 1))),
		computePayslip(input(2026, 8, 2, buildDays(2026, 8, 2))),
		computePayslip(input(2028, 2, 2, buildDays(2028, 2, 2))),
	];

	it("always has net equal to gross less deductions", () => {
		for (const result of cases) {
			expect(result.netPayCentavos).toBe(
				result.grossPayCentavos - result.totalDeductionsCentavos,
			);
		}
	});

	it("never emits a negative line amount", () => {
		for (const result of cases) {
			for (const line of result.lines) {
				expect(line.amountCentavos, line.code).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it("has section sums matching the reported totals", () => {
		for (const result of cases) {
			const earnings = result.lines
				.filter((l) => l.section === "earnings")
				.reduce((a, l) => a + l.amountCentavos, 0);
			const deductions = result.lines
				.filter((l) => l.section === "deductions")
				.reduce((a, l) => a + l.amountCentavos, 0);
			expect(earnings).toBe(result.totalEarningsCentavos);
			expect(deductions).toBe(result.totalDeductionsCentavos);
		}
	});

	it("gives every line a computation trace", () => {
		for (const result of cases) {
			for (const line of result.lines) {
				expect(line.computation.length, line.code).toBeGreaterThan(0);
			}
		}
	});

	it("is deterministic", () => {
		const a = computePayslip(input(2026, 8, 1, buildDays(2026, 8, 1)));
		const b = computePayslip(input(2026, 8, 1, buildDays(2026, 8, 1)));
		expect(a).toEqual(b);
	});
});

describe("guards", () => {
	it("refuses to finalize when a contribution table is missing", () => {
		const withoutSss = {
			...input(2026, 8, 1, buildDays(2026, 8, 1)),
			statutorySchedules: [PHILHEALTH, PAGIBIG, BIR],
		};
		const result = computePayslip(withoutSss);
		expect(result.canFinalize).toBe(false);
		expect(result.warnings.map((w) => w.code)).toContain("sss_not_configured");
		// And it contributes nothing rather than a silent zero passed off as real.
		expect(lineByCode(result, "SSS_EE")).toBeUndefined();
	});

	it("refuses to finalize when a scheduled workday has no record", () => {
		const days = buildDays(2026, 8, 1);
		const gap = days.findIndex((d) => d.isScheduledWorkday);
		days[gap] = { ...days[gap], hasRecord: false };
		const result = computePayslip(input(2026, 8, 1, days));
		expect(result.canFinalize).toBe(false);
		expect(result.warnings.map((w) => w.code)).toContain("unaccounted_days");
	});

	it("refuses to finalize with no monthly rate set", () => {
		const base = input(2026, 8, 1, buildDays(2026, 8, 1));
		const result = computePayslip({
			...base,
			terms: { ...base.terms, monthlyRateCentavos: 0 },
		});
		expect(result.canFinalize).toBe(false);
		expect(result.warnings.map((w) => w.code)).toContain("no_rate");
	});

	it("honours a tax exemption", () => {
		const base = input(2026, 8, 1, buildDays(2026, 8, 1));
		const result = computePayslip({
			...base,
			terms: { ...base.terms, taxExempt: true },
		});
		expect(lineByCode(result, "BIR_WT")).toBeUndefined();
		expect(result.canFinalize).toBe(true);
	});

	it("records the schedule and bracket used, for later replay", () => {
		const result = computePayslip(input(2026, 8, 1, buildDays(2026, 8, 1)));
		expect(result.snapshot.statutoryScheduleIds.sss).toBe(100);
		expect(result.snapshot.statutoryBracketIds.sss).toBe(1000);
		expect(result.snapshot.engineVersion).toBe(1);
	});
});

describe("snapshot replay", () => {
	it("reproduces a payslip after the contribution tables change", () => {
		const original = computePayslip(input(2026, 8, 1, buildDays(2026, 8, 1)));

		// A later year brings a new SSS schedule with different amounts.
		const revisedSss: StatutoryScheduleData = {
			...SSS,
			id: 101,
			effectiveFrom: "2027-01-01",
			brackets: [
				{ ...SSS.brackets[0], id: 1001, employeeAmountCentavos: 150_000 },
			],
		};
		const replayed = computePayslip({
			...input(2026, 8, 1, buildDays(2026, 8, 1)),
			statutorySchedules: [...SCHEDULES, revisedSss],
		});

		// The 2026 pay date still resolves the 2026 schedule, so the old payslip
		// stays explainable with the rules that were actually applied.
		expect(replayed.snapshot.statutoryScheduleIds.sss).toBe(100);
		expect(replayed.lines).toEqual(original.lines);
		expect(replayed.netPayCentavos).toBe(original.netPayCentavos);
	});
});
