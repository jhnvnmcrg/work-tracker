import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Info, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "#/components/layout/page-header.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
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
import { assertIsoDate, dayOfWeek, todayInManila } from "#/lib/payroll/time.ts";
import {
	addHoliday,
	getHolidayYear,
	removeHoliday,
	seedHolidayYear,
} from "#/server/holidays.ts";

const holidayYearQuery = (year: number) =>
	queryOptions({
		queryKey: ["holidays", year] as const,
		queryFn: () => getHolidayYear({ data: { year } }),
	});

export const Route = createFileRoute("/_app/holidays")({
	loader: ({ context }) =>
		context.queryClient.ensureQueryData(
			holidayYearQuery(Number(todayInManila().slice(0, 4))),
		),
	component: HolidaysPage,
});

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const KIND_LABELS: Record<string, string> = {
	regular: "Regular holiday",
	special_non_working: "Special non-working",
	special_working: "Special working",
};

function HolidaysPage() {
	const [year, setYear] = useState(Number(todayInManila().slice(0, 4)));
	const { data } = useSuspenseQuery(holidayYearQuery(year));
	const queryClient = useQueryClient();
	const [addOpen, setAddOpen] = useState(false);

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ["holidays", year] });
		queryClient.invalidateQueries({ queryKey: ["dtr"] });
	};

	const seed = useMutation({
		mutationFn: () => seedHolidayYear({ data: { year } }),
		onSuccess: (result) => {
			toast.success(
				result.added === 0
					? "Already filled in for this year."
					: `Added ${result.added} holiday(s). Check them against this year's proclamation.`,
			);
		},
		onError: () => toast.error("Could not fill the calendar."),
		onSettled: invalidate,
	});

	const create = useMutation({
		mutationFn: (values: {
			holidayDate: string;
			name: string;
			kind: "regular" | "special_non_working" | "special_working";
		}) => addHoliday({ data: { ...values, notes: null } }),
		onSuccess: () => toast.success("Holiday added."),
		onError: () => toast.error("Could not add that holiday."),
		onSettled: invalidate,
	});

	const destroy = useMutation({
		mutationFn: (id: number) => removeHoliday({ data: { id } }),
		onSuccess: (result) => {
			if (result.deleted) toast.success("Holiday removed.");
			else toast.error("That holiday cannot be removed.");
		},
		onError: () => toast.error("Could not remove that holiday."),
		onSettled: invalidate,
	});

	return (
		<>
			<PageHeader
				title="Holidays"
				description="Regular holidays and special non-working days."
				actions={
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-1">
							<Button
								variant="outline"
								size="icon"
								className="size-8"
								onClick={() => setYear((y) => y - 1)}
							>
								<ChevronLeft className="size-4" />
								<span className="sr-only">Previous year</span>
							</Button>
							<span className="min-w-14 text-center font-semibold">{year}</span>
							<Button
								variant="outline"
								size="icon"
								className="size-8"
								onClick={() => setYear((y) => y + 1)}
							>
								<ChevronRight className="size-4" />
								<span className="sr-only">Next year</span>
							</Button>
						</div>

						<Button
							variant="outline"
							size="sm"
							onClick={() => seed.mutate()}
							disabled={seed.isPending}
						>
							Fill {year}
						</Button>

						<Dialog open={addOpen} onOpenChange={setAddOpen}>
							<DialogTrigger asChild>
								<Button size="sm">
									<Plus className="size-4" />
									Add
								</Button>
							</DialogTrigger>
							<AddHolidayDialog
								year={year}
								onSubmit={(values) => {
									create.mutate(values);
									setAddOpen(false);
								}}
							/>
						</Dialog>
					</div>
				}
			/>

			<Alert className="mb-4">
				<Info className="size-4" />
				<AlertTitle>Some holidays have to be added by hand</AlertTitle>
				<AlertDescription>
					<span>
						“Fill {year}” only adds holidays whose date is fixed by statute or
						derivable by rule (Holy Week, National Heroes Day). These are set by
						annual proclamation and are deliberately not guessed:
					</span>
					<ul className="mt-1 list-disc pl-5">
						{data.proclamationOnly.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</AlertDescription>
			</Alert>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">
						{data.holidays.length} holiday(s) in {year}
					</CardTitle>
				</CardHeader>
				<CardContent>
					{data.holidays.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Nothing recorded for {year} yet — use “Fill {year}” to add the
							determinate ones.
						</p>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[38rem] text-sm">
								<thead>
									<tr className="border-b text-left text-xs text-muted-foreground">
										<th className="py-2 font-medium">Date</th>
										<th className="py-2 font-medium">Day</th>
										<th className="py-2 font-medium">Name</th>
										<th className="py-2 font-medium">Kind</th>
										<th className="py-2 font-medium">Source</th>
										<th className="py-2" />
									</tr>
								</thead>
								<tbody>
									{data.holidays.map((holiday) => (
										<tr key={holiday.id} className="border-b last:border-0">
											<td className="py-2 tabular-nums">
												{holiday.holidayDate}
											</td>
											<td className="py-2 text-muted-foreground">
												{
													WEEKDAYS[
														dayOfWeek(assertIsoDate(holiday.holidayDate))
													]
												}
											</td>
											<td className="py-2">{holiday.name}</td>
											<td className="py-2">
												<Badge
													variant={
														holiday.kind === "regular" ? "default" : "secondary"
													}
												>
													{KIND_LABELS[holiday.kind] ?? holiday.kind}
												</Badge>
											</td>
											<td className="py-2 text-xs text-muted-foreground">
												{holiday.sourceCitation ?? "Added by you"}
											</td>
											<td className="py-2 text-right">
												{holiday.editable ? (
													<Button
														variant="ghost"
														size="sm"
														onClick={() => destroy.mutate(holiday.id)}
													>
														<Trash2 className="size-4" />
														<span className="sr-only">Remove</span>
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

function AddHolidayDialog({
	year,
	onSubmit,
}: {
	year: number;
	onSubmit: (values: {
		holidayDate: string;
		name: string;
		kind: "regular" | "special_non_working" | "special_working";
	}) => void;
}) {
	const [holidayDate, setHolidayDate] = useState(`${year}-01-01`);
	const [name, setName] = useState("");
	const [kind, setKind] = useState<
		"regular" | "special_non_working" | "special_working"
	>("special_non_working");

	return (
		<DialogContent>
			<DialogHeader>
				<DialogTitle>Add a holiday</DialogTitle>
				<DialogDescription>
					Use this for proclaimed holidays such as Eid'l Fitr or Chinese New
					Year, once the date is published.
				</DialogDescription>
			</DialogHeader>

			<div className="grid gap-4">
				<div className="grid gap-2">
					<Label htmlFor="holiday-date">Date</Label>
					<Input
						id="holiday-date"
						type="date"
						value={holidayDate}
						onChange={(e) => setHolidayDate(e.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="holiday-name">Name</Label>
					<Input
						id="holiday-name"
						value={name}
						placeholder="Eid'l Fitr"
						onChange={(e) => setName(e.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="holiday-kind">Kind</Label>
					<Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
						<SelectTrigger id="holiday-kind">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="regular">Regular holiday</SelectItem>
							<SelectItem value="special_non_working">
								Special non-working
							</SelectItem>
							<SelectItem value="special_working">Special working</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<DialogFooter>
				<Button
					disabled={name.trim() === ""}
					onClick={() => onSubmit({ holidayDate, name: name.trim(), kind })}
				>
					Add
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}
