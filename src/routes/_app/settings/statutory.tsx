import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "#/components/layout/page-header.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { pesosToCentavos } from "#/lib/payroll/money.ts";
import { scheduleProblem } from "#/lib/payroll/statutory.ts";
import { todayInManila } from "#/lib/payroll/time.ts";
import type { StatutoryKind } from "#/lib/payroll/types.ts";
import {
	getStatutoryTables,
	removeStatutoryTable,
	saveStatutoryTable,
} from "#/server/settings.ts";

const statutoryQuery = queryOptions({
	queryKey: ["statutory"] as const,
	queryFn: () => getStatutoryTables(),
});

export const Route = createFileRoute("/_app/settings/statutory")({
	loader: ({ context }) => context.queryClient.ensureQueryData(statutoryQuery),
	component: StatutoryPage,
});

const KINDS: Array<{
	kind: StatutoryKind;
	label: string;
	blurb: string;
	shape:
		| "brackets_amount"
		| "rate_range"
		| "brackets_rate"
		| "brackets_marginal";
	source: string;
}> = [
	{
		kind: "sss",
		label: "SSS",
		blurb:
			"A bracketed table of published amounts. Enter one row per salary-credit bracket with the employee and employer shares.",
		shape: "brackets_amount",
		source: "SSS contribution schedule circular",
	},
	{
		kind: "philhealth",
		label: "PhilHealth",
		blurb:
			"A percentage of basic salary between a floor and a ceiling. Usually needs no bracket rows.",
		shape: "rate_range",
		source: "PhilHealth premium contribution circular",
	},
	{
		kind: "pagibig",
		label: "Pag-IBIG",
		blurb:
			"Tiered rates applied to compensation, capped per tier. Enter one row per tier.",
		shape: "brackets_rate",
		source: "HDMF / Pag-IBIG circular",
	},
	{
		kind: "withholding_tax",
		label: "Withholding tax",
		blurb:
			"Marginal brackets on semi-monthly taxable compensation: base amount plus a rate on the excess over the bracket floor.",
		shape: "brackets_marginal",
		source: "BIR RR 11-2018 revised withholding tax table",
	},
];

interface DraftBracket {
	rangeFrom: string;
	rangeTo: string;
	salaryCredit: string;
	employeeAmount: string;
	employerAmount: string;
	employeeRate: string;
	employerRate: string;
	cap: string;
	baseAmount: string;
	excessRate: string;
}

const emptyBracket = (): DraftBracket => ({
	rangeFrom: "0",
	rangeTo: "",
	salaryCredit: "",
	employeeAmount: "",
	employerAmount: "",
	employeeRate: "",
	employerRate: "",
	cap: "",
	baseAmount: "",
	excessRate: "",
});

const money = (value: string) =>
	value.trim() === "" ? null : pesosToCentavos(value);
/** A percentage typed by the user becomes parts per million. */
const rate = (value: string) =>
	value.trim() === "" ? null : Math.round(Number(value) * 10_000);

