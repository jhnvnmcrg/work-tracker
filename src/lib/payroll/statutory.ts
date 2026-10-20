/**
 * Statutory contributions and withholding tax.
 *
 * No rates, brackets, floors, ceilings or tax tables appear in this file, and
 * none ever should. They change by legislation and circular, on schedules that
 * do not align with calendar years, and a plausible-looking wrong number in a
 * payroll system is far more dangerous than an obviously missing one. This
 * module supplies the *shape* and the lookup; the values are entered by the user
 * and carry a citation and a verified-on date.
 *
 * The lookup is deliberately uniform across all four schemes: resolve the
 * schedule in force on the pay date, then find the bracket containing the basis
 * amount. Only the arithmetic that follows differs.
 */

import {
	applyPpm,
	type Centavos,
	formatPeso,
	mulDivRound,
	type Ppm,
} from "./money.ts";

import type { DeductionTiming, StatutoryKind, TaxPeriodType } from "./types.ts";

// Defined once in types.ts so the Postgres enums cannot drift from them, and
// re-exported here because this is where callers expect to find them.
export type { DeductionTiming, StatutoryKind, TaxPeriodType };

export interface StatutoryBracketData {
	id: number;
	periodType: TaxPeriodType;
	rangeFromCentavos: Centavos;
	/** Null marks the open-ended top bracket. */
	rangeToCentavos: Centavos | null;

	/* SSS publishes an amount table, not a formula. */
	salaryCreditCentavos: Centavos | null;
	employeeAmountCentavos: Centavos | null;
	employerAmountCentavos: Centavos | null;
	employerEcAmountCentavos: Centavos | null;
	employeeMpfCentavos: Centavos | null;
	employerMpfCentavos: Centavos | null;

	/* Pag-IBIG uses tiered rates against a capped compensation. */
	employeeRatePpm: Ppm | null;
	employerRatePpm: Ppm | null;
	capCentavos: Centavos | null;

	/* BIR marginal brackets: base + (basis - floor) x rate. */
	baseAmountCentavos: Centavos | null;
	excessRatePpm: Ppm | null;
}

export interface StatutoryScheduleData {
	id: number;
	userId: string | null;
	kind: StatutoryKind;
	name: string;
	effectiveFrom: string;
	effectiveTo: string | null;

	/* PhilHealth is a flat percentage between a floor and a ceiling. */
	ratePpm: Ppm | null;
	employeeSharePpm: Ppm | null;
	floorCentavos: Centavos | null;
	ceilingCentavos: Centavos | null;

	sourceCitation: string | null;
	verifiedAt: string | null;
	brackets: StatutoryBracketData[];
}

export interface StatutoryResult {
	kind: StatutoryKind;
	configured: boolean;
	employeeCentavos: Centavos;
	employerCentavos: Centavos;
	basisCentavos: Centavos;
	scheduleId: number | null;
	bracketId: number | null;
	/** Human-readable derivation, persisted onto the payslip line. */
	computation: string;
	ruleReference: string | null;
}

function notConfigured(kind: StatutoryKind, basis: Centavos): StatutoryResult {
	return {
		kind,
		configured: false,
		employeeCentavos: 0,
		employerCentavos: 0,
		basisCentavos: basis,
		scheduleId: null,
		bracketId: null,
		computation: `No ${kind} schedule is configured for this pay date.`,
		ruleReference: null,
	};
}

/**
 * The schedule in force on `payDate`.
 *
 * A row owned by the user beats a seeded global row covering the same date, so
 * a correction can be made without changing anyone else's payroll. Among equals,
 * the most recently started wins.
 *
 * Returns null rather than a zero when nothing covers the date. A missing
 * schedule must surface as a blocking warning, never as a contribution of zero.
 */
export function resolveSchedule(
	schedules: readonly StatutoryScheduleData[],
	kind: StatutoryKind,
	payDate: string,
): StatutoryScheduleData | null {
	const covering = schedules.filter(
		(schedule) =>
			schedule.kind === kind &&
			schedule.effectiveFrom <= payDate &&
			(schedule.effectiveTo === null || schedule.effectiveTo >= payDate),
	);
	if (covering.length === 0) return null;

	const owned = covering.filter((schedule) => schedule.userId !== null);
	const pool = owned.length > 0 ? owned : covering;

	let best = pool[0];
	for (const schedule of pool) {
		if (schedule.effectiveFrom > best.effectiveFrom) best = schedule;
	}
	return best;
}

/**
 * The bracket containing `basis`.
 *
 * Ranges are inclusive at both ends. A basis below the lowest bracket clamps to
 * it and a basis above the highest falls in the open-ended top bracket, which is
 * how published contribution tables are meant to be read.
 */
