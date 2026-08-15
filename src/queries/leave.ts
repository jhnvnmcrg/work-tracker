import {
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { z } from "zod";
import type { fileLeaveInput, grantCreditsInput } from "#/schemas/leave.ts";
import {
	cancelLeave,
	fileLeave,
	getLeaveOverview,
	grantLeaveCredits,
} from "#/server/leave.ts";

export const leaveKeys = {
	overview: (year: number) => ["leave", "overview", year] as const,
};

export const leaveOverviewQuery = (year: number) =>
	queryOptions({
		queryKey: leaveKeys.overview(year),
		queryFn: () => getLeaveOverview({ data: { year } }),
	});

/** Leave changes rewrite DTR rows, so the month grid must be refetched too. */
function invalidateLeaveAndDtr(
	queryClient: ReturnType<typeof useQueryClient>,
	year: number,
) {
	queryClient.invalidateQueries({ queryKey: leaveKeys.overview(year) });
	queryClient.invalidateQueries({ queryKey: ["dtr"] });
}

export function useFileLeave(year: number) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: z.input<typeof fileLeaveInput>) =>
			fileLeave({ data: data as never }),
		onSuccess: (result) => {
			if (result.error) {
				toast.error(result.error);
				return;
			}
			const skippedNote =
				result.skipped.length > 0
					? ` ${result.skipped.length} rest day(s) or holiday(s) were not charged.`
					: "";
			toast.success(
				`Filed ${result.daysCharged} day(s) of leave.${skippedNote}`,
			);
		},
		onError: () => toast.error("Could not file that leave."),
		onSettled: () => invalidateLeaveAndDtr(queryClient, year),
	});
}

export function useCancelLeave(year: number) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (requestId: number) => cancelLeave({ data: { requestId } }),
		onSuccess: (result) => {
			if (result.cancelled)
				toast.success("Leave cancelled and credit returned.");
			else toast.error("That request could not be cancelled.");
		},
		onError: () => toast.error("Could not cancel that leave."),
		onSettled: () => invalidateLeaveAndDtr(queryClient, year),
	});
}

export function useGrantCredits(year: number) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: z.input<typeof grantCreditsInput>) =>
			grantLeaveCredits({ data: data as never }),
		onSuccess: () => toast.success("Leave credits updated."),
		onError: () => toast.error("Could not update credits."),
		onSettled: () => invalidateLeaveAndDtr(queryClient, year),
	});
}
