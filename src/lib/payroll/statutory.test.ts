import { describe, expect, it } from "vitest";
import {
	allocateToCutoff,
	computePagibig,
	computePhilhealth,
	computeSss,
	computeWithholdingTax,
	findBracket,
	isScheduleUsable,
	resolveSchedule,
	type StatutoryBracketData,
	type StatutoryScheduleData,
	scheduleProblem,
} from "./statutory.ts";

/**
 * Every figure below is invented purely to exercise the arithmetic. None of it
 * is a real contribution rate, and the app ships with these tables empty by
 * design.
 */
const bracket = (
	over: Partial<StatutoryBracketData> & { id: number },
): StatutoryBracketData => ({
	periodType: "monthly",
	rangeFromCentavos: 0,
	rangeToCentavos: null,
	salaryCreditCentavos: null,
	employeeAmountCentavos: null,
	employerAmountCentavos: null,
	employerEcAmountCentavos: null,
	employeeMpfCentavos: null,
	employerMpfCentavos: null,
	employeeRatePpm: null,
	employerRatePpm: null,
	capCentavos: null,
	baseAmountCentavos: null,
	excessRatePpm: null,
	...over,
});

const schedule = (
	over: Partial<StatutoryScheduleData> & { id: number; kind: never | string },
): StatutoryScheduleData =>
	({
		userId: null,
		name: "test",
		effectiveFrom: "2026-01-01",
		effectiveTo: null,
		ratePpm: null,
		employeeSharePpm: null,
		floorCentavos: null,
		ceilingCentavos: null,
		sourceCitation: "test fixture",
		verifiedAt: null,
		brackets: [],
		...over,
	}) as StatutoryScheduleData;

describe("resolveSchedule", () => {
	const global2025 = schedule({
		id: 1,
		kind: "sss",
		effectiveFrom: "2025-01-01",
		effectiveTo: "2025-12-31",
	});
	const global2026 = schedule({
		id: 2,
		kind: "sss",
		effectiveFrom: "2026-01-01",
	});
	const mine2026 = schedule({
		id: 3,
		kind: "sss",
		effectiveFrom: "2026-01-01",
		userId: "user_a",
	});

	it("picks the schedule in force on the pay date", () => {
		expect(
			resolveSchedule([global2025, global2026], "sss", "2025-06-15")?.id,
		).toBe(1);
		expect(
			resolveSchedule([global2025, global2026], "sss", "2026-06-15")?.id,
		).toBe(2);
	});

	it("is correct on both sides of the seam", () => {
		expect(
			resolveSchedule([global2025, global2026], "sss", "2025-12-31")?.id,
		).toBe(1);
		expect(
			resolveSchedule([global2025, global2026], "sss", "2026-01-01")?.id,
		).toBe(2);
	});

	it("prefers the user's own override", () => {
		expect(
			resolveSchedule([global2026, mine2026], "sss", "2026-06-15")?.id,
		).toBe(3);
	});

	it("does not mix schemes", () => {
		const philhealth = schedule({ id: 9, kind: "philhealth" });
		expect(resolveSchedule([philhealth], "sss", "2026-06-15")).toBeNull();
	});

	it("returns null rather than a silent default when nothing covers the date", () => {
		expect(resolveSchedule([global2026], "sss", "2025-06-15")).toBeNull();
		expect(resolveSchedule([], "sss", "2026-06-15")).toBeNull();
	});
});

describe("findBracket", () => {
	const brackets = [
		bracket({ id: 1, rangeFromCentavos: 0, rangeToCentavos: 999_999 }),
		bracket({
			id: 2,
			rangeFromCentavos: 1_000_000,
			rangeToCentavos: 1_999_999,
		}),
		bracket({ id: 3, rangeFromCentavos: 2_000_000, rangeToCentavos: null }),
	];

	it("finds the containing bracket", () => {
		expect(findBracket(brackets, 500_000, "monthly")?.id).toBe(1);
		expect(findBracket(brackets, 1_500_000, "monthly")?.id).toBe(2);
		expect(findBracket(brackets, 5_000_000, "monthly")?.id).toBe(3);
	});

	it("is inclusive at both bounds", () => {
		expect(findBracket(brackets, 999_999, "monthly")?.id).toBe(1);
		expect(findBracket(brackets, 1_000_000, "monthly")?.id).toBe(2);
		expect(findBracket(brackets, 1_999_999, "monthly")?.id).toBe(2);
		expect(findBracket(brackets, 2_000_000, "monthly")?.id).toBe(3);
	});

	it("clamps below the lowest and rests in the open-ended top", () => {
		const above = [
			bracket({ id: 5, rangeFromCentavos: 100_000, rangeToCentavos: 199_999 }),
		];
		expect(findBracket(above, 1, "monthly")?.id).toBe(5);
		expect(findBracket(above, 99_999_999, "monthly")?.id).toBe(5);
	});

	it("respects the period type", () => {
		const mixed = [
			bracket({ id: 10, periodType: "monthly", rangeFromCentavos: 0 }),
			bracket({ id: 11, periodType: "semi_monthly", rangeFromCentavos: 0 }),
		];
		expect(findBracket(mixed, 100, "semi_monthly")?.id).toBe(11);
		expect(findBracket(mixed, 100, "annual")).toBeNull();
	});
});

