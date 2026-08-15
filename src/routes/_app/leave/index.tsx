import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarPlus, Plus, X } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "#/components/layout/page-header.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { todayInManila } from "#/lib/payroll/time.ts";
import {
	leaveOverviewQuery,
	useCancelLeave,
	useFileLeave,
	useGrantCredits,
} from "#/queries/leave.ts";

export const Route = createFileRoute("/_app/leave/")({
	loader: ({ context }) => {
		const year = Number(todayInManila().slice(0, 4));
		return context.queryClient.ensureQueryData(leaveOverviewQuery(year));
	},
	component: LeavePage,
});

/** Credits are spoken of in days, so minutes are only an implementation detail. */
function toDays(minutes: number, standard: number): string {
	if (standard <= 0) return "0";
	const days = minutes / standard;
	return Number.isInteger(days) ? String(days) : days.toFixed(2);
}

function LeavePage() {
	const currentYear = Number(todayInManila().slice(0, 4));
	const [year] = useState(currentYear);
	const { data } = useSuspenseQuery(leaveOverviewQuery(year));

	const fileLeave = useFileLeave(year);
	const cancelLeave = useCancelLeave(year);
	const grantCredits = useGrantCredits(year);

	const [fileOpen, setFileOpen] = useState(false);
	const [creditsOpen, setCreditsOpen] = useState(false);

	const standard = data.standardWorkMinutes;

	return (
		<>
			<PageHeader
				title="Leave"
				description={`Credits and filed leave for ${year}.`}
				actions={
					<div className="flex gap-2">
						<Dialog open={creditsOpen} onOpenChange={setCreditsOpen}>
							<DialogTrigger asChild>
								<Button variant="outline" size="sm">
									<Plus className="size-4" />
									Add credits
								</Button>
							</DialogTrigger>
							<GrantCreditsDialog
								types={data.types}
								year={year}
								onSubmit={(values) => {
									grantCredits.mutate(values);
									setCreditsOpen(false);
								}}
							/>
						</Dialog>

						<Dialog open={fileOpen} onOpenChange={setFileOpen}>
							<DialogTrigger asChild>
								<Button size="sm">
									<CalendarPlus className="size-4" />
									File leave
								</Button>
							</DialogTrigger>
							<FileLeaveDialog
								types={data.types}
								onSubmit={(values) => {
									fileLeave.mutate(values);
									setFileOpen(false);
								}}
							/>
						</Dialog>
					</div>
				}
			/>

			<section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{data.balances.map((balance) => (
					<Card key={balance.leaveTypeId}>
						<CardHeader className="pb-2">
							<div className="flex items-center justify-between">
								<CardTitle className="text-sm font-medium">
									{balance.name}
								</CardTitle>
								<Badge variant="outline">{balance.code}</Badge>
							</div>
						</CardHeader>
						<CardContent>
							<p
								className={
									balance.balanceMinutes < 0
										? "font-serif text-2xl font-semibold text-destructive"
										: "font-serif text-2xl font-semibold"
								}
							>
								{toDays(balance.balanceMinutes, standard)}
								<span className="ml-1 text-sm font-normal text-muted-foreground">
									days
								</span>
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{toDays(balance.earnedMinutes, standard)} granted ·{" "}
								{toDays(balance.usedMinutes, standard)} used
								{balance.isPaid ? "" : " · unpaid"}
							</p>
						</CardContent>
					</Card>
				))}
			</section>

			<Card>
				<CardHeader>
					<CardTitle className="font-serif text-base">Filed leave</CardTitle>
				</CardHeader>
				<CardContent>
					{data.requests.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Nothing filed yet. Rest days and holidays inside a range are never
							charged against your credits.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[36rem] text-sm">
								<thead>
									<tr className="border-b text-left text-xs text-muted-foreground">
										<th className="py-2 font-medium">Type</th>
										<th className="py-2 font-medium">From</th>
										<th className="py-2 font-medium">To</th>
										<th className="py-2 text-right font-medium">Days</th>
										<th className="py-2 font-medium">Status</th>
										<th className="py-2" />
									</tr>
								</thead>
								<tbody>
									{data.requests.map((request) => (
										<tr key={request.id} className="border-b last:border-0">
											<td className="py-2">
												<Badge variant="outline">{request.code}</Badge>
											</td>
											<td className="py-2 tabular-nums">{request.startDate}</td>
											<td className="py-2 tabular-nums">{request.endDate}</td>
											<td className="py-2 text-right tabular-nums">
												{toDays(request.totalMinutes, standard)}
											</td>
											<td className="py-2">
												<Badge
													variant={
														request.status === "cancelled"
															? "secondary"
															: "default"
													}
												>
													{request.status}
												</Badge>
											</td>
											<td className="py-2 text-right">
												{request.status !== "cancelled" ? (
													<Button
														variant="ghost"
														size="sm"
														onClick={() => cancelLeave.mutate(request.id)}
													>
														<X className="size-4" />
														<span className="sr-only">Cancel</span>
													</Button>
												) : null}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</>
	);
}

function FileLeaveDialog({
	types,
	onSubmit,
}: {
	types: Array<{ id: number; code: string; name: string }>;
	onSubmit: (values: {
		leaveTypeId: number;
		startDate: string;
		endDate: string;
		halfDayStart: boolean;
		halfDayEnd: boolean;
		reason: string | null;
	}) => void;
}) {
	const today: string = todayInManila();
	const [leaveTypeId, setLeaveTypeId] = useState(String(types[0]?.id ?? ""));
	// Plain strings: these are `<input type="date">` values, validated server-side.
	const [startDate, setStartDate] = useState<string>(today);
	const [endDate, setEndDate] = useState<string>(today);
	const [halfDayStart, setHalfDayStart] = useState(false);
	const [halfDayEnd, setHalfDayEnd] = useState(false);
	const [reason, setReason] = useState("");

	const invalid = endDate < startDate || leaveTypeId === "";

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>File leave</DialogTitle>
				<DialogDescription>
					Rest days and holidays inside the range are skipped, so a Friday to
					Tuesday request costs three days rather than five.
				</DialogDescription>
			</DialogHeader>

			<div className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="leave-type">Leave type</Label>
					<Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
						<SelectTrigger id="leave-type">
							<SelectValue placeholder="Choose a type" />
						</SelectTrigger>
						<SelectContent>
							{types.map((type) => (
								<SelectItem key={type.id} value={String(type.id)}>
									{type.code} — {type.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="grid grid-cols-2 gap-3">
					<div className="grid gap-2">
						<Label htmlFor="leave-from">From</Label>
						<Input
							id="leave-from"
							type="date"
							value={startDate}
							onChange={(e) => setStartDate(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="leave-to">To</Label>
						<Input
							id="leave-to"
							type="date"
							value={endDate}
							onChange={(e) => setEndDate(e.target.value)}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<Checkbox
							id="half-day-start"
							checked={halfDayStart}
							onCheckedChange={(v) => setHalfDayStart(v === true)}
						/>
						<Label htmlFor="half-day-start" className="font-normal">
							Starts at midday on the first day
						</Label>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id="half-day-end"
							checked={halfDayEnd}
							onCheckedChange={(v) => setHalfDayEnd(v === true)}
						/>
						<Label htmlFor="half-day-end" className="font-normal">
							Ends at midday on the last day
						</Label>
					</div>
				</div>

				<div className="grid gap-2">
					<Label htmlFor="leave-reason">Reason (optional)</Label>
					<Textarea
						id="leave-reason"
						value={reason}
						rows={2}
						onChange={(e) => setReason(e.target.value)}
					/>
				</div>
			</div>

			<DialogFooter>
				<Button
					disabled={invalid}
					onClick={() =>
						onSubmit({
							leaveTypeId: Number(leaveTypeId),
							startDate,
							endDate,
							halfDayStart,
							halfDayEnd,
							reason: reason.trim() === "" ? null : reason.trim(),
						})
					}
				>
					File leave
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}

function GrantCreditsDialog({
	types,
	year,
	onSubmit,
}: {
	types: Array<{ id: number; code: string; name: string }>;
	year: number;
	onSubmit: (values: {
		leaveTypeId: number;
		creditYear: number;
		days: number;
		note: string | null;
	}) => void;
}) {
	const [leaveTypeId, setLeaveTypeId] = useState(String(types[0]?.id ?? ""));
	const [days, setDays] = useState("15");
	const [note, setNote] = useState("");
	const parsed = Number(days);
	const invalid =
		leaveTypeId === "" || !Number.isFinite(parsed) || parsed === 0;

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Add leave credits</DialogTitle>
				<DialogDescription>
					Entitlements come from your contract, so nothing is assumed here.
					Enter a negative number to remove credits.
				</DialogDescription>
			</DialogHeader>

			<div className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="credit-type">Leave type</Label>
					<Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
						<SelectTrigger id="credit-type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{types.map((type) => (
								<SelectItem key={type.id} value={String(type.id)}>
									{type.code} — {type.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className="grid gap-2">
					<Label htmlFor="credit-days">Days for {year}</Label>
					<Input
						id="credit-days"
						type="number"
						step="0.5"
						value={days}
						onChange={(e) => setDays(e.target.value)}
					/>
				</div>

				<div className="grid gap-2">
					<Label htmlFor="credit-note">Note (optional)</Label>
					<Input
						id="credit-note"
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
				</div>
			</div>

			<DialogFooter>
				<Button
					disabled={invalid}
					onClick={() =>
						onSubmit({
							leaveTypeId: Number(leaveTypeId),
							creditYear: year,
							days: parsed,
							note: note.trim() === "" ? null : note.trim(),
						})
					}
				>
					Save
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}
