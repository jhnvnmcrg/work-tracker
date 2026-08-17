import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { findLeaveDaysInRange, findRecordsInRange } from "#/db/repo/dtr.ts";
import { findHolidaysInYear } from "#/db/repo/holidays.ts";
import {
	ensurePayPeriod,
	findActiveAdjustments,
	findPayslipByPeriod,
	findStatutorySchedules,
	listPayslips,
	persistFinalizedPayslip,
	voidPayslip,
} from "#/db/repo/payroll.ts";
import {
	ensureUserBootstrap,
	findEmploymentTerms,
	findSchedules,
	toPunchPolicy,
	toScheduleSnapshot,
} from "#/db/repo/profile.ts";
import { computeDailyMinutes } from "#/lib/payroll/daily.ts";
import { resolveEffective } from "#/lib/payroll/effective.ts";
import {
	type AdjustmentInput,
	computePayslip,
	type DayForPayslip,
	type PayslipResult,
} from "#/lib/payroll/payslip.ts";
import { deriveRateBasis } from "#/lib/payroll/rates.ts";
import {
	cutoffBounds,
	dayOfWeek,
	daysInMonth,
	eachDate,
	parsePeriodKey,
	todayInManila,
} from "#/lib/payroll/time.ts";
import { DEFAULT_PUNCH_POLICY } from "#/lib/payroll/types.ts";
import { periodKeySchema } from "#/schemas/dtr.ts";
import { authedMiddleware } from "./auth.ts";

/**
 * Loads everything a payslip needs and runs the pure engine.
 *
 * This is the only layer that touches the database; `src/lib/payroll/` stays
 * free of it so the engine can be unit-tested and replayed.
 */
async function computeForPeriod(
	userId: string,
	periodKey: string,
): Promise<{
	result: PayslipResult;
	bounds: ReturnType<typeof parsePeriodKey>;
}> {
	await ensureUserBootstrap(userId);
	const bounds = parsePeriodKey(periodKey);

	const [
		terms,
		schedules,
		holidays,
		records,
		leaveDays,
		statutory,
		adjustments,
	] = await Promise.all([
		findEmploymentTerms(userId),
		findSchedules(userId),
		findHolidaysInYear(userId, bounds.year),
		findRecordsInRange(userId, bounds.start, bounds.end),
		findLeaveDaysInRange(userId, bounds.start, bounds.end),
		findStatutorySchedules(userId),
		findActiveAdjustments(userId, bounds.end),
	]);

	const activeTerms = resolveEffective(terms, bounds.end);
	const holidayDates = new Set(holidays.map((h) => h.holidayDate));
	const recordByDate = new Map(records.map((r) => [r.workDate, r]));
	const leaveByDate = new Map(leaveDays.map((l) => [l.leaveDate, l]));
	const today = todayInManila();

	const policy = activeTerms
		? toPunchPolicy(activeTerms)
		: DEFAULT_PUNCH_POLICY;

	const days: DayForPayslip[] = eachDate(bounds.start, bounds.end).map(
		(date) => {
			const schedule = resolveEffective(schedules, date);
			const snapshot = schedule
				? toScheduleSnapshot(
						schedule,
						schedule.days.find((d) => d.weekday === dayOfWeek(date)),
					)
				: null;
			const record = recordByDate.get(date);
			const leaveRow = leaveByDate.get(date);
			const isHoliday = holidayDates.has(date);
			const isRestDay = record?.isRestDay ?? snapshot?.isRestDay ?? false;

			// A stored row already carries engine-computed minutes. Recomputing keeps
			// a preview honest if the schedule or a holiday changed after it was saved.
			const { minutes } = computeDailyMinutes({
				date,
				today,
				punches: {
					amIn: record?.amInMinute ?? null,
					amOut: record?.amOutMinute ?? null,
					pmIn: record?.pmInMinute ?? null,
					pmOut: record?.pmOutMinute ?? null,
				},
				schedule: snapshot,
				dayKind: isHoliday
					? "regular_holiday"
					: isRestDay
						? "rest_day"
						: "regular_workday",
				status:
					record?.status ??
					(leaveRow
						? "on_leave"
						: isRestDay || isHoliday
							? "no_work"
							: "present"),
				isRestDay,
				leave: leaveRow
					? {
							portion: leaveRow.portion,
							minutes: leaveRow.minutes,
							startMinute: leaveRow.startMinute,
							endMinute: leaveRow.endMinute,
							isPaid: leaveRow.isPaid,
						}
					: null,
				policy,
				approvedOvertimeMinutes: record?.approvedOvertimeMinutes ?? null,
			});

			return {
				date,
				minutes,
				hasRecord: record !== undefined,
				isRestDay,
				isHoliday,
				isScheduledWorkday:
					snapshot !== null && !snapshot.isRestDay && !isHoliday,
				standardWorkMinutes: snapshot?.standardWorkMinutes ?? 480,
			};
		},
	);

	const rates = deriveRateBasis({
		monthlyRateCentavos: activeTerms?.monthlyRateCentavos ?? 0,
		workingDaysFactorX100: activeTerms?.workingDaysFactorX100 ?? 31_300,
		dailyHours: activeTerms?.dailyHours ?? 8,
		rateRoundingMode: activeTerms?.rateRoundingMode ?? "amounts_only",
	});

	const result = computePayslip({
		period: {
			year: bounds.year,
			month: bounds.month,
			half: bounds.half,
			startDate: bounds.start,
			endDate: bounds.end,
			payDate: bounds.end,
			dayCount: bounds.dayCount,
		},
		terms: {
			id: activeTerms?.id ?? null,
			monthlyRateCentavos: activeTerms?.monthlyRateCentavos ?? 0,
			basePaySplitMode: activeTerms?.basePaySplitMode ?? "half_month_flat",
			sssBasisCentavos: activeTerms?.sssBasisCentavos ?? null,
			philhealthBasisCentavos: activeTerms?.philhealthBasisCentavos ?? null,
			pagibigBasisCentavos: activeTerms?.pagibigBasisCentavos ?? null,
			sssTiming: activeTerms?.sssTiming ?? "first_cutoff",
			philhealthTiming: activeTerms?.philhealthTiming ?? "first_cutoff",
			pagibigTiming: activeTerms?.pagibigTiming ?? "first_cutoff",
			taxTiming: activeTerms?.taxTiming ?? "every_cutoff",
			taxExempt: activeTerms?.taxExempt ?? false,
			unaccountedDayPolicy: activeTerms?.unaccountedDayPolicy ?? "warn",
		},
		rates,
		days,
		statutorySchedules: statutory,
		adjustments: adjustments.map(
			(row): AdjustmentInput => ({
				code: row.code,
				label: row.label,
				section: row.section,
				category: row.category,
				amountCentavos: row.amountCentavos,
				isTaxable: row.isTaxable,
				timing: row.timing,
			}),
		),
		calendarDaysInMonth: daysInMonth(bounds.year, bounds.month),
	});

	return { result, bounds };
}

