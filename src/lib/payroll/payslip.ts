/**
 * The payslip orchestrator.
 *
 * Pure by construction: it takes plain data and returns plain data, so it can be
 * unit-tested without a database and so a finalized payslip can be replayed from
 * its own snapshot years later.
 *
 * Two orderings in the pipeline are not negotiable:
 *
 *  1. Base pay is resolved before earnings are built, because with a flat
 *     half-month base you must NOT also add regular pay per worked day. Base is
 *     paid in full; late, undertime and absence are itemised subtractions. Doing
 *     both is the single most likely way to double-pay a cutoff.
 *
 *  2. Statutory contributions are computed before the tax base, because
 *     mandatory contributions are excluded from taxable compensation. Reversing
 *     these two overstates withholding tax on every payslip.
 */

import {
	type Centavos,
	clampAtZero,
	formatPeso,
	sumCentavos,
} from "./money.ts";
import {
	type BasePaySplitMode,
	type BaseSplitContext,
	minutesToCentavos,
	type RateBasis,
	splitMonthlyBase,
} from "./rates.ts";
import {
	allocateToCutoff,
	computePagibig,
	computePhilhealth,
	computeSss,
	computeWithholdingTax,
	type DeductionTiming,
	resolveSchedule,
	type StatutoryResult,
	type StatutoryScheduleData,
} from "./statutory.ts";
import type { CutoffHalf, IsoDate } from "./time.ts";
import type {
	DailyMinutes,
	LineItemCategory,
	LineItemSection,
} from "./types.ts";

export const ENGINE_VERSION = 1;

/** Re-exported under the engine's names; defined once in types.ts. */
export type LineSection = LineItemSection;
export type LineCategory = LineItemCategory;

export interface PayslipLine {
	section: LineSection;
	category: LineCategory;
	code: string;
	label: string;
	quantity: number | null;
	unit: "minutes" | "days" | "fixed" | null;
	rateMicroCentavos: number | null;
	/** Always positive; `section` carries the sign. */
	amountCentavos: Centavos;
	isTaxable: boolean;
	isStatutory: boolean;
	/**
	 * Deliberately independent of `section`. Late, undertime and absence are
	 * *displayed* under deductions, but for tax they reduce compensation income
	 * rather than being deducted from it — treating them as ordinary deductions
	 * computes tax on a gross that was never earned.
	 */
	reducesTaxableGross: boolean;
	sortOrder: number;
	computation: string;
	sourceDates: string[];
	ruleReference: string | null;
}

export interface PayslipWarning {
	code: string;
	message: string;
	dates?: string[];
	blocksFinalize: boolean;
}

export interface DayForPayslip {
	date: IsoDate;
	minutes: DailyMinutes;
	hasRecord: boolean;
	isRestDay: boolean;
	isHoliday: boolean;
	/** True when the schedule expects work on this date. */
	isScheduledWorkday: boolean;
	standardWorkMinutes: number;
}

export interface AdjustmentInput {
	code: string;
	label: string;
	section: LineSection;
	category: LineCategory;
	amountCentavos: Centavos;
	isTaxable: boolean;
	timing: DeductionTiming;
}

export interface PayslipTotals {
	daysPresent: number;
	daysAbsent: number;
	daysOnLeave: number;
	daysHoliday: number;
	regularMinutes: number;
	lateMinutes: number;
	undertimeMinutes: number;
	overtimeMinutes: number;
	nightDiffMinutes: number;
	paidLeaveMinutes: number;
	unpaidMinutes: number;
	unaccountedDates: string[];
}

export interface ComputationSnapshot {
	engineVersion: number;
	employmentTermsId: number | null;
	rates: RateBasis;
	statutoryScheduleIds: Record<string, number | null>;
	statutoryBracketIds: Record<string, number | null>;
	policy: {
		basePaySplitMode: BasePaySplitMode;
		sssTiming: DeductionTiming;
		philhealthTiming: DeductionTiming;
		pagibigTiming: DeductionTiming;
		taxTiming: DeductionTiming;
		taxExempt: boolean;
	};
}

