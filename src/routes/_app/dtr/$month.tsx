import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { DtrGrid } from "#/components/dtr/dtr-grid.tsx";
import {
	DtrToolbar,
	type HalfFilter,
	MonthSwitcher,
	monthLabel,
} from "#/components/dtr/dtr-toolbar.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { isMonthKey, monthKeyOf, todayInManila } from "#/lib/payroll/time.ts";
import { sumTotals } from "#/lib/payroll/totals.ts";
import type { AttendanceStatus } from "#/lib/payroll/types.ts";
import {
	dtrMonthQuery,
	toDayInput,
	useApplyDefaultSchedule,
	useSaveDtrDay,
} from "#/queries/dtr.ts";
import type { DtrDayView } from "#/server/dtr.ts";

export const Route = createFileRoute("/_app/dtr/$month")({
	beforeLoad: ({ params }) => {
		// A hand-typed or stale URL lands on the current month rather than
		// rendering a broken grid.
		if (!isMonthKey(params.month)) {
			throw redirect({
				to: "/dtr/$month",
				params: { month: monthKeyOf(todayInManila()) },
			});
		}
	},
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(dtrMonthQuery(params.month)),
	component: DtrMonthPage,
});

function DtrMonthPage() {
	const { month } = Route.useParams();
	const { data } = useSuspenseQuery(dtrMonthQuery(month));
	const [half, setHalf] = useState<HalfFilter>("all");

	const save = useSaveDtrDay(month);
	const applySchedule = useApplyDefaultSchedule(month);

	const firstCutoff = data.cutoffs[0];

	const visibleDays = useMemo(() => {
		if (half === "all") return data.days;
		const cutoff = data.cutoffs[half === "1" ? 0 : 1];
		return data.days.filter(
			(day) => day.date >= cutoff.start && day.date <= cutoff.end,
		);
	}, [data.days, data.cutoffs, half]);

	// Same rollup the server and the optimistic update use, so the figures agree.
	const visibleTotals = useMemo(
		() => (half === "all" ? data.totals : sumTotals(visibleDays)),
		[half, data.totals, visibleDays],
	);

	const dayByDate = useMemo(
		() => new Map(data.days.map((day) => [day.date, day])),
		[data.days],
	);

	const commit = useCallback(
		(date: string, patch: Partial<DtrDayView>) => {
			const day = dayByDate.get(date);
			if (!day || day.locked) return;
			save.mutate(toDayInput({ ...day, ...patch }));
		},
		[dayByDate, save],
	);

	return (
		<>
			<PageHeader
				title="Daily Time Record"
				description={`${monthLabel(month)} · cutoffs 1–16 and 17–end of month`}
				actions={<MonthSwitcher month={month} />}
			/>

			{!data.isConfigured ? (
				<Alert className="mb-4">
					<AlertTitle>Set your rate to enable payslips</AlertTitle>
					<AlertDescription>
						You can record time now, but payslips need a monthly rate and a work
						schedule.{" "}
						<Button variant="link" className="h-auto p-0" asChild>
							<Link to="/settings">Open settings</Link>
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			<DtrToolbar
				half={half}
				onHalfChange={setHalf}
				totals={visibleTotals}
				onApplySchedule={() => applySchedule.mutate({ half, onlyBlank: true })}
				isApplying={applySchedule.isPending}
				isSaving={save.isPending}
			/>

			<DtrGrid
				days={visibleDays}
				cutoffEnd={half === "all" ? firstCutoff.end : ""}
				onPunchChange={(date, field, value) => {
					const day = dayByDate.get(date);
					if (!day) return;
					commit(date, { punches: { ...day.punches, [field]: value } });
				}}
				onStatusChange={(date, status: AttendanceStatus) =>
					commit(date, { status })
				}
				onRemarksChange={(date, remarks) =>
					commit(date, { remarks: remarks.trim() === "" ? null : remarks })
				}
			/>

			<p className="mt-3 text-xs text-muted-foreground">
				Enter moves down the same column · Ctrl+D copies the cell above · Esc
				reverts · type <code>8</code>, <code>800</code>, <code>8a</code>,{" "}
				<code>1pm</code> or <code>13:00</code>
			</p>
		</>
	);
}