export interface PayslipView {
	periodKey: string;
	label: string;
	startDate: string;
	endDate: string;
	dayCount: number;
	status: "draft" | "finalized";
	finalizedAt: string | null;
	result: PayslipResult;
}

const MONTH_NAME = new Intl.DateTimeFormat("en-PH", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

function periodLabel(year: number, month: number, half: 1 | 2, end: string) {
	const monthYear = MONTH_NAME.format(new Date(Date.UTC(year, month - 1, 1)));
	const lastDay = Number(end.slice(8, 10));
	return half === 1 ? `1–16 ${monthYear}` : `17–${lastDay} ${monthYear}`;
}

/**
 * Recomputes a payslip from live DTR data. Never writes.
 *
 * Drafts are deliberately not stored: a stored draft goes stale the moment a
 * time record changes, and there is no upside to keeping one.
 */
export const previewPayslip = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.validator(z.object({ periodKey: periodKeySchema }))
	.handler(async ({ data, context }): Promise<PayslipView> => {
		const { result, bounds } = await computeForPeriod(
			context.userId,
			data.periodKey,
		);

		const period = await ensurePayPeriod(context.userId, {
			year: bounds.year,
			month: bounds.month,
			half: bounds.half === 1 ? "first" : "second",
			startDate: bounds.start,
			endDate: bounds.end,
			payDate: bounds.end,
			dayCount: bounds.dayCount,
		});
		const stored = await findPayslipByPeriod(context.userId, period.id);

		return {
			periodKey: bounds.periodKey,
			label: periodLabel(bounds.year, bounds.month, bounds.half, bounds.end),
			startDate: bounds.start,
			endDate: bounds.end,
			dayCount: bounds.dayCount,
			status: stored?.payslip.status === "finalized" ? "finalized" : "draft",
			finalizedAt: stored?.payslip.finalizedAt?.toISOString() ?? null,
			result,
		};
	});

/**
 * Freezes a payslip and locks the days behind it.
 *
 * The computation snapshot and every line's derivation trace are written at this
 * moment and never recomputed. Re-deriving them later against updated
 * contribution tables would explain an old payslip using new rules.
 */
export const finalizePayslip = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(z.object({ periodKey: periodKeySchema }))
	.handler(async ({ data, context }) => {
		const { result, bounds } = await computeForPeriod(
			context.userId,
			data.periodKey,
		);

		if (!result.canFinalize) {
			return {
				finalized: false,
				reasons: result.warnings
					.filter((w) => w.blocksFinalize)
					.map((w) => w.message),
			};
		}

		const period = await ensurePayPeriod(context.userId, {
			year: bounds.year,
			month: bounds.month,
			half: bounds.half === 1 ? "first" : "second",
			startDate: bounds.start,
			endDate: bounds.end,
			payDate: bounds.end,
			dayCount: bounds.dayCount,
		});

		const { totals, rates } = result;
		await persistFinalizedPayslip(context.userId, {
			payPeriodId: period.id,
			header: {
				type: "regular",
				status: "finalized",
				monthlyRateCentavos: rates.monthlyCentavos,
				workingDaysFactorX100: rates.workingDaysFactorX100,
				dailyRateCentavos: rates.dailyCentavos,
				hourlyRateCentavos: rates.hourlyCentavos,
				daysPresent: totals.daysPresent,
				daysAbsent: totals.daysAbsent,
				daysOnLeave: totals.daysOnLeave,
				daysHoliday: totals.daysHoliday,
				regularMinutes: totals.regularMinutes,
				lateMinutes: totals.lateMinutes,
				undertimeMinutes: totals.undertimeMinutes,
				overtimeMinutes: totals.overtimeMinutes,
				nightDiffMinutes: totals.nightDiffMinutes,
				paidLeaveMinutes: totals.paidLeaveMinutes,
				basePayCentavos: result.basePayCentavos,
				totalEarningsCentavos: result.totalEarningsCentavos,
				taxableGrossCentavos: result.taxableGrossCentavos,
				nonTaxableCentavos: result.nonTaxableCentavos,
				grossPayCentavos: result.grossPayCentavos,
				totalDeductionsCentavos: result.totalDeductionsCentavos,
				netPayCentavos: result.netPayCentavos,
				sssEeCentavos: result.statutory.sss.employeeCentavos,
				sssErCentavos: result.statutory.sss.employerCentavos,
				philhealthEeCentavos: result.statutory.philhealth.employeeCentavos,
				philhealthErCentavos: result.statutory.philhealth.employerCentavos,
				pagibigEeCentavos: result.statutory.pagibig.employeeCentavos,
				pagibigErCentavos: result.statutory.pagibig.employerCentavos,
				withholdingTaxCentavos:
					result.statutory.withholdingTax.employeeCentavos,
				engineVersion: result.snapshot.engineVersion,
				computationSnapshot: result.snapshot as never,
				warnings: result.warnings as never,
				finalizedAt: new Date(),
			},
			lines: result.lines.map((line) => ({
				section: line.section,
				category: line.category,
				code: line.code,
				label: line.label,
				quantity: line.quantity,
				unit: line.unit,
				rateMicroCentavos: line.rateMicroCentavos,
				amountCentavos: line.amountCentavos,
				reducesTaxableGross: line.reducesTaxableGross,
				isTaxable: line.isTaxable,
				isStatutory: line.isStatutory,
				sortOrder: line.sortOrder,
				// Captured now, never recomputed.
				computation: {
					computation: line.computation,
					sourceDates: line.sourceDates,
					ruleReference: line.ruleReference,
				},
			})),
			lockDates: eachDate(bounds.start, bounds.end),
		});

		return { finalized: true, reasons: [] };
	});

export const voidPayslipFn = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(
		z.object({
			payslipId: z.number().int().positive(),
			reason: z.string().max(200).default("Amended"),
		}),
	)
	.handler(async ({ data, context }) => ({
		voided: await voidPayslip(context.userId, data.payslipId, data.reason),
	}));

export interface PayslipListItem {
	id: number;
	periodKey: string;
	label: string;
	payDate: string;
	grossPayCentavos: number;
	totalDeductionsCentavos: number;
	netPayCentavos: number;
	finalizedAt: string | null;
}

export const getPayslipList = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.validator(z.object({}).optional())
	.handler(async ({ context }) => {
		await ensureUserBootstrap(context.userId);
		const rows = await listPayslips(context.userId);

		const items: PayslipListItem[] = rows.map((row) => {
			const half = row.period.half === "first" ? 1 : 2;
			return {
				id: row.id,
				periodKey: `${row.period.year}-${String(row.period.month).padStart(2, "0")}-${half}`,
				label: periodLabel(
					row.period.year,
					row.period.month,
					half,
					row.period.endDate,
				),
				payDate: row.period.payDate,
				grossPayCentavos: row.grossPayCentavos,
				totalDeductionsCentavos: row.totalDeductionsCentavos,
				netPayCentavos: row.netPayCentavos,
				finalizedAt: row.finalizedAt?.toISOString() ?? null,
			};
		});

		const ytd = items.reduce(
			(acc, item) => ({
				gross: acc.gross + item.grossPayCentavos,
				deductions: acc.deductions + item.totalDeductionsCentavos,
				net: acc.net + item.netPayCentavos,
			}),
			{ gross: 0, deductions: 0, net: 0 },
		);

		const today = todayInManila();
		const currentBounds = cutoffBounds(
			Number(today.slice(0, 4)),
			Number(today.slice(5, 7)),
			Number(today.slice(8, 10)) <= 16 ? 1 : 2,
		);

		return { items, ytd, currentPeriodKey: currentBounds.periodKey };
	});