function StatutoryPage() {
	const { data } = useSuspenseQuery(statutoryQuery);
	const queryClient = useQueryClient();
	const [editing, setEditing] = useState<StatutoryKind | null>(null);

	const invalidate = () => {
		queryClient.invalidateQueries({ queryKey: ["statutory"] });
		queryClient.invalidateQueries({ queryKey: ["payslip"] });
	};

	const destroy = useMutation({
		mutationFn: (id: number) => removeStatutoryTable({ data: { id } }),
		onSuccess: () => toast.success("Table removed."),
		onError: () => toast.error("Could not remove that table."),
		onSettled: invalidate,
	});

	return (
		<>
			<PageHeader
				title="Contribution tables"
				description="SSS, PhilHealth, Pag-IBIG and withholding tax."
				actions={
					<Button variant="outline" asChild>
						<Link to="/settings">
							<ArrowLeft className="size-4" />
							Back to settings
						</Link>
					</Button>
				}
			/>

			<Alert
				className="mb-4"
				variant={data.missingToday.length > 0 ? "destructive" : "default"}
			>
				<AlertTriangle className="size-4" />
				<AlertTitle>
					{data.missingToday.length > 0
						? `${data.missingToday.length} table(s) not configured — payslips cannot be finalized`
						: "All four tables are configured"}
				</AlertTitle>
				<AlertDescription>
					These figures are set by legislation and circular and change on their
					own schedules, so nothing is pre-filled and no value is guessed. Enter
					each table from its official issuance and record the citation — the
					payslip stores which table version it used, so an old payslip stays
					explainable after you update one.
				</AlertDescription>
			</Alert>

			<div className="grid gap-4">
				{KINDS.map((meta) => {
					const schedules = data.schedules.filter((s) => s.kind === meta.kind);
					// Usable, not merely present: a table saved without a rate or without
					// bracket rows resolves fine and computes nothing.
					const active = schedules.find(
						(s) =>
							s.effectiveFrom <= data.today &&
							(s.effectiveTo === null || s.effectiveTo >= data.today) &&
							scheduleProblem(s) === null,
					);

					return (
						<Card key={meta.kind}>
							<CardHeader>
								<div className="flex flex-wrap items-start justify-between gap-2">
									<div>
										<CardTitle className="flex items-center gap-2 text-base">
											{meta.label}
											{active ? (
												<Badge variant="secondary">Configured</Badge>
											) : (
												<Badge variant="destructive">Not configured</Badge>
											)}
										</CardTitle>
										<CardDescription>{meta.blurb}</CardDescription>
									</div>
									<Button
										size="sm"
										variant={editing === meta.kind ? "secondary" : "outline"}
										onClick={() =>
											setEditing(editing === meta.kind ? null : meta.kind)
										}
									>
										<Plus className="size-4" />
										{editing === meta.kind ? "Cancel" : "Add a version"}
									</Button>
								</div>
							</CardHeader>

							<CardContent className="grid gap-4">
								{schedules.length > 0 ? (
									<div className="overflow-x-auto rounded-lg border">
										<table className="w-full min-w-[40rem] text-sm">
											<thead>
												<tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
													<th className="px-3 py-2 font-medium">Effective</th>
													<th className="px-3 py-2 font-medium">Name</th>
													<th className="px-3 py-2 font-medium">Rows</th>
													<th className="px-3 py-2 font-medium">Source</th>
													<th className="px-3 py-2 font-medium">Verified</th>
													<th className="px-3 py-2" />
												</tr>
											</thead>
											<tbody>
												{schedules.map((schedule) => (
													<tr
														key={schedule.id}
														className="border-b last:border-0"
													>
														<td className="px-3 py-2 tabular-nums">
															{schedule.effectiveFrom}
															{schedule.effectiveTo
																? ` – ${schedule.effectiveTo}`
																: " onwards"}
														</td>
														<td className="px-3 py-2">
															{schedule.name}
															{scheduleProblem(schedule) ? (
																<span className="mt-0.5 block text-xs text-destructive">
																	{scheduleProblem(schedule)}
																</span>
															) : null}
														</td>
														<td className="px-3 py-2 tabular-nums">
															{schedule.brackets.length > 0
																? `${schedule.brackets.length} bracket(s)`
																: schedule.ratePpm !== null
																	? `${(schedule.ratePpm / 10_000).toFixed(2)}%`
																	: "—"}
														</td>
														<td className="px-3 py-2 text-xs text-muted-foreground">
															{schedule.sourceCitation ?? "—"}
														</td>
														<td className="px-3 py-2 text-xs text-muted-foreground">
															{schedule.verifiedAt ?? "not verified"}
														</td>
														<td className="px-3 py-2 text-right">
															{schedule.userId !== null ? (
																<Button
																	variant="ghost"
																	size="sm"
																	onClick={() => destroy.mutate(schedule.id)}
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
								) : (
									<p className="text-sm text-muted-foreground">
										No version entered yet.
									</p>
								)}

								{editing === meta.kind ? (
									<ScheduleForm
										meta={meta}
										onSaved={() => {
											setEditing(null);
											invalidate();
										}}
									/>
								) : null}
							</CardContent>
						</Card>
					);
				})}
			</div>
		</>
	);
}

function ScheduleForm({
	meta,
	onSaved,
}: {
	meta: (typeof KINDS)[number];
	onSaved: () => void;
}) {
	const today: string = todayInManila();
	const [name, setName] = useState(`${meta.label} ${today.slice(0, 4)}`);
	const [effectiveFrom, setEffectiveFrom] = useState(
		`${today.slice(0, 4)}-01-01`,
	);
	const [effectiveTo, setEffectiveTo] = useState("");
	const [citation, setCitation] = useState(meta.source);
	const [verifiedAt, setVerifiedAt] = useState<string>(today);

	const [ratePercent, setRatePercent] = useState("");
	const [employeeShare, setEmployeeShare] = useState("50");
	const [floor, setFloor] = useState("");
	const [ceiling, setCeiling] = useState("");

	const [brackets, setBrackets] = useState<DraftBracket[]>([emptyBracket()]);

	const save = useMutation({
		mutationFn: () =>
			saveStatutoryTable({
				data: {
					kind: meta.kind,
					name,
					effectiveFrom,
					effectiveTo: effectiveTo.trim() === "" ? null : effectiveTo,
					sourceCitation: citation,
					verifiedAt: verifiedAt.trim() === "" ? null : verifiedAt,
					ratePpm: meta.shape === "rate_range" ? rate(ratePercent) : null,
					employeeSharePpm:
						meta.shape === "rate_range" ? rate(employeeShare) : null,
					floorCentavos: meta.shape === "rate_range" ? money(floor) : null,
					ceilingCentavos: meta.shape === "rate_range" ? money(ceiling) : null,
					brackets:
						meta.shape === "rate_range"
							? []
							: brackets.map((bracket) => ({
									periodType:
										meta.kind === "withholding_tax"
											? ("semi_monthly" as const)
											: ("monthly" as const),
									rangeFromCentavos: pesosToCentavos(bracket.rangeFrom || "0"),
									rangeToCentavos: money(bracket.rangeTo),
									salaryCreditCentavos: money(bracket.salaryCredit),
									employeeAmountCentavos: money(bracket.employeeAmount),
									employerAmountCentavos: money(bracket.employerAmount),
									employerEcAmountCentavos: null,
									employeeMpfCentavos: null,
									employerMpfCentavos: null,
									employeeRatePpm: rate(bracket.employeeRate),
									employerRatePpm: rate(bracket.employerRate),
									capCentavos: money(bracket.cap),
									baseAmountCentavos: money(bracket.baseAmount),
									excessRatePpm: rate(bracket.excessRate),
								})),
				},
			}),
		onSuccess: () => {
			toast.success(`${meta.label} table saved.`);
			onSaved();
		},
		onError: (error) =>
			toast.error(
				error instanceof Error ? error.message : "Could not save that table.",
			),
	});

	/*
	 * A table that saves but computes nothing is worse than no table: the payslip
	 * refuses to finalize while Settings looks complete. Block it at the source.
	 */
	const parsedRate = Number(ratePercent);
	const incomplete =
		meta.shape === "rate_range"
			? !Number.isFinite(parsedRate) ||
				ratePercent.trim() === "" ||
				parsedRate <= 0
			: brackets.length === 0 ||
				brackets.every((b) =>
					meta.shape === "brackets_amount"
						? b.employeeAmount.trim() === ""
						: meta.shape === "brackets_rate"
							? b.employeeRate.trim() === ""
							: b.baseAmount.trim() === "" && b.excessRate.trim() === "",
				);

	const incompleteReason =
		meta.shape === "rate_range"
			? "Enter a premium rate above zero."
			: "Enter at least one bracket row with a value.";

	const patch = (index: number, key: keyof DraftBracket, value: string) =>
		setBrackets((current) =>
			current.map((bracket, i) =>
				i === index ? { ...bracket, [key]: value } : bracket,
			),
		);

	const columns: Array<{ key: keyof DraftBracket; label: string }> =
		meta.shape === "brackets_amount"
			? [
					{ key: "rangeFrom", label: "Comp. from" },
					{ key: "rangeTo", label: "Comp. to" },
					{ key: "salaryCredit", label: "Salary credit" },
					{ key: "employeeAmount", label: "Employee" },
					{ key: "employerAmount", label: "Employer" },
				]
			: meta.shape === "brackets_rate"
				? [
						{ key: "rangeFrom", label: "Comp. from" },
						{ key: "rangeTo", label: "Comp. to" },
						{ key: "employeeRate", label: "Employee %" },
						{ key: "employerRate", label: "Employer %" },
						{ key: "cap", label: "Cap" },
					]
				: [
						{ key: "rangeFrom", label: "Taxable from" },
						{ key: "rangeTo", label: "Taxable to" },
						{ key: "baseAmount", label: "Base amount" },
						{ key: "excessRate", label: "% on excess" },
					];

	return (
		<div className="grid gap-4 rounded-lg border bg-muted/20 p-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="grid gap-2">
					<Label htmlFor={`name-${meta.kind}`}>Version name</Label>
					<Input
						id={`name-${meta.kind}`}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor={`cite-${meta.kind}`}>Source citation</Label>
					<Input
						id={`cite-${meta.kind}`}
						value={citation}
						onChange={(e) => setCitation(e.target.value)}
						placeholder={meta.source}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor={`from-${meta.kind}`}>Effective from</Label>
					<Input
						id={`from-${meta.kind}`}
						type="date"
						value={effectiveFrom}
						onChange={(e) => setEffectiveFrom(e.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor={`to-${meta.kind}`}>
						Effective to (blank = onwards)
					</Label>
					<Input
						id={`to-${meta.kind}`}
						type="date"
						value={effectiveTo}
						onChange={(e) => setEffectiveTo(e.target.value)}
					/>
				</div>
				<div className="grid gap-2">
					<Label htmlFor={`ver-${meta.kind}`}>Verified on</Label>
					<Input
						id={`ver-${meta.kind}`}
						type="date"
						value={verifiedAt}
						onChange={(e) => setVerifiedAt(e.target.value)}
					/>
				</div>
			</div>

			{meta.shape === "rate_range" ? (
				<div className="grid gap-3 sm:grid-cols-4">
					<div className="grid gap-2">
						<Label htmlFor="phic-rate">Premium rate %</Label>
						<Input
							id="phic-rate"
							inputMode="decimal"
							value={ratePercent}
							onChange={(e) => setRatePercent(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="phic-share">Employee share %</Label>
						<Input
							id="phic-share"
							inputMode="decimal"
							value={employeeShare}
							onChange={(e) => setEmployeeShare(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="phic-floor">Salary floor</Label>
						<Input
							id="phic-floor"
							inputMode="decimal"
							value={floor}
							onChange={(e) => setFloor(e.target.value)}
						/>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="phic-ceiling">Salary ceiling</Label>
						<Input
							id="phic-ceiling"
							inputMode="decimal"
							value={ceiling}
							onChange={(e) => setCeiling(e.target.value)}
						/>
					</div>
				</div>
			) : (
				<div className="grid gap-2">
					<div className="flex items-center justify-between">
						<Label>Brackets</Label>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => setBrackets((c) => [...c, emptyBracket()])}
						>
							<Plus className="size-4" />
							Add row
						</Button>
					</div>
					<div className="overflow-x-auto rounded-lg border bg-card">
						<table className="w-full min-w-[36rem] text-sm">
							<thead>
								<tr className="border-b text-left text-xs text-muted-foreground">
									{columns.map((column) => (
										<th key={column.key} className="px-2 py-2 font-medium">
											{column.label}
										</th>
									))}
									<th className="px-2 py-2" />
								</tr>
							</thead>
							<tbody>
								{brackets.map((bracket, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorderable only by add/remove
									<tr key={index} className="border-b last:border-0">
										{columns.map((column) => (
											<td key={column.key} className="px-2 py-1.5">
												<Input
													aria-label={`${column.label} row ${index + 1}`}
													inputMode="decimal"
													className="h-8"
													value={bracket[column.key]}
													onChange={(e) =>
														patch(index, column.key, e.target.value)
													}
												/>
											</td>
										))}
										<td className="px-2 py-1.5 text-right">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() =>
													setBrackets((c) => c.filter((_, i) => i !== index))
												}
											>
												<Trash2 className="size-4" />
												<span className="sr-only">Remove row</span>
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p className="text-xs text-muted-foreground">
						Leave the top bracket's “to” blank to make it open-ended. Amounts
						are in pesos; percentages as plain numbers (5 means 5%).
					</p>
				</div>
			)}

			<div className="flex items-center justify-end gap-3">
				{incomplete || citation.trim() === "" ? (
					<span className="text-xs text-destructive">
						{citation.trim() === ""
							? "A source citation is required."
							: incompleteReason}
					</span>
				) : null}
				<Button
					onClick={() => save.mutate()}
					disabled={save.isPending || citation.trim() === "" || incomplete}
				>
					{save.isPending ? "Saving…" : `Save ${meta.label} table`}
				</Button>
			</div>
		</div>
	);
}