describe("unconfigured schemes", () => {
	it("report themselves as unconfigured rather than contributing zero silently", () => {
		for (const result of [
			computeSss(4_500_000, null),
			computePhilhealth(4_500_000, null),
			computePagibig(4_500_000, null),
			computeWithholdingTax(2_000_000, null),
		]) {
			expect(result.configured).toBe(false);
			expect(result.employeeCentavos).toBe(0);
			expect(result.computation).toMatch(/No .* schedule is configured/);
		}
	});
});

describe("computeSss", () => {
	const sss = schedule({
		id: 1,
		kind: "sss",
		brackets: [
			bracket({
				id: 20,
				rangeFromCentavos: 0,
				rangeToCentavos: 4_999_999,
				salaryCreditCentavos: 2_000_000,
				employeeAmountCentavos: 90_000,
				employerAmountCentavos: 190_000,
				employerEcAmountCentavos: 1_000,
				employeeMpfCentavos: 5_000,
				employerMpfCentavos: 10_000,
			}),
		],
	});

	it("sums the published employee amounts including MPF", () => {
		const result = computeSss(4_500_000, sss);
		expect(result.employeeCentavos).toBe(95_000);
		expect(result.employerCentavos).toBe(201_000);
		expect(result.bracketId).toBe(20);
		expect(result.configured).toBe(true);
	});

	it("records a trace naming the bracket", () => {
		expect(computeSss(4_500_000, sss).computation).toContain("salary credit");
	});
});

describe("computePhilhealth", () => {
	const philhealth = schedule({
		id: 2,
		kind: "philhealth",
		ratePpm: 50_000, // 5%
		employeeSharePpm: 500_000, // half
		floorCentavos: 1_000_000,
		ceilingCentavos: 10_000_000,
	});

	it("takes a percentage and halves it", () => {
		// 5% of ₱45,000 = ₱2,250; employee half is ₱1,125.
		const result = computePhilhealth(4_500_000, philhealth);
		expect(result.employeeCentavos).toBe(112_500);
		expect(result.employerCentavos).toBe(112_500);
	});

	it("clamps to the floor and the ceiling", () => {
		const low = computePhilhealth(100_000, philhealth);
		expect(low.basisCentavos).toBe(1_000_000);
		expect(low.employeeCentavos).toBe(25_000); // 5% of 10,000, halved

		const high = computePhilhealth(50_000_000, philhealth);
		expect(high.basisCentavos).toBe(10_000_000);
		expect(high.employeeCentavos).toBe(250_000);
	});

	it("splits the premium so the two shares sum back to it", () => {
		// 5% of an odd basis leaves a premium that does not halve evenly.
		const basis = 4_500_003;
		const result = computePhilhealth(basis, philhealth);
		const premium = Math.round((basis * 5) / 100);
		expect(result.employeeCentavos + result.employerCentavos).toBe(premium);
		expect(result.employeeCentavos).toBeGreaterThan(0);
	});
});

describe("computePagibig", () => {
	const pagibig = schedule({
		id: 3,
		kind: "pagibig",
		brackets: [
			bracket({
				id: 30,
				rangeFromCentavos: 0,
				rangeToCentavos: 150_000,
				employeeRatePpm: 10_000, // 1%
				employerRatePpm: 20_000,
				capCentavos: 1_000_000,
			}),
			bracket({
				id: 31,
				rangeFromCentavos: 150_001,
				rangeToCentavos: null,
				employeeRatePpm: 20_000, // 2%
				employerRatePpm: 20_000,
				capCentavos: 1_000_000,
			}),
		],
	});

	it("applies the tier rate against capped compensation", () => {
		// ₱45,000 is above the cap of ₱10,000, so 2% of ₱10,000 = ₱200.
		const result = computePagibig(4_500_000, pagibig);
		expect(result.bracketId).toBe(31);
		expect(result.basisCentavos).toBe(1_000_000);
		expect(result.employeeCentavos).toBe(20_000);
	});

	it("uses the lower tier below the threshold", () => {
		const result = computePagibig(100_000, pagibig);
		expect(result.bracketId).toBe(30);
		expect(result.employeeCentavos).toBe(1_000); // 1% of ₱1,000
	});
});

