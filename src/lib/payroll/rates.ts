import {
	type Centavos,
	MICROS_PER_CENTAVO,
	type MicroCentavos,
	microsToCentavos,
	mulDivRound,
	splitCentavosExact,
} from "./money.ts";

export type BasePaySplitMode =
	| "half_month_flat"
	| "daily_rate_working_days"
	| "calendar_proration";

export type RateRoundingMode = "amounts_only" | "round_rates";

export interface RateInputs {
	monthlyRateCentavos: Centavos;
	/** Divisor x 100: 313 is stored as 31300. */
	workingDaysFactorX100: number;
	dailyHours: number;
	rateRoundingMode: RateRoundingMode;
}

export interface RateBasis {
	monthlyCentavos: Centavos;
	workingDaysFactorX100: number;
	dailyHours: number;
	/** Unrounded, carried through the pipeline. */
	dailyMicroCentavos: MicroCentavos;
	hourlyMicroCentavos: MicroCentavos;
	minuteMicroCentavos: MicroCentavos;
	/** Rounded, for display on a payslip only. */
	dailyCentavos: Centavos;
	hourlyCentavos: Centavos;
}

/**
 * Derives daily, hourly and per-minute rates from a monthly salary.
 *
 * Rates are carried as micro-centavos through the whole pipeline and rounded
 * exactly once, at each terminal line-item amount. Rounding the hourly rate
 * first and then multiplying accumulates error across a cutoff.
 *
 * `rateRoundingMode: "round_rates"` deliberately reintroduces that early
 * rounding, because some employers publish an hourly rate to two decimals and
 * multiply from there — and if they do, matching them to the centavo is
 * impossible without doing the same.
 */
export function deriveRateBasis(inputs: RateInputs): RateBasis {
	const { monthlyRateCentavos, workingDaysFactorX100, dailyHours } = inputs;

	if (workingDaysFactorX100 <= 0) {
		throw new Error("Working-days factor must be greater than zero");
	}
	if (dailyHours <= 0) {
		throw new Error("Daily hours must be greater than zero");
	}

	// daily = monthly x 12 / factor, and factor = factorX100 / 100,
	// so daily = monthly x 1200 / factorX100.
	let dailyMicroCentavos = mulDivRound(
		monthlyRateCentavos,
		1200 * MICROS_PER_CENTAVO,
		workingDaysFactorX100,
	);
	let hourlyMicroCentavos = mulDivRound(dailyMicroCentavos, 1, dailyHours);

	if (inputs.rateRoundingMode === "round_rates") {
		const roundedHourly = microsToCentavos(hourlyMicroCentavos);
		hourlyMicroCentavos = roundedHourly * MICROS_PER_CENTAVO;
		dailyMicroCentavos = hourlyMicroCentavos * dailyHours;
	}

	return {
		monthlyCentavos: monthlyRateCentavos,
		workingDaysFactorX100,
		dailyHours,
		dailyMicroCentavos,
		hourlyMicroCentavos,
		minuteMicroCentavos: mulDivRound(hourlyMicroCentavos, 1, 60),
		dailyCentavos: microsToCentavos(dailyMicroCentavos),
		hourlyCentavos: microsToCentavos(hourlyMicroCentavos),
	};
}

/** Converts a minute count at a micro-rate into a rounded amount. */
export function minutesToCentavos(
	minutes: number,
	minuteMicroCentavos: MicroCentavos,
): Centavos {
	return microsToCentavos(minutes * minuteMicroCentavos);
}

/** Converts a day count at a micro-rate into a rounded amount. */
export function daysToCentavos(
	days: number,
	dailyMicroCentavos: MicroCentavos,
): Centavos {
	return microsToCentavos(days * dailyMicroCentavos);
}

export interface BaseSplitContext {
	workingDaysInCutoff: number;
	workingDaysInMonth: number;
	calendarDaysInCutoff: number;
	calendarDaysInMonth: number;
	rates: RateBasis;
}

/**
 * Base pay for one cutoff.
 *
 * `half_month_flat` is the default and the recommended choice. A monthly rate
 * buys the month; splitting it into two payments is a cash-flow convention, not
 * an assertion that the second half of February is worth less than the first.
 *
 * It is also the only mode that reconciles exactly. With a 313-day factor the
 * implied 26.08 working days per month never equals the actual 25, 26 or 27, so
 * `dailyRate x workingDays` leaves twelve months summing to roughly ±₱2,000 off
 * the annual salary — a discrepancy with nowhere sensible to put it.
 *
 * The consequence the caller must respect: with a flat base, regular pay is
 * *not* also added per worked day. Base is paid in full and late, undertime and
 * absence are itemised subtractions.
 */
export function splitMonthlyBase(
	monthlyCentavos: Centavos,
	half: 1 | 2,
	mode: BasePaySplitMode,
	context: BaseSplitContext,
): Centavos {
	switch (mode) {
		case "half_month_flat": {
			// Exact by construction: the two halves always sum to the month.
			const [first, second] = splitCentavosExact(monthlyCentavos, 2);
			return half === 1 ? first : second;
		}
		case "daily_rate_working_days":
			return daysToCentavos(
				context.workingDaysInCutoff,
				context.rates.dailyMicroCentavos,
			);
		case "calendar_proration":
			return mulDivRound(
				monthlyCentavos,
				context.calendarDaysInCutoff,
				context.calendarDaysInMonth,
			);
	}
}
