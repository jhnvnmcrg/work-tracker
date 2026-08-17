import { createServerFn } from "@tanstack/react-start";
import {
	deleteStatutorySchedule,
	findStatutorySchedules,
	saveStatutorySchedule,
	updateEmploymentTerms,
} from "#/db/repo/payroll.ts";
import {
	ensureUserBootstrap,
	findEmploymentTerms,
	findSchedules,
	updateScheduleRestDays,
} from "#/db/repo/profile.ts";
import { resolveEffective } from "#/lib/payroll/effective.ts";
import { deriveRateBasis } from "#/lib/payroll/rates.ts";
import type { StatutoryScheduleData } from "#/lib/payroll/statutory.ts";
import { todayInManila } from "#/lib/payroll/time.ts";
import type { StatutoryKind } from "#/lib/payroll/types.ts";
import {
	deleteScheduleInput,
	saveScheduleInput,
	updateTermsInput,
} from "#/schemas/payroll.ts";
import { authedMiddleware } from "./auth.ts";

export interface SettingsView {
	termsId: number | null;
	monthlyRateCentavos: number;
	workingDaysFactorX100: number;
	dailyHours: number;
	graceMinutes: number;
	graceForfeits: boolean;
	minOvertimeMinutes: number;
	overtimeRequiresApproval: boolean;
	sssTiming: string;
	philhealthTiming: string;
	pagibigTiming: string;
	taxExempt: boolean;
	restDays: number[];
	/** Derived live so the effect of a factor change is visible immediately. */
	dailyRateCentavos: number;
	hourlyRateCentavos: number;
	/** True when the factor disagrees with the number of scheduled workdays. */
	factorMismatch: { expectedFactor: number; workdaysPerWeek: number } | null;
}

export const getSettings = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.handler(async ({ context }): Promise<SettingsView> => {
		await ensureUserBootstrap(context.userId);
		const today = todayInManila();
		const [terms, schedules] = await Promise.all([
			findEmploymentTerms(context.userId),
			findSchedules(context.userId),
		]);

		const active = resolveEffective(terms, today);
		const schedule = resolveEffective(schedules, today);
		const restDays =
			schedule?.days.filter((d) => d.isRestDay).map((d) => d.weekday) ?? [];

		const rates = deriveRateBasis({
			monthlyRateCentavos: active?.monthlyRateCentavos ?? 0,
			workingDaysFactorX100: active?.workingDaysFactorX100 ?? 31_300,
			dailyHours: active?.dailyHours ?? 8,
			rateRoundingMode: active?.rateRoundingMode ?? "amounts_only",
		});

		// 365 less one rest day a week for each rest day configured.
		const expectedFactor = 365 - restDays.length * 52;
		const configuredFactor = Math.round(
			(active?.workingDaysFactorX100 ?? 31_300) / 100,
		);

		return {
			termsId: active?.id ?? null,
			monthlyRateCentavos: active?.monthlyRateCentavos ?? 0,
			workingDaysFactorX100: active?.workingDaysFactorX100 ?? 31_300,
			dailyHours: active?.dailyHours ?? 8,
			graceMinutes: active?.graceMinutes ?? 0,
			graceForfeits: active?.graceForfeits ?? false,
			minOvertimeMinutes: active?.minOvertimeMinutes ?? 30,
			overtimeRequiresApproval: active?.overtimeRequiresApproval ?? true,
			sssTiming: active?.sssTiming ?? "first_cutoff",
			philhealthTiming: active?.philhealthTiming ?? "first_cutoff",
			pagibigTiming: active?.pagibigTiming ?? "first_cutoff",
			taxExempt: active?.taxExempt ?? false,
			restDays,
			dailyRateCentavos: rates.dailyCentavos,
			hourlyRateCentavos: rates.hourlyCentavos,
			factorMismatch:
				Math.abs(expectedFactor - configuredFactor) > 8
					? { expectedFactor, workdaysPerWeek: 7 - restDays.length }
					: null,
		};
	});

export const updateSettings = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(updateTermsInput)
	.handler(async ({ data, context }) => {
		await ensureUserBootstrap(context.userId);
		const today = todayInManila();
		const [terms, schedules] = await Promise.all([
			findEmploymentTerms(context.userId),
			findSchedules(context.userId),
		]);

		const active = resolveEffective(terms, today);
		if (!active) return { updated: false };

		await updateEmploymentTerms(context.userId, active.id, {
			monthlyRateCentavos: data.monthlyRateCentavos,
			workingDaysFactorX100: data.workingDaysFactorX100,
			dailyHours: data.dailyHours,
			graceMinutes: data.graceMinutes,
			graceForfeits: data.graceForfeits,
			minOvertimeMinutes: data.minOvertimeMinutes,
			overtimeRequiresApproval: data.overtimeRequiresApproval,
			sssTiming: data.sssTiming,
			philhealthTiming: data.philhealthTiming,
			pagibigTiming: data.pagibigTiming,
			taxExempt: data.taxExempt,
			// A 365 factor is the only one that covers rest days too.
			monthlyRateCoversRestDays: data.workingDaysFactorX100 >= 36_500,
			monthlyRateCoversHolidays: true,
		});

		const schedule = resolveEffective(schedules, today);
		if (schedule) {
			await updateScheduleRestDays(context.userId, schedule.id, data.restDays);
		}

		return { updated: true };
	});

/* -------------------------------------------------------------------------- */
/* Statutory tables                                                            */
/* -------------------------------------------------------------------------- */

export interface StatutoryOverview {
	schedules: StatutoryScheduleData[];
	/** Kinds with no schedule in force today. Finalizing is blocked while any exist. */
	missingToday: StatutoryKind[];
	today: string;
}

export const getStatutoryTables = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.handler(async ({ context }): Promise<StatutoryOverview> => {
		await ensureUserBootstrap(context.userId);
		const today = todayInManila();
		const schedules = await findStatutorySchedules(context.userId);

		const kinds: StatutoryKind[] = [
			"sss",
			"philhealth",
			"pagibig",
			"withholding_tax",
		];
		const missingToday = kinds.filter(
			(kind) =>
				!schedules.some(
					(schedule) =>
						schedule.kind === kind &&
						schedule.effectiveFrom <= today &&
						(schedule.effectiveTo === null || schedule.effectiveTo >= today),
				),
		);

		return { schedules, missingToday, today };
	});

export const saveStatutoryTable = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(saveScheduleInput)
	.handler(async ({ data, context }) => {
		await ensureUserBootstrap(context.userId);
		const id = await saveStatutorySchedule(context.userId, data);
		return { id };
	});

export const removeStatutoryTable = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(deleteScheduleInput)
	.handler(async ({ data, context }) => ({
		deleted: await deleteStatutorySchedule(context.userId, data.id),
	}));
