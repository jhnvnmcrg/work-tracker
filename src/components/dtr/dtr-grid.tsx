import { AlertTriangle, Lock } from "lucide-react";
import { Fragment, useCallback, useRef } from "react";
import { TimeCell } from "#/components/dtr/time-cell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { formatDuration } from "#/lib/payroll/time.ts";
import type { AttendanceStatus, DtrFlag } from "#/lib/payroll/types.ts";
import { cn } from "#/lib/utils.ts";
import type { DtrDayView } from "#/server/dtr.ts";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PUNCH_FIELDS = ["amIn", "amOut", "pmIn", "pmOut"] as const;
type PunchField = (typeof PUNCH_FIELDS)[number];

const PUNCH_LABELS: Record<PunchField, string> = {
	amIn: "AM in",
	amOut: "AM out",
	pmIn: "PM in",
	pmOut: "PM out",
};

const STATUS_OPTIONS: Array<{ value: AttendanceStatus; label: string }> = [
	{ value: "present", label: "Regular" },
	{ value: "absent", label: "Absent" },
	{ value: "on_leave", label: "Leave" },
	{ value: "half_day_leave", label: "Half day" },
	{ value: "official_business", label: "Official business" },
	{ value: "no_work", label: "No work" },
	{ value: "suspended", label: "Suspended" },
];

const FLAG_LABELS: Partial<Record<DtrFlag, string>> = {
	missing_punch: "incomplete",
	out_before_in: "out before in",
	overlapping_sessions: "overlapping",
	unapproved_overtime: "OT over approved",
	no_schedule: "no schedule",
	holiday_premium_not_applied: "holiday premium not applied",
	rest_day_premium_not_applied: "rest-day premium not applied",
};

/** Flags that indicate a problem rather than merely describing the day. */
const PROBLEM_FLAGS = new Set<DtrFlag>([
	"missing_punch",
	"out_before_in",
	"overlapping_sessions",
	"no_schedule",
]);

export interface DtrGridProps {
	days: DtrDayView[];
	cutoffEnd: string;
	onPunchChange: (
		date: string,
		field: PunchField,
		value: number | null,
	) => void;
	onStatusChange: (date: string, status: AttendanceStatus) => void;
	onRemarksChange: (date: string, remarks: string) => void;
}