export interface PayslipResult {
	rates: RateBasis;
	totals: PayslipTotals;
	lines: PayslipLine[];
	basePayCentavos: Centavos;
	totalEarningsCentavos: Centavos;
	taxableGrossCentavos: Centavos;
	nonTaxableCentavos: Centavos;
	grossPayCentavos: Centavos;
	totalDeductionsCentavos: Centavos;
	netPayCentavos: Centavos;
	statutory: {
		sss: StatutoryResult;
		philhealth: StatutoryResult;
		pagibig: StatutoryResult;
		withholdingTax: StatutoryResult;
	};
	warnings: PayslipWarning[];
	snapshot: ComputationSnapshot;
	/** False while any statutory table is unconfigured; blocks finalizing. */
	canFinalize: boolean;
}

export interface PayslipInput {
	/** Today in Manila. Passed in so the engine stays pure and testable. */
	today: IsoDate;
	period: {
		year: number;
		month: number;
		half: CutoffHalf;
		startDate: IsoDate;
		endDate: IsoDate;
		payDate: IsoDate;
		dayCount: number;
	};
	terms: {
		id: number | null;
		monthlyRateCentavos: Centavos;
		basePaySplitMode: BasePaySplitMode;
		sssBasisCentavos: Centavos | null;
		philhealthBasisCentavos: Centavos | null;
		pagibigBasisCentavos: Centavos | null;
		sssTiming: DeductionTiming;
		philhealthTiming: DeductionTiming;
		pagibigTiming: DeductionTiming;
		taxTiming: DeductionTiming;
		taxExempt: boolean;
		unaccountedDayPolicy: "warn" | "absent";
	};
	rates: RateBasis;
	days: DayForPayslip[];
	statutorySchedules: readonly StatutoryScheduleData[];
	adjustments: readonly AdjustmentInput[];
	calendarDaysInMonth: number;
}

function aggregate(
	days: readonly DayForPayslip[],
	today: IsoDate,
): PayslipTotals {
	const totals: PayslipTotals = {
		daysPresent: 0,
		daysAbsent: 0,
		daysOnLeave: 0,
		daysHoliday: 0,
		regularMinutes: 0,
		lateMinutes: 0,
		undertimeMinutes: 0,
		overtimeMinutes: 0,
		nightDiffMinutes: 0,
		paidLeaveMinutes: 0,
		unpaidMinutes: 0,
		unaccountedDates: [],
	};

	for (const day of days) {
		const m = day.minutes;
		totals.regularMinutes += m.creditedRegularMinutes;
		totals.lateMinutes += m.lateMinutes;
		totals.undertimeMinutes += m.undertimeMinutes;
		totals.overtimeMinutes += m.overtimeMinutes;
		totals.nightDiffMinutes += m.nightDiffMinutes;
		totals.paidLeaveMinutes += m.paidLeaveMinutes;
		totals.unpaidMinutes += m.unpaidMinutes;

		if (day.isHoliday) totals.daysHoliday += 1;
		if (m.paidLeaveMinutes > 0) totals.daysOnLeave += 1;
		if (m.workedMinutes > 0) totals.daysPresent += 1;
		if (m.unpaidMinutes > 0 && m.workedMinutes === 0) totals.daysAbsent += 1;

		// A scheduled workday with no record is a gap in the record, not an
		// absence — surfaced rather than quietly deducted. Only days that have
		// already happened can be gaps: in a cutoff still in progress the
		// remaining days are simply not worked yet, and reporting them would
		// make every open period look broken.
		if (
			day.isScheduledWorkday &&
			!day.hasRecord &&
			!day.isHoliday &&
			day.date <= today
		) {
			totals.unaccountedDates.push(day.date);
		}
	}

	return totals;
}