export function findBracket(
	brackets: readonly StatutoryBracketData[],
	basis: Centavos,
	periodType: TaxPeriodType,
): StatutoryBracketData | null {
	const applicable = brackets
		.filter((bracket) => bracket.periodType === periodType)
		.sort((a, b) => a.rangeFromCentavos - b.rangeFromCentavos);
	if (applicable.length === 0) return null;

	for (const bracket of applicable) {
		const withinLower = basis >= bracket.rangeFromCentavos;
		const withinUpper =
			bracket.rangeToCentavos === null || basis <= bracket.rangeToCentavos;
		if (withinLower && withinUpper) return bracket;
	}

	// Below the lowest bracket clamps to it; above the highest takes the top.
	return basis < applicable[0].rangeFromCentavos
		? applicable[0]
		: applicable[applicable.length - 1];
}

/* -------------------------------------------------------------------------- */

/** SSS: a bracketed table of published amounts, including the WISP/MPF split. */
export function computeSss(
	monthlyBasis: Centavos,
	schedule: StatutoryScheduleData | null,
): StatutoryResult {
	if (!schedule) return notConfigured("sss", monthlyBasis);
	const bracket = findBracket(schedule.brackets, monthlyBasis, "monthly");
	if (!bracket) return notConfigured("sss", monthlyBasis);

	const employee =
		(bracket.employeeAmountCentavos ?? 0) + (bracket.employeeMpfCentavos ?? 0);
	const employer =
		(bracket.employerAmountCentavos ?? 0) +
		(bracket.employerMpfCentavos ?? 0) +
		(bracket.employerEcAmountCentavos ?? 0);

	const credit = bracket.salaryCreditCentavos;
	return {
		kind: "sss",
		configured: true,
		employeeCentavos: employee,
		employerCentavos: employer,
		basisCentavos: monthlyBasis,
		scheduleId: schedule.id,
		bracketId: bracket.id,
		computation: `Monthly compensation ${formatPeso(monthlyBasis)} falls in the ${
			credit === null ? "applicable" : `${formatPeso(credit)} salary credit`
		} bracket; employee share ${formatPeso(employee)}.`,
		ruleReference: schedule.sourceCitation,
	};
}

/** PhilHealth: a percentage of basic salary, clamped between floor and ceiling. */
export function computePhilhealth(
	monthlyBasis: Centavos,
	schedule: StatutoryScheduleData | null,
): StatutoryResult {
	if (!schedule || schedule.ratePpm === null || schedule.ratePpm <= 0) {
		return notConfigured("philhealth", monthlyBasis);
	}

	const floor = schedule.floorCentavos ?? 0;
	const ceiling = schedule.ceilingCentavos ?? Number.MAX_SAFE_INTEGER;
	const clamped = Math.min(Math.max(monthlyBasis, floor), ceiling);

	const premium = applyPpm(clamped, schedule.ratePpm);
	// Halved by default: the premium is conventionally shared equally.
	const employeeShare = schedule.employeeSharePpm ?? 500_000;
	const employee = applyPpm(premium, employeeShare);

	return {
		kind: "philhealth",
		configured: true,
		employeeCentavos: employee,
		employerCentavos: premium - employee,
		basisCentavos: clamped,
		scheduleId: schedule.id,
		bracketId: null,
		computation: `${(schedule.ratePpm / 10_000).toFixed(2)}% of ${formatPeso(
			clamped,
		)}${clamped !== monthlyBasis ? " (clamped to the schedule's range)" : ""} = ${formatPeso(
			premium,
		)}; employee share ${formatPeso(employee)}.`,
		ruleReference: schedule.sourceCitation,
	};
}

/** Pag-IBIG: a tiered rate applied to compensation capped by the bracket. */
export function computePagibig(
	monthlyBasis: Centavos,
	schedule: StatutoryScheduleData | null,
): StatutoryResult {
	if (!schedule) return notConfigured("pagibig", monthlyBasis);
	const bracket = findBracket(schedule.brackets, monthlyBasis, "monthly");
	if (!bracket) return notConfigured("pagibig", monthlyBasis);

	const capped =
		bracket.capCentavos === null
			? monthlyBasis
			: Math.min(monthlyBasis, bracket.capCentavos);

	const employee = applyPpm(capped, bracket.employeeRatePpm ?? 0);
	const employer = applyPpm(capped, bracket.employerRatePpm ?? 0);

	return {
		kind: "pagibig",
		configured: true,
		employeeCentavos: employee,
		employerCentavos: employer,
		basisCentavos: capped,
		scheduleId: schedule.id,
		bracketId: bracket.id,
		computation: `${((bracket.employeeRatePpm ?? 0) / 10_000).toFixed(
			2,
		)}% of ${formatPeso(capped)}${
			bracket.capCentavos !== null && capped !== monthlyBasis ? " (capped)" : ""
		} = ${formatPeso(employee)}.`,
		ruleReference: schedule.sourceCitation,
	};
}

