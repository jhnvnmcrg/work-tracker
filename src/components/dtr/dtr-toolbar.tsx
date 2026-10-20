import { Link } from "@tanstack/react-router";
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group.tsx";
import { formatDuration, parseMonthKey } from "#/lib/payroll/time.ts";
import type { DtrTotals } from "#/server/dtr.ts";

const MONTH_LABEL = new Intl.DateTimeFormat("en-PH", {
	month: "long",
	year: "numeric",
	timeZone: "UTC",
});

export function monthLabel(monthKey: string): string {
	const { year, month } = parseMonthKey(monthKey);
	return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
}

function shiftMonth(monthKey: string, delta: number): string {
	const { year, month } = parseMonthKey(monthKey);
	const total = year * 12 + (month - 1) + delta;
	const nextYear = Math.floor(total / 12);
	const nextMonth = (total % 12) + 1;
	return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

export type HalfFilter = "1" | "2" | "all";

export function MonthSwitcher({ month }: { month: string }) {
	return (
		<div className="flex items-center gap-1">
			<Button variant="outline" size="icon" className="size-8" asChild>
				<Link to="/dtr/$month" params={{ month: shiftMonth(month, -1) }}>
					<ChevronLeft className="size-4" />
					<span className="sr-only">Previous month</span>
				</Link>
			</Button>
			<span className="min-w-40 text-center text-base font-semibold">
				{monthLabel(month)}
			</span>
			<Button variant="outline" size="icon" className="size-8" asChild>
				<Link to="/dtr/$month" params={{ month: shiftMonth(month, 1) }}>
					<ChevronRight className="size-4" />
					<span className="sr-only">Next month</span>
				</Link>
			</Button>
		</div>
	);
}

export function DtrToolbar({
	half,
	onHalfChange,
	totals,
	onApplySchedule,
	isApplying,
	isSaving,
}: {
	half: HalfFilter;
	onHalfChange: (next: HalfFilter) => void;
	totals: DtrTotals;
	onApplySchedule: () => void;
	isApplying: boolean;
	isSaving: boolean;
}) {
	return (
		<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
			<div className="flex flex-wrap items-center gap-4">
				<ToggleGroup
					type="single"
					value={half}
					onValueChange={(value) => value && onHalfChange(value as HalfFilter)}
					variant="outline"
					size="sm"
				>
					<ToggleGroupItem value="1">1–16</ToggleGroupItem>
					<ToggleGroupItem value="2">17–end</ToggleGroupItem>
					<ToggleGroupItem value="all">Whole month</ToggleGroupItem>
				</ToggleGroup>

				<dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
					<Stat label="Rendered" value={formatDuration(totals.workedMinutes)} />
					<Stat label="Late" value={formatDuration(totals.lateMinutes)} />
					<Stat
						label="Undertime"
						value={formatDuration(totals.undertimeMinutes)}
					/>
					<Stat label="OT" value={formatDuration(totals.overtimeMinutes)} />
					{totals.daysNeedingAttention > 0 ? (
						<Stat
							label="Needs attention"
							value={`${totals.daysNeedingAttention} day(s)`}
							tone="warning"
						/>
					) : null}
				</dl>
			</div>

			<div className="flex items-center gap-2">
				{/* role="status" already implies aria-live="polite". */}
				<output className="text-xs text-muted-foreground">
					{isSaving ? "Saving…" : "Saved"}
				</output>
				<Button
					variant="outline"
					size="sm"
					onClick={onApplySchedule}
					disabled={isApplying}
				>
					{isApplying ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<CalendarPlus className="size-4" />
					)}
					Fill blank workdays
				</Button>
			</div>
		</div>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "warning";
}) {
	return (
		<div className="flex items-baseline gap-1.5">
			<dt className="text-muted-foreground">{label}</dt>
			<dd
				className={
					tone === "warning"
						? "font-medium tabular-nums text-destructive"
						: "font-medium tabular-nums"
				}
			>
				{value}
			</dd>
		</div>
	);
}