export function DtrGrid({
	days,
	cutoffEnd,
	onPunchChange,
	onStatusChange,
	onRemarksChange,
}: DtrGridProps) {
	const gridRef = useRef<HTMLTableSectionElement>(null);

	/**
	 * Enter moves down the same column rather than across the row, so all the
	 * AM-ins can be filled in one pass instead of zig-zagging through four
	 * fields per day. Ctrl+D copies the cell above.
	 */
	const onKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTableSectionElement>) => {
			const target = event.target as HTMLElement;
			const cell = target.dataset?.cell;
			if (!cell) return;

			const [rowText, field] = cell.split(":");
			const row = Number(rowText);

			const focusCell = (nextRow: number) => {
				const next = gridRef.current?.querySelector<HTMLInputElement>(
					`[data-cell="${nextRow}:${field}"]`,
				);
				if (next && !next.disabled) {
					event.preventDefault();
					next.focus();
					next.select();
				}
			};

			if (event.key === "Enter" && !event.shiftKey) focusCell(row + 1);
			else if (event.key === "Enter" && event.shiftKey) focusCell(row - 1);
			else if (event.key === "ArrowDown" && event.altKey) focusCell(row + 1);
			else if (event.key === "ArrowUp" && event.altKey) focusCell(row - 1);
			else if (
				event.key.toLowerCase() === "d" &&
				(event.ctrlKey || event.metaKey)
			) {
				const above = days[row - 1];
				const current = days[row];
				if (above && current) {
					event.preventDefault();
					onPunchChange(
						current.date,
						field as PunchField,
						above.punches[field as PunchField],
					);
				}
			}
		},
		[days, onPunchChange],
	);

	return (
		<div className="overflow-x-auto rounded-xl border bg-card">
			<table className="w-full min-w-[52rem] border-collapse text-sm">
				<thead>
					<tr className="border-b text-left text-xs text-muted-foreground">
						<th className="w-14 px-3 py-2 font-medium">Day</th>
						<th className="w-12 px-2 py-2 font-medium">Dy</th>
						{PUNCH_FIELDS.map((field) => (
							<th key={field} className="w-24 px-2 py-2 font-medium">
								{PUNCH_LABELS[field]}
							</th>
						))}
						<th className="w-36 px-2 py-2 font-medium">Type</th>
						<th className="w-20 px-2 py-2 text-right font-medium">Total</th>
						<th className="px-3 py-2 font-medium">Remarks</th>
					</tr>
				</thead>
				<tbody ref={gridRef} onKeyDown={onKeyDown}>
					{days.map((day, index) => {
						const dayNumber = Number(day.date.slice(8, 10));
						const problems = day.minutes.flags.filter((f) =>
							PROBLEM_FLAGS.has(f),
						);
						const notes = day.minutes.flags.filter(
							(f) => !PROBLEM_FLAGS.has(f) && FLAG_LABELS[f],
						);
						const nonWorking = day.isRestDay || day.holiday !== null;

						return (
							<Fragment key={day.date}>
								<tr
									className={cn(
										"border-b last:border-0",
										nonWorking && "bg-muted/40",
										day.locked && "opacity-70",
										problems.length > 0 && "bg-destructive/5",
									)}
								>
									<td className="px-3 py-1.5 tabular-nums text-muted-foreground">
										{dayNumber}
									</td>
									<td
										className={cn(
											"px-2 py-1.5 text-xs",
											nonWorking ? "text-muted-foreground" : "",
										)}
									>
										{WEEKDAY_LABELS[day.weekday]}
									</td>

									{PUNCH_FIELDS.map((field) => (
										<td key={field} className="px-2 py-1.5">
											<TimeCell
												key={`${day.date}-${field}-${day.punches[field] ?? "empty"}`}
												cellRef={`${index}:${field}`}
												label={`${PUNCH_LABELS[field]} on day ${dayNumber}`}
												value={day.punches[field]}
												disabled={day.locked}
												invalid={day.minutes.flags.includes("out_before_in")}
												onCommit={(value) =>
													onPunchChange(day.date, field, value)
												}
											/>
										</td>
									))}

									<td className="px-2 py-1.5">
										<Select
											value={day.status}
											disabled={day.locked}
											onValueChange={(value) =>
												onStatusChange(day.date, value as AttendanceStatus)
											}
										>
											<SelectTrigger className="h-8 w-full text-xs" size="sm">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{STATUS_OPTIONS.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</td>

									<td className="px-2 py-1.5 text-right tabular-nums">
										{day.minutes.workedMinutes > 0
											? formatDuration(day.minutes.workedMinutes)
											: "—"}
									</td>

									<td className="px-3 py-1.5">
										<div className="flex flex-wrap items-center gap-1.5">
											{day.locked ? (
												<Lock
													className="size-3.5 shrink-0 text-muted-foreground"
													aria-label="Locked by a finalized payslip"
												/>
											) : null}
											{day.holiday ? (
												<Badge variant="secondary" className="font-normal">
													{day.holiday.name}
												</Badge>
											) : null}
											{day.leave ? (
												<Badge variant="secondary" className="font-normal">
													{day.leave.code}
												</Badge>
											) : null}
											{day.minutes.lateMinutes > 0 ? (
												<Badge variant="outline" className="font-normal">
													late {formatDuration(day.minutes.lateMinutes)}
												</Badge>
											) : null}
											{day.minutes.undertimeMinutes > 0 ? (
												<Badge variant="outline" className="font-normal">
													under {formatDuration(day.minutes.undertimeMinutes)}
												</Badge>
											) : null}
											{day.minutes.overtimeMinutes > 0 ? (
												<Badge variant="outline" className="font-normal">
													OT {formatDuration(day.minutes.overtimeMinutes)}
												</Badge>
											) : null}
											{problems.map((flag) => (
												<Badge
													key={flag}
													variant="destructive"
													className="gap-1 font-normal"
												>
													<AlertTriangle className="size-3" />
													{FLAG_LABELS[flag] ?? flag}
												</Badge>
											))}
											{notes.map((flag) => (
												<Badge
													key={flag}
													variant="outline"
													className="font-normal text-muted-foreground"
												>
													{FLAG_LABELS[flag]}
												</Badge>
											))}
											<input
												aria-label={`Remarks for day ${dayNumber}`}
												defaultValue={day.remarks ?? ""}
												disabled={day.locked}
												placeholder="…"
												className="min-w-24 flex-1 border-0 bg-transparent px-1 text-xs outline-none placeholder:text-muted-foreground/50 focus:ring-0 disabled:cursor-not-allowed"
												onBlur={(e) => {
													if ((day.remarks ?? "") !== e.target.value) {
														onRemarksChange(day.date, e.target.value);
													}
												}}
											/>
										</div>
									</td>
								</tr>

								{day.date === cutoffEnd ? (
									<tr aria-hidden>
										<td colSpan={9} className="bg-primary/10 px-3 py-1">
											<span className="text-[11px] font-medium tracking-wide text-primary uppercase">
												End of pay period 1–16
											</span>
										</td>
									</tr>
								) : null}
							</Fragment>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
