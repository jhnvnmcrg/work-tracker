import { describe, expect, it } from "vitest";
import { microsToCentavos } from "./money.ts";
import {
	type BaseSplitContext,
	deriveRateBasis,
	minutesToCentavos,
	splitMonthlyBase,
} from "./rates.ts";

/** ₱45,000.00 a month. */
const MONTHLY = 4_500_000;

const basis = (
	factorX100 = 31_300,
	rateRoundingMode: "amounts_only" | "round_rates" = "amounts_only",
) =>
	deriveRateBasis({
		monthlyRateCentavos: MONTHLY,
		workingDaysFactorX100: factorX100,
		dailyHours: 8,
		rateRoundingMode,
	});

describe("deriveRateBasis", () => {
	it("derives the 313-factor daily and hourly rates", () => {
		const rates = basis(31_300);
		// 45,000 x 12 / 313 = 1,725.2396... -> ₱1,725.24
		expect(rates.dailyCentavos).toBe(172_524);
		// 1,725.2396 / 8 = 215.6549... -> ₱215.65
		expect(rates.hourlyCentavos).toBe(21_565);
	});

	it("derives the 261-factor rates", () => {
		const rates = basis(26_100);
		// 45,000 x 12 / 261 = 2,068.9655... -> ₱2,068.97
		expect(rates.dailyCentavos).toBe(206_897);
		expect(rates.hourlyCentavos).toBe(25_862);
	});

	it("derives the 365-factor rates", () => {
		const rates = basis(36_500);
		// 45,000 x 12 / 365 = 1,479.4520... -> ₱1,479.45
		expect(rates.dailyCentavos).toBe(147_945);
	});

	it("keeps intermediate rates unrounded by default", () => {
		const rates = basis();
		expect(rates.dailyMicroCentavos).not.toBe(rates.dailyCentavos * 1_000_000);
		expect(microsToCentavos(rates.dailyMicroCentavos)).toBe(
			rates.dailyCentavos,
		);
	});

	it("collapses the hourly rate first when the policy says to", () => {
		const rounded = basis(31_300, "round_rates");
		expect(rounded.hourlyMicroCentavos).toBe(
			rounded.hourlyCentavos * 1_000_000,
		);
		// Which yields a different eight-hour day than carrying precision through
		// — exactly the reconciliation difference the mode exists to reproduce.
		const carried = basis(31_300, "amounts_only");
		expect(rounded.dailyMicroCentavos).not.toBe(carried.dailyMicroCentavos);
	});

	it("scales linearly with the monthly rate", () => {
		const single = deriveRateBasis({
			monthlyRateCentavos: 1_000_000,
			workingDaysFactorX100: 31_300,
			dailyHours: 8,
			rateRoundingMode: "amounts_only",
		});
		const double = deriveRateBasis({
			monthlyRateCentavos: 2_000_000,
			workingDaysFactorX100: 31_300,
			dailyHours: 8,
			rateRoundingMode: "amounts_only",
		});
		expect(double.dailyMicroCentavos).toBe(single.dailyMicroCentavos * 2);
	});

	it("handles a very large salary without losing precision", () => {
		const rates = deriveRateBasis({
			monthlyRateCentavos: 100_000_000, // ₱1,000,000
			workingDaysFactorX100: 31_300,
			dailyHours: 8,
			rateRoundingMode: "amounts_only",
		});
		expect(Number.isSafeInteger(rates.dailyMicroCentavos)).toBe(true);
		expect(rates.dailyCentavos).toBe(3_833_866); // ₱38,338.66
	});

	it("rejects a nonsensical factor or hours", () => {
		expect(() =>
			deriveRateBasis({
				monthlyRateCentavos: MONTHLY,
				workingDaysFactorX100: 0,
				dailyHours: 8,
				rateRoundingMode: "amounts_only",
			}),
		).toThrow(/factor/);
		expect(() =>
			deriveRateBasis({
				monthlyRateCentavos: MONTHLY,
				workingDaysFactorX100: 31_300,
				dailyHours: 0,
				rateRoundingMode: "amounts_only",
			}),
		).toThrow(/hours/);
	});
});

describe("minutesToCentavos", () => {
	it("prices an eight-hour day at the daily rate", () => {
		const rates = basis();
		expect(minutesToCentavos(480, rates.minuteMicroCentavos)).toBe(
			rates.dailyCentavos,
		);
	});

	it("prices two minutes of lateness", () => {
		const rates = basis();
		// 1,725.2396 / 480 = 3.5942 per minute; two minutes is ₱7.19.
		expect(minutesToCentavos(2, rates.minuteMicroCentavos)).toBe(719);
	});
});

describe("splitMonthlyBase", () => {
	const ctx: BaseSplitContext = {
		workingDaysInCutoff: 11,
		workingDaysInMonth: 21,
		calendarDaysInCutoff: 16,
		calendarDaysInMonth: 31,
		rates: basis(),
	};

	it("splits a month in half", () => {
		expect(splitMonthlyBase(MONTHLY, 1, "half_month_flat", ctx)).toBe(
			2_250_000,
		);
		expect(splitMonthlyBase(MONTHLY, 2, "half_month_flat", ctx)).toBe(
			2_250_000,
		);
	});

	it("puts an odd centavo on the second cutoff", () => {
		const odd = 4_500_001;
		expect(splitMonthlyBase(odd, 1, "half_month_flat", ctx)).toBe(2_250_000);
		expect(splitMonthlyBase(odd, 2, "half_month_flat", ctx)).toBe(2_250_001);
	});

	it("always has the two halves sum to the month", () => {
		// The invariant that keeps twelve months summing to the annual salary.
		for (let monthly = 0; monthly <= 200_003; monthly += 997) {
			const first = splitMonthlyBase(monthly, 1, "half_month_flat", ctx);
			const second = splitMonthlyBase(monthly, 2, "half_month_flat", ctx);
			expect(first + second, String(monthly)).toBe(monthly);
		}
	});

	it("does not shrink the base for a short February cutoff", () => {
		// Cutoff 2 of February is 12 days against 16 for cutoff 1, but a monthly
		// salary buys the month, not the days.
		const february: BaseSplitContext = {
			...ctx,
			calendarDaysInCutoff: 12,
			calendarDaysInMonth: 28,
			workingDaysInCutoff: 8,
		};
		expect(splitMonthlyBase(MONTHLY, 2, "half_month_flat", february)).toBe(
			2_250_000,
		);
	});

	it("supports the alternative modes for employers who do it differently", () => {
		const daily = splitMonthlyBase(MONTHLY, 1, "daily_rate_working_days", ctx);
		expect(daily).toBe(microsToCentavos(11 * ctx.rates.dailyMicroCentavos));

		// 45,000 x 16 / 31
		expect(splitMonthlyBase(MONTHLY, 1, "calendar_proration", ctx)).toBe(
			2_322_581,
		);
	});
});
