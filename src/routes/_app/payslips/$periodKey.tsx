import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Info, Lock } from "lucide-react";
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
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/ui/collapsible.tsx";
import { formatPeso } from "#/lib/payroll/money.ts";
import {
	assertIsoDate,
	formatDuration,
	monthKeyOf,
} from "#/lib/payroll/time.ts";
import { finalizePayslip, previewPayslip } from "#/server/payroll.ts";

const payslipQuery = (periodKey: string) =>
	queryOptions({
		queryKey: ["payslip", periodKey] as const,
		queryFn: () => previewPayslip({ data: { periodKey } }),
	});

export const Route = createFileRoute("/_app/payslips/$periodKey")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(payslipQuery(params.periodKey)),
	component: PayslipPage,
});

function PayslipPage() {
	const { periodKey } = Route.useParams();
	const { data } = useSuspenseQuery(payslipQuery(periodKey));
	const queryClient = useQueryClient();
	const { result } = data;

	const finalize = useMutation({
		mutationFn: () => finalizePayslip({ data: { periodKey } }),
		onSuccess: (response) => {
			if (response.finalized) {
				toast.success("Payslip finalized. Those days are now locked.");
			} else {
				toast.error(response.reasons[0] ?? "This payslip cannot be finalized.");
			}
		},
		onError: () => toast.error("Could not finalize that payslip."),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["payslip"] });
			queryClient.invalidateQueries({ queryKey: ["dtr"] });
		},
	});

	const earnings = result.lines.filter((line) => line.section === "earnings");
	const deductions = result.lines.filter(
		(line) => line.section === "deductions",
	);
	const blocking = result.warnings.filter((w) => w.blocksFinalize);
	const advisory = result.warnings.filter((w) => !w.blocksFinalize);

	return (
		<>
			<PageHeader
				title={`Payslip · ${data.label}`}
				description={`${data.startDate} to ${data.endDate} · ${data.dayCount} days`}
				actions={
					<div className="flex items-center gap-2">
						<Button variant="outline" asChild>
							<Link to="/payslips">
								<ArrowLeft className="size-4" />
								All payslips
							</Link>
						</Button>
						{data.status === "finalized" ? (
							<Badge variant="secondary" className="gap-1">
								<Lock className="size-3" />
								Finalized
							</Badge>
						) : (
							<Button
								onClick={() => finalize.mutate()}
								disabled={finalize.isPending || !result.canFinalize}
							>
								{finalize.isPending ? "Finalizing…" : "Finalize"}
							</Button>
						)}
					</div>
				}
			/>

			{blocking.length > 0 ? (
				<Alert variant="destructive" className="mb-4">
					<AlertTriangle className="size-4" />
					<AlertTitle>This payslip cannot be finalized yet</AlertTitle>
					<AlertDescription>
						<ul className="list-disc pl-5">
							{blocking.map((warning) => (
								<li key={warning.code}>
									{warning.message}
									{warning.dates && warning.dates.length > 0 ? (
										<span className="text-xs">
											{" "}
											({warning.dates.slice(0, 5).join(", ")}
											{warning.dates.length > 5 ? "…" : ""})
										</span>
									) : null}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}

			{advisory.length > 0 ? (
				<Alert className="mb-4">
					<Info className="size-4" />
					<AlertTitle>Worth checking</AlertTitle>
					<AlertDescription>
						<ul className="list-disc pl-5">
							{advisory.map((warning) => (
								<li key={warning.code}>{warning.message}</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			) : null}

			<div className="grid gap-4 lg:grid-cols-2">
				<LineTable
					title="Earnings"
					lines={earnings}
					total={result.totalEarningsCentavos}
				/>
				<LineTable
					title="Deductions"
					lines={deductions}
					total={result.totalDeductionsCentavos}
				/>
			</div>

			<Card className="mt-4">
				<CardContent className="flex flex-wrap items-baseline justify-between gap-2 py-5">
					<span className="font-serif text-lg font-semibold">Net pay</span>
					<span
						className={
							result.netPayCentavos < 0
								? "font-serif text-3xl font-bold tabular-nums text-destructive"
								: "font-serif text-3xl font-bold tabular-nums"
						}
					>
						{formatPeso(result.netPayCentavos)}
					</span>
				</CardContent>
			</Card>

			<Card className="mt-4">
				<CardHeader>
					<CardTitle className="font-serif text-base">
						How this was computed
					</CardTitle>
				</CardHeader>
				<CardContent className="grid gap-2">
					<dl className="grid gap-1 text-sm sm:grid-cols-2">
						<Row
							label="Monthly rate"
							value={formatPeso(result.rates.monthlyCentavos)}
						/>
						<Row
							label="Working-days factor"
							value={String(result.rates.workingDaysFactorX100 / 100)}
						/>
						<Row
							label="Daily rate"
							value={formatPeso(result.rates.dailyCentavos)}
						/>
						<Row
							label="Hourly rate"
							value={formatPeso(result.rates.hourlyCentavos)}
						/>
						<Row
							label="Taxable compensation"
							value={formatPeso(result.taxableGrossCentavos)}
						/>
						<Row
							label="Days present / absent"
							value={`${result.totals.daysPresent} / ${result.totals.daysAbsent}`}
						/>
						<Row
							label="Late"
							value={formatDuration(result.totals.lateMinutes)}
						/>
						<Row
							label="Undertime"
							value={formatDuration(result.totals.undertimeMinutes)}
						/>
						<Row
							label="Overtime"
							value={formatDuration(result.totals.overtimeMinutes)}
						/>
					</dl>
					<p className="mt-2 text-xs text-muted-foreground">
						Base pay is half the monthly rate on every cutoff, so it does not
						shrink for a shorter one. Late, undertime and absence are itemised
						subtractions rather than a reduced base — and although they print
						under deductions, they reduce taxable compensation rather than being
						deducted from it.
					</p>
				</CardContent>
			</Card>
		</>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between gap-4 border-b py-1 last:border-0">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="font-medium tabular-nums">{value}</dd>
		</div>
	);
}

function LineTable({
	title,
	lines,
	total,
}: {
	title: string;
	lines: Array<{
		code: string;
		label: string;
		amountCentavos: number;
		computation: string;
		sourceDates: string[];
		ruleReference: string | null;
		quantity: number | null;
		unit: string | null;
	}>;
	total: number;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="font-serif text-base">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				{lines.length === 0 ? (
					<p className="text-sm text-muted-foreground">Nothing on this side.</p>
				) : (
					<div className="grid gap-1">
						{lines.map((line) => (
							<Collapsible key={line.code}>
								<div className="flex items-baseline justify-between gap-4 border-b py-2">
									<CollapsibleTrigger className="flex-1 text-left text-sm hover:underline">
										{line.label}
										{line.quantity !== null && line.unit === "minutes" ? (
											<span className="ml-1 text-xs text-muted-foreground">
												{formatDuration(line.quantity)}
											</span>
										) : null}
									</CollapsibleTrigger>
									<span className="text-sm font-medium tabular-nums">
										{formatPeso(line.amountCentavos)}
									</span>
								</div>
								<CollapsibleContent className="py-2 pl-1 text-xs text-muted-foreground">
									<p>{line.computation}</p>
									{line.ruleReference ? (
										<p className="mt-1">Source: {line.ruleReference}</p>
									) : null}
									{line.sourceDates.length > 0 ? (
										<p className="mt-1">
											From{" "}
											{line.sourceDates.map((date, index) => (
												<span key={date}>
													{index > 0 ? ", " : ""}
													<Link
														to="/dtr/$month"
														params={{ month: monthKeyOf(assertIsoDate(date)) }}
														className="underline"
													>
														{date}
													</Link>
												</span>
											))}
										</p>
									) : null}
								</CollapsibleContent>
							</Collapsible>
						))}
						<div className="mt-2 flex items-baseline justify-between gap-4 border-t pt-2">
							<span className="text-sm font-semibold">
								Total {title.toLowerCase()}
							</span>
							<span className="text-sm font-semibold tabular-nums">
								{formatPeso(total)}
							</span>
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