describe("computeWithholdingTax", () => {
	const bir = schedule({
		id: 4,
		kind: "withholding_tax",
		brackets: [
			bracket({
				id: 40,
				periodType: "semi_monthly",
				rangeFromCentavos: 0,
				rangeToCentavos: 1_041_999,
				baseAmountCentavos: 0,
				excessRatePpm: 0,
			}),
			bracket({
				id: 41,
				periodType: "semi_monthly",
				rangeFromCentavos: 1_042_000,
				rangeToCentavos: 1_666_599,
				baseAmountCentavos: 0,
				excessRatePpm: 150_000, // 15%
			}),
			bracket({
				id: 42,
				periodType: "semi_monthly",
				rangeFromCentavos: 1_666_600,
				rangeToCentavos: null,
				baseAmountCentavos: 93_690,
				excessRatePpm: 200_000, // 20%
			}),
		],
	});

	it("is zero inside the exempt bracket", () => {
		expect(computeWithholdingTax(1_000_000, bir).employeeCentavos).toBe(0);
	});

	it("charges only the excess over the bracket floor", () => {
		// ₱12,000 taxable: 15% of (12,000 - 10,420) = 15% of 1,580 = ₱237.
		expect(computeWithholdingTax(1_200_000, bir).employeeCentavos).toBe(23_700);
	});

	it("adds the base amount in a higher bracket", () => {
		// ₱20,000: 936.90 + 20% of (20,000 - 16,666) = 936.90 + 666.80 = ₱1,603.70
		expect(computeWithholdingTax(2_000_000, bir).employeeCentavos).toBe(
			160_370,
		);
	});

	it("charges exactly the base amount at a bracket floor", () => {
		expect(computeWithholdingTax(1_666_600, bir).employeeCentavos).toBe(93_690);
	});

	it("never refunds on zero or negative taxable pay", () => {
		// A cutoff eaten by absences reduces taxable pay; it must not create a
		// negative tax.
		expect(computeWithholdingTax(0, bir).employeeCentavos).toBe(0);
		expect(computeWithholdingTax(-500_000, bir).employeeCentavos).toBe(0);
	});

	it("uses the table for the stated frequency", () => {
		expect(computeWithholdingTax(2_000_000, bir, "monthly").configured).toBe(
			false,
		);
	});
});

describe("allocateToCutoff", () => {
	it("places the whole amount on the chosen cutoff", () => {
		expect(allocateToCutoff(100_000, "first_cutoff", 1)).toBe(100_000);
		expect(allocateToCutoff(100_000, "first_cutoff", 2)).toBe(0);
		expect(allocateToCutoff(100_000, "second_cutoff", 1)).toBe(0);
		expect(allocateToCutoff(100_000, "second_cutoff", 2)).toBe(100_000);
	});

	it("splits evenly without losing a centavo", () => {
		for (const amount of [0, 1, 99, 100_001, 123_457]) {
			const first = allocateToCutoff(amount, "split_even", 1);
			const second = allocateToCutoff(amount, "split_even", 2);
			expect(first + second, String(amount)).toBe(amount);
		}
	});

	it("applies every cutoff for per-cutoff items such as tax", () => {
		expect(allocateToCutoff(50_000, "every_cutoff", 1)).toBe(50_000);
		expect(allocateToCutoff(50_000, "every_cutoff", 2)).toBe(50_000);
	});
});

describe("isScheduleUsable", () => {
	it("rejects a PhilHealth table saved without a rate", () => {
		// The exact shape that let Settings say "Configured" while the payslip
		// refused to finalize.
		const noRate = schedule({
			id: 1,
			kind: "philhealth",
			employeeSharePpm: 500_000,
		});
		expect(isScheduleUsable(noRate)).toBe(false);
		expect(scheduleProblem(noRate)).toMatch(/premium rate/i);
		expect(computePhilhealth(4_500_000, noRate).configured).toBe(false);
	});

	it("rejects a zero rate as well as a missing one", () => {
		expect(
			isScheduleUsable(schedule({ id: 2, kind: "philhealth", ratePpm: 0 })),
		).toBe(false);
	});

	it("accepts a PhilHealth table with a real rate", () => {
		expect(
			isScheduleUsable(
				schedule({ id: 3, kind: "philhealth", ratePpm: 50_000 }),
			),
		).toBe(true);
	});

	it("rejects a bracketed scheme with no bracket rows", () => {
		for (const kind of ["sss", "pagibig", "withholding_tax"] as const) {
			const empty = schedule({ id: 4, kind });
			expect(isScheduleUsable(empty), kind).toBe(false);
			expect(scheduleProblem(empty), kind).toMatch(/bracket/i);
		}
	});

	it("accepts a bracketed scheme once a row exists", () => {
		expect(
			isScheduleUsable(
				schedule({ id: 5, kind: "sss", brackets: [bracket({ id: 50 })] }),
			),
		).toBe(true);
	});
});