/**
 * BIR withholding tax on this cutoff's taxable compensation.
 *
 * Marginal: `base + (taxable - bracketFloor) x excessRate`. The result is
 * floored at zero — a cutoff with heavy absences reduces taxable pay but must
 * never generate a refund.
 *
 * BIR publishes a separate table per payroll frequency, so `periodType` is a
 * first-class lookup dimension rather than something derived by scaling.
 */
export function computeWithholdingTax(
	taxableCentavos: Centavos,
	schedule: StatutoryScheduleData | null,
	periodType: TaxPeriodType = "semi_monthly",
): StatutoryResult {
	if (!schedule) return notConfigured("withholding_tax", taxableCentavos);

	if (taxableCentavos <= 0) {
		return {
			kind: "withholding_tax",
			configured: true,
			employeeCentavos: 0,
			employerCentavos: 0,
			basisCentavos: taxableCentavos,
			scheduleId: schedule.id,
			bracketId: null,
			computation:
				"Taxable compensation is zero or negative, so no tax is withheld.",
			ruleReference: schedule.sourceCitation,
		};
	}

	const bracket = findBracket(schedule.brackets, taxableCentavos, periodType);
	if (!bracket) return notConfigured("withholding_tax", taxableCentavos);

	const base = bracket.baseAmountCentavos ?? 0;
	const excess = Math.max(0, taxableCentavos - bracket.rangeFromCentavos);
	const onExcess = applyPpm(excess, bracket.excessRatePpm ?? 0);
	const tax = Math.max(0, base + onExcess);

	return {
		kind: "withholding_tax",
		configured: true,
		employeeCentavos: tax,
		employerCentavos: 0,
		basisCentavos: taxableCentavos,
		scheduleId: schedule.id,
		bracketId: bracket.id,
		computation: `${formatPeso(base)} + ${(
			(bracket.excessRatePpm ?? 0) / 10_000
		).toFixed(2)}% of ${formatPeso(excess)} over ${formatPeso(
			bracket.rangeFromCentavos,
		)} = ${formatPeso(tax)}.`,
		ruleReference: schedule.sourceCitation,
	};
}

/* -------------------------------------------------------------------------- */

/**
 * Allocates a monthly contribution to one cutoff.
 *
 * SSS, PhilHealth and Pag-IBIG are computed on *monthly* compensation and then
 * placed on a cutoff. Withholding tax is genuinely per-cutoff and uses
 * `every_cutoff`, where the caller has already computed the right figure.
 *
 * `split_even` uses an exact split, so the two halves always sum to the monthly
 * amount rather than drifting by a centavo.
 */
export function allocateToCutoff(
	monthlyAmount: Centavos,
	timing: DeductionTiming,
	half: 1 | 2,
): Centavos {
	switch (timing) {
		case "first_cutoff":
			return half === 1 ? monthlyAmount : 0;
		case "second_cutoff":
			return half === 2 ? monthlyAmount : 0;
		case "split_even": {
			const first = Math.trunc(monthlyAmount / 2);
			return half === 1 ? first : monthlyAmount - first;
		}
		case "every_cutoff":
			return monthlyAmount;
	}
}

/** Formats a parts-per-million rate as a percentage for display. */
export function ppmToPercentString(ppm: Ppm): string {
	return `${(ppm / 10_000).toFixed(2)}%`;
}

/** Converts a percentage entered by the user into parts per million. */
export function percentToPpm(percent: number): Ppm {
	return mulDivRound(Math.round(percent * 10_000), 1, 1);
}

/**
 * Whether a schedule can actually produce a contribution.
 *
 * Existing is not the same as being usable. A PhilHealth row saved without a
 * premium rate, or a bracketed scheme saved with no bracket rows, resolves fine
 * but computes nothing — which previously let Settings report "Configured"
 * while the payslip refused to finalize for exactly that table. Both screens
 * now ask this one question.
 */
export function isScheduleUsable(schedule: StatutoryScheduleData): boolean {
	if (schedule.kind === "philhealth") {
		return schedule.ratePpm !== null && schedule.ratePpm > 0;
	}
	// SSS, Pag-IBIG and BIR are all driven by bracket rows.
	return schedule.brackets.length > 0;
}

/** Why a schedule is unusable, phrased for the person who has to fix it. */
export function scheduleProblem(
	schedule: StatutoryScheduleData,
): string | null {
	if (isScheduleUsable(schedule)) return null;
	return schedule.kind === "philhealth"
		? "No premium rate is set, so this table computes nothing."
		: "No bracket rows were entered, so this table computes nothing.";
}