export function computePayslip(input: PayslipInput): PayslipResult {
	const { period, terms, rates, days } = input;
	const totals = aggregate(days, input.today);
	const lines: PayslipLine[] = [];
	const warnings: PayslipWarning[] = [];

	const workingDaysInCutoff = days.filter((d) => d.isScheduledWorkday).length;
	const splitContext: BaseSplitContext = {
		workingDaysInCutoff,
		workingDaysInMonth: workingDaysInCutoff * 2,
		calendarDaysInCutoff: period.dayCount,
		calendarDaysInMonth: input.calendarDaysInMonth,
		rates,
	};

	/* -- 1. Base pay. Must precede earnings; see the note at the top. ------- */
	const basePayCentavos = splitMonthlyBase(
		terms.monthlyRateCentavos,
		period.half,
		terms.basePaySplitMode,
		splitContext,
	);

	lines.push({
		section: "earnings",
		category: "base_pay",
		code: "BASIC",
		label: "Basic pay (semi-monthly)",
		quantity: null,
		unit: "fixed",
		rateMicroCentavos: null,
		amountCentavos: basePayCentavos,
		isTaxable: true,
		isStatutory: false,
		reducesTaxableGross: false,
		sortOrder: 10,
		computation:
			terms.basePaySplitMode === "half_month_flat"
				? `Half of the ${formatPeso(terms.monthlyRateCentavos)} monthly rate. A monthly salary buys the month, so this does not shrink for a shorter cutoff.`
				: `Derived from the ${formatPeso(terms.monthlyRateCentavos)} monthly rate using ${terms.basePaySplitMode}.`,
		sourceDates: [],
		ruleReference: null,
	});

	/* -- 2. Overtime -------------------------------------------------------- */
	if (totals.overtimeMinutes > 0) {
		const otDates = days
			.filter((d) => d.minutes.overtimeMinutes > 0)
			.map((d) => d.date);
		const amount = minutesToCentavos(
			totals.overtimeMinutes,
			rates.minuteMicroCentavos,
		);
		lines.push({
			section: "earnings",
			category: "overtime",
			code: "OT",
			label: "Overtime",
			quantity: totals.overtimeMinutes,
			unit: "minutes",
			rateMicroCentavos: rates.minuteMicroCentavos,
			amountCentavos: amount,
			isTaxable: true,
			isStatutory: false,
			reducesTaxableGross: false,
			sortOrder: 20,
			computation: `${(totals.overtimeMinutes / 60).toFixed(2)} hours at the ${formatPeso(rates.hourlyCentavos)} hourly rate. Premium multipliers are not applied in this version.`,
			sourceDates: otDates,
			ruleReference: null,
		});
	}

	/* -- 3. Allowances ------------------------------------------------------ */
	let sortOrder = 30;
	for (const adjustment of input.adjustments) {
		if (adjustment.section !== "earnings") continue;
		const amount = allocateToCutoff(
			adjustment.amountCentavos,
			adjustment.timing,
			period.half,
		);
		if (amount === 0) continue;
		lines.push({
			section: "earnings",
			category: adjustment.category,
			code: adjustment.code,
			label: adjustment.label,
			quantity: null,
			unit: "fixed",
			rateMicroCentavos: null,
			amountCentavos: amount,
			isTaxable: adjustment.isTaxable,
			isStatutory: false,
			reducesTaxableGross: false,
			sortOrder: sortOrder++,
			computation: `Standing ${adjustment.isTaxable ? "taxable" : "non-taxable"} allowance, applied ${adjustment.timing.replace("_", " ")}.`,
			sourceDates: [],
			ruleReference: null,
		});
	}

	/* -- 4. Pay reductions: late, undertime, absence ------------------------
	 * Shown under deductions but flagged as reducing taxable gross. */
	const reductions: Array<
		[LineCategory, string, string, number, "minutes" | "days"]
	> = [
		["late", "LATE", "Late", totals.lateMinutes, "minutes"],
		["undertime", "UT", "Undertime", totals.undertimeMinutes, "minutes"],
	];

	for (const [category, code, label, minutes, unit] of reductions) {
		if (minutes <= 0) continue;
		const dates = days
			.filter((d) =>
				category === "late"
					? d.minutes.lateMinutes > 0
					: d.minutes.undertimeMinutes > 0,
			)
			.map((d) => d.date);
		lines.push({
			section: "deductions",
			category,
			code,
			label,
			quantity: minutes,
			unit,
			rateMicroCentavos: rates.minuteMicroCentavos,
			amountCentavos: minutesToCentavos(minutes, rates.minuteMicroCentavos),
			isTaxable: false,
			isStatutory: false,
			reducesTaxableGross: true,
			sortOrder: 100,
			computation: `${minutes} minutes at ${formatPeso(rates.hourlyCentavos)} per hour.`,
			sourceDates: dates,
			ruleReference: null,
		});
	}

	if (totals.unpaidMinutes > 0) {
		const dates = days
			.filter((d) => d.minutes.unpaidMinutes > 0)
			.map((d) => d.date);
		const days8 = totals.unpaidMinutes / (days[0]?.standardWorkMinutes || 480);
		lines.push({
			section: "deductions",
			category: "absence",
			code: "ABS",
			label: "Absence",
			quantity: totals.unpaidMinutes,
			unit: "minutes",
			rateMicroCentavos: rates.minuteMicroCentavos,
			amountCentavos: minutesToCentavos(
				totals.unpaidMinutes,
				rates.minuteMicroCentavos,
			),
			isTaxable: false,
			isStatutory: false,
			reducesTaxableGross: true,
			sortOrder: 110,
			// Stated per minute because that is how it is computed. Quoting the
			// rounded daily rate would invite a reader to multiply and land a few
			// centavos away from the printed amount.
			computation: `${totals.unpaidMinutes} minutes unpaid (${days8.toFixed(2)} day(s)) at ${formatPeso(rates.hourlyCentavos)} per hour.`,
			sourceDates: dates,
			ruleReference: null,
		});
	}

	/* -- 5. Statutory contributions. MUST precede the tax base. ------------- */
	const monthly = terms.monthlyRateCentavos;
	const sss = computeSss(
		terms.sssBasisCentavos ?? monthly,
		resolveSchedule(input.statutorySchedules, "sss", period.payDate),
	);
	const philhealth = computePhilhealth(
		terms.philhealthBasisCentavos ?? monthly,
		resolveSchedule(input.statutorySchedules, "philhealth", period.payDate),
	);
	const pagibig = computePagibig(
		terms.pagibigBasisCentavos ?? monthly,
		resolveSchedule(input.statutorySchedules, "pagibig", period.payDate),
	);

	const contributions: Array<
		[StatutoryResult, DeductionTiming, LineCategory, string, string, number]
	> = [
		[sss, terms.sssTiming, "sss", "SSS_EE", "SSS", 200],
		[
			philhealth,
			terms.philhealthTiming,
			"philhealth",
			"PHIC_EE",
			"PhilHealth",
			210,
		],
		[pagibig, terms.pagibigTiming, "pagibig", "HDMF_EE", "Pag-IBIG", 220],
	];

	for (const [result, timing, category, code, label, order] of contributions) {
		const amount = allocateToCutoff(
			result.employeeCentavos,
			timing,
			period.half,
		);
		if (!result.configured) {
			warnings.push({
				code: `${category}_not_configured`,
				message: `The ${label} contribution table is not configured for ${period.payDate}. Set it up in Settings before finalizing.`,
				blocksFinalize: true,
			});
		}
		if (amount === 0) continue;
		lines.push({
			section: "deductions",
			category,
			code,
			label,
			quantity: null,
			unit: "fixed",
			rateMicroCentavos: null,
			amountCentavos: amount,
			isTaxable: false,
			isStatutory: true,
			// Mandatory contributions are excluded from taxable compensation.
			reducesTaxableGross: true,
			sortOrder: order,
			computation: `${result.computation} Withheld on the ${timing.replace("_", " ")}.`,
			sourceDates: [],
			ruleReference: result.ruleReference,
		});
	}

	/* -- 6. Tax base, then withholding tax. MUST follow step 5. ------------- */
	const taxableEarnings = sumCentavos(
		lines
			.filter((line) => line.section === "earnings" && line.isTaxable)
			.map((line) => line.amountCentavos),
	);
	const nonTaxableCentavos = sumCentavos(
		lines
			.filter((line) => line.section === "earnings" && !line.isTaxable)
			.map((line) => line.amountCentavos),
	);
	const taxReducing = sumCentavos(
		lines
			.filter((line) => line.reducesTaxableGross)
			.map((line) => line.amountCentavos),
	);
	const taxableGrossCentavos = taxableEarnings - taxReducing;

	const withholdingTax = terms.taxExempt
		? {
				kind: "withholding_tax" as const,
				configured: true,
				employeeCentavos: 0,
				employerCentavos: 0,
				basisCentavos: taxableGrossCentavos,
				scheduleId: null,
				bracketId: null,
				computation: "Exempt from withholding tax.",
				ruleReference: null,
			}
		: computeWithholdingTax(
				taxableGrossCentavos,
				resolveSchedule(
					input.statutorySchedules,
					"withholding_tax",
					period.payDate,
				),
				"semi_monthly",
			);

	if (!withholdingTax.configured) {
		warnings.push({
			code: "withholding_tax_not_configured",
			message: `The withholding tax table is not configured for ${period.payDate}. Set it up in Settings before finalizing.`,
			blocksFinalize: true,
		});
	}

	if (withholdingTax.employeeCentavos > 0) {
		lines.push({
			section: "deductions",
			category: "withholding_tax",
			code: "BIR_WT",
			label: "Withholding tax",
			quantity: null,
			unit: "fixed",
			rateMicroCentavos: null,
			amountCentavos: withholdingTax.employeeCentavos,
			isTaxable: false,
			isStatutory: true,
			reducesTaxableGross: false,
			sortOrder: 230,
			computation: `Taxable compensation ${formatPeso(taxableGrossCentavos)} (earnings less mandatory contributions and pay reductions). ${withholdingTax.computation}`,
			sourceDates: [],
			ruleReference: withholdingTax.ruleReference,
		});
	}

	/* -- 7. Loans and other standing deductions ----------------------------- */
	for (const adjustment of input.adjustments) {
		if (adjustment.section !== "deductions") continue;
		const amount = allocateToCutoff(
			adjustment.amountCentavos,
			adjustment.timing,
			period.half,
		);
		if (amount === 0) continue;
		lines.push({
			section: "deductions",
			category: adjustment.category,
			code: adjustment.code,
			label: adjustment.label,
			quantity: null,
			unit: "fixed",
			rateMicroCentavos: null,
			amountCentavos: amount,
			isTaxable: false,
			isStatutory: false,
			// A loan repayment is paid out of net pay; it does not reduce income.
			reducesTaxableGross: false,
			sortOrder: 300,
			computation: `Standing deduction, applied ${adjustment.timing.replace("_", " ")}.`,
			sourceDates: [],
			ruleReference: null,
		});
	}

	/* -- 8. Totals ---------------------------------------------------------- */
	const totalEarningsCentavos = sumCentavos(
		lines
			.filter((line) => line.section === "earnings")
			.map((line) => line.amountCentavos),
	);
	const totalDeductionsCentavos = sumCentavos(
		lines
			.filter((line) => line.section === "deductions")
			.map((line) => line.amountCentavos),
	);
	const grossPayCentavos = totalEarningsCentavos;
	const netPayCentavos = grossPayCentavos - totalDeductionsCentavos;

	/* -- 9. Warnings -------------------------------------------------------- */
	if (totals.unaccountedDates.length > 0) {
		const periodOpen = input.today <= period.endDate;
		warnings.push({
			code: "unaccounted_days",
			message:
				`${totals.unaccountedDates.length} scheduled workday(s) so far have no time record. Fill them in or mark them before finalizing.` +
				(periodOpen
					? " This cutoff is still open, so later days are not counted here."
					: ""),
			dates: totals.unaccountedDates,
			blocksFinalize: terms.unaccountedDayPolicy === "warn",
		});
	}

	const flagged = days.filter((day) =>
		day.minutes.flags.some(
			(flag) =>
				flag === "missing_punch" ||
				flag === "out_before_in" ||
				flag === "overlapping_sessions",
		),
	);
	if (flagged.length > 0) {
		warnings.push({
			code: "incomplete_records",
			message: `${flagged.length} day(s) have incomplete or inconsistent punches.`,
			dates: flagged.map((day) => day.date),
			blocksFinalize: true,
		});
	}

	if (terms.monthlyRateCentavos <= 0) {
		warnings.push({
			code: "no_rate",
			message: "No monthly rate is set, so this payslip has no basis.",
			blocksFinalize: true,
		});
	}

	/*
	 * The working-days factor has to agree with the actual schedule.
	 *
	 * A flat base pays `basePay / scheduledWorkdays` per working day, while an
	 * absence deducts the factor-derived daily rate. If the two disagree, every
	 * absence is silently over- or under-deducted. Factor 313 assumes a six-day
	 * week (365 less 52 Sundays), so pairing it with a Monday-to-Friday schedule
	 * under-deducts absences by roughly a quarter.
	 */
	if (workingDaysInCutoff > 0 && terms.monthlyRateCentavos > 0) {
		const basePerScheduledDay = Math.round(
			basePayCentavos / workingDaysInCutoff,
		);
		const difference = Math.abs(basePerScheduledDay - rates.dailyCentavos);
		if (difference * 20 > rates.dailyCentavos) {
			warnings.push({
				code: "factor_schedule_mismatch",
				message:
					`Your working-days factor (${(terms.monthlyRateCentavos > 0 ? rates.workingDaysFactorX100 / 100 : 0).toFixed(0)}) gives a daily rate of ${formatPeso(rates.dailyCentavos)}, ` +
					`but this cutoff's base works out to ${formatPeso(basePerScheduledDay)} per scheduled workday. ` +
					"Absences are deducted at the first figure and earned at the second, so they will not balance. " +
					"Factor 313 assumes a six-day week; use 261 for a Monday-to-Friday schedule.",
				blocksFinalize: false,
			});
		}
	}

	if (netPayCentavos < 0) {
		// Deliberately not clamped: a negative net is a real signal, usually of a
		// data-entry error, and hiding it would hide the cause.
		warnings.push({
			code: "negative_net",
			message: `Deductions exceed earnings by ${formatPeso(-netPayCentavos)}. Check the time records for this cutoff.`,
			blocksFinalize: false,
		});
	}

	const premiumDays = days.filter((day) =>
		day.minutes.flags.some(
			(flag) =>
				flag === "holiday_premium_not_applied" ||
				flag === "rest_day_premium_not_applied",
		),
	);
	if (premiumDays.length > 0) {
		warnings.push({
			code: "premiums_not_applied",
			message: `${premiumDays.length} day(s) worked on a holiday or rest day. Premium multipliers are not applied in this version, so those hours are paid at the ordinary rate.`,
			dates: premiumDays.map((day) => day.date),
			blocksFinalize: false,
		});
	}

	lines.sort((a, b) => a.sortOrder - b.sortOrder);

	return {
		rates,
		totals,
		lines,
		basePayCentavos,
		totalEarningsCentavos,
		taxableGrossCentavos: clampAtZero(taxableGrossCentavos),
		nonTaxableCentavos,
		grossPayCentavos,
		totalDeductionsCentavos,
		netPayCentavos,
		statutory: { sss, philhealth, pagibig, withholdingTax },
		warnings,
		snapshot: {
			engineVersion: ENGINE_VERSION,
			employmentTermsId: terms.id,
			rates,
			statutoryScheduleIds: {
				sss: sss.scheduleId,
				philhealth: philhealth.scheduleId,
				pagibig: pagibig.scheduleId,
				withholding_tax: withholdingTax.scheduleId,
			},
			statutoryBracketIds: {
				sss: sss.bracketId,
				philhealth: philhealth.bracketId,
				pagibig: pagibig.bracketId,
				withholding_tax: withholdingTax.bracketId,
			},
			policy: {
				basePaySplitMode: terms.basePaySplitMode,
				sssTiming: terms.sssTiming,
				philhealthTiming: terms.philhealthTiming,
				pagibigTiming: terms.pagibigTiming,
				taxTiming: terms.taxTiming,
				taxExempt: terms.taxExempt,
			},
		},
		canFinalize: !warnings.some((warning) => warning.blocksFinalize),
	};
}
