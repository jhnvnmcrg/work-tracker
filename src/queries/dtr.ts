import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { computeDailyMinutes } from "#/lib/payroll/daily.ts";
import { assertIsoDate } from "#/lib/payroll/time.ts";
import { sumTotals } from "#/lib/payroll/totals.ts";
import type { PunchSet } from "#/lib/payroll/types.ts";
import type { DayInput } from "#/schemas/dtr.ts";
import {
	applyDefaultSchedule,
	clearDtrDay,
	type DtrDayView,
	type DtrMonthBundle,
	getDtrMonth,
	upsertDtrDay,
} from "#/server/dtr.ts";

/**
 * Cache keys are not namespaced by user. Signing out calls `queryClient.clear()`
 * instead — cheaper, and it removes any chance of one account seeing another's
 * cached data on a shared machine.
 */
export const qk = {
	dtrMonth: (month: string) => ["dtr", "month", month] as const,
	dashboard: (range: string) => ["dashboard", range] as const,
};

export const dtrMonthQuery = (month: string) =>
	queryOptions({
		queryKey: qk.dtrMonth(month),
		queryFn: () => getDtrMonth({ data: { month } }),
	});

/**
 * Recomputes a day locally with the *same* pure function the server runs.
 *
 * This is what keeps the totals bar from flickering: if the optimistic figure
 * and the server figure disagreed, every keystroke would show one number and
 * then correct itself to another.
 */
function recomputeDay(
	bundle: DtrMonthBundle,
	day: DtrDayView,
	patch: Partial<Pick<DtrDayView, "punches" | "status" | "remarks">>,
): DtrDayView {
	const next: DtrDayView = { ...day, ...patch, hasRecord: true };
	const { punches, minutes } = computeDailyMinutes({
		date: assertIsoDate(next.date),
		today: assertIsoDate(bundle.today),
		punches: next.punches,
		schedule: next.schedule,
		dayKind: next.dayKind,
		status: next.status,
		isRestDay: next.isRestDay,
		leave: null,
		policy: bundle.policy,
		approvedOvertimeMinutes: next.approvedOvertimeMinutes,
	});
	return { ...next, punches, minutes };
}

export function applyLocalEdit(
	bundle: DtrMonthBundle,
	date: string,
	patch: Partial<Pick<DtrDayView, "punches" | "status" | "remarks">>,
): DtrMonthBundle {
	const days = bundle.days.map((day) =>
		day.date === date ? recomputeDay(bundle, day, patch) : day,
	);
	return { ...bundle, days, totals: sumTotals(days) };
}

export function toDayInput(day: DtrDayView): DayInput {
	return {
		workDate: day.date,
		amIn: day.punches.amIn,
		amOut: day.punches.amOut,
		pmIn: day.punches.pmIn,
		pmOut: day.punches.pmOut,
		status: day.status,
		remarks: day.remarks,
		approvedOvertimeMinutes: day.approvedOvertimeMinutes,
	};
}

export function useSaveDtrDay(month: string) {
	const queryClient = useQueryClient();
	const key = qk.dtrMonth(month);

	return useMutation({
		mutationFn: (data: DayInput) => upsertDtrDay({ data }),
		onMutate: async (data) => {
			await queryClient.cancelQueries({ queryKey: key });
			const previous = queryClient.getQueryData<DtrMonthBundle>(key);
			if (previous) {
				const punches: PunchSet = {
					amIn: data.amIn,
					amOut: data.amOut,
					pmIn: data.pmIn,
					pmOut: data.pmOut,
				};
				queryClient.setQueryData<DtrMonthBundle>(
					key,
					applyLocalEdit(previous, data.workDate, {
						punches,
						status: data.status,
						remarks: data.remarks,
					}),
				);
			}
			return { previous };
		},
		onError: (_error, _data, ctx) => {
			if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
			toast.error("Could not save — your edit was reverted.");
		},
		onSuccess: (result) => {
			if (result.skippedLocked.length > 0) {
				toast.warning(
					`${result.skippedLocked.length} day(s) belong to a finalized payslip and were not changed.`,
				);
			}
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: key });
		},
	});
}

export function useApplyDefaultSchedule(month: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (vars: { half: "1" | "2" | "all"; onlyBlank: boolean }) =>
			applyDefaultSchedule({ data: { month, ...vars } }),
		onSuccess: (result) => {
			toast.success(
				result.saved.length === 0
					? "Nothing to fill — every workday already has entries."
					: `Filled ${result.saved.length} day(s) from your schedule.`,
			);
		},
		onError: () => toast.error("Could not apply the schedule."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: qk.dtrMonth(month) }),
	});
}

export function useClearDtrDay(month: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (workDate: string) => clearDtrDay({ data: { workDate } }),
		onError: () => toast.error("Could not clear that day."),
		onSettled: () =>
			queryClient.invalidateQueries({ queryKey: qk.dtrMonth(month) }),
	});
}
