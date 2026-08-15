import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowDown,
	ArrowRight,
	ArrowUp,
	Info,
	TriangleAlert,
} from "lucide-react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";
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
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart.tsx";
import { formatPeso } from "#/lib/payroll/money.ts";
import { formatDuration } from "#/lib/payroll/time.ts";
import { getDashboard } from "#/server/dashboard.ts";

const dashboardQuery = queryOptions({
	queryKey: ["dashboard"] as const,
	queryFn: () => getDashboard(),
});

export const Route = createFileRoute("/_app/dashboard")({
	loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQuery),
	component: DashboardPage,
});

const hoursConfig = {
	regularHours: { label: "Regular", color: "var(--chart-1)" },
	overtimeHours: { label: "Overtime", color: "var(--chart-3)" },
} satisfies ChartConfig;

const punctualityConfig = {
	punctualityMinutes: { label: "Arrival vs schedule", color: "var(--chart-1)" },
} satisfies ChartConfig;

const trendConfig = {
	lateMinutes: { label: "Late", color: "var(--chart-5)" },
	overtimeMinutes: { label: "Overtime", color: "var(--chart-3)" },
} satisfies ChartConfig;

const moneyConfig = {
	netPesos: { label: "Net", color: "var(--chart-2)" },
	deductionPesos: { label: "Deductions", color: "var(--chart-5)" },
} satisfies ChartConfig;

function DashboardPage() {
	const { data } = useSuspenseQuery(dashboardQuery);
	const { kpis } = data;

	const critical = data.anomalies.filter((a) => a.severity === "critical");
	const rest = data.anomalies.filter((a) => a.severity !== "critical");

	return (
		<>
			<PageHeader
				title="Dashboard"
				description="Hours, punctuality, overtime and year-to-date earnings."
				actions={
					<Button variant="outline" asChild>
						<Link
							to="/payslips/$periodKey"
							params={{ periodKey: data.currentPeriodKey }}
						>
							Current payslip
							<ArrowRight className="size-4" />
						</Link>
					</Button>
				}
			/>

			{!data.isConfigured ? (
				<Alert className="mb-4">
					<Info className="size-4" />
					<AlertTitle>Set your monthly rate to see earnings</AlertTitle>
					<AlertDescription>
						Hours and punctuality work without it, but payslip figures need a
						rate.{" "}
						<Button variant="link" className="h-auto p-0" asChild>
							<Link to="/settings">Open settings</Link>
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			{/* The highest-value widget: for a manual record, the dominant failure
			    is forgetting to fill days in, and this catches it before payroll. */}
			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 font-serif text-base">
						Needs attention
						{critical.length > 0 ? (
							<Badge variant="destructive">{critical.length}</Badge>
						) : null}
					</CardTitle>
					<CardDescription>
						Checked against your own records — no estimates.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{data.anomalies.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							Nothing to flag. Your current cutoff has no gaps or inconsistent
							entries.
						</p>
					) : (
						<ul className="grid gap-2">
							{[...critical, ...rest].map((anomaly) => (
								<li
									key={`${anomaly.code}:${anomaly.dates.join(",")}`}
									className="flex items-start gap-2 rounded-lg border p-3"
								>
									{anomaly.severity === "critical" ? (
										<TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
									) : anomaly.severity === "warning" ? (
										<AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									) : (
										<Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									)}
									<div className="flex-1">
										<p className="text-sm font-medium">{anomaly.title}</p>
										<p className="text-sm text-muted-foreground">
											{anomaly.defaultMessage}
										</p>
										{anomaly.dates.length > 0 ? (
											<p className="mt-1 flex flex-wrap gap-1 text-xs">
												{anomaly.dates.slice(0, 8).map((date) => (
													<Link
														key={date}
														to="/dtr/$month"
														params={{ month: date.slice(0, 7) }}
														className="underline text-muted-foreground"
													>
														{date}
													</Link>
												))}
												{anomaly.dates.length > 8 ? (
													<span className="text-muted-foreground">
														and {anomaly.dates.length - 8} more
													</span>
												) : null}
											</p>
										) : null}
									</div>
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>

			<section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<Kpi
					label="Hours this cutoff"
					value={formatDuration(kpis.periodWorkedMinutes)}
					delta={kpis.periodWorkedMinutes - kpis.previousPeriodWorkedMinutes}
					goodWhen="up"
				/>
				<Kpi
					label="Late this cutoff"
					value={formatDuration(kpis.periodLateMinutes)}
					delta={kpis.periodLateMinutes - kpis.previousPeriodLateMinutes}
					goodWhen="down"
				/>
				<Kpi
					label="Overtime this cutoff"
					value={formatDuration(kpis.periodOvertimeMinutes)}
					delta={
						kpis.periodOvertimeMinutes - kpis.previousPeriodOvertimeMinutes
					}
				/>
				<Kpi
					label="Year-to-date gross"
					value={formatPeso(kpis.ytdGrossCentavos)}
				/>
				<Kpi label="Year-to-date net" value={formatPeso(kpis.ytdNetCentavos)} />
			</section>

			<div className="grid gap-4 lg:grid-cols-2">
				<Panel
					title="Hours per week"
					description="Regular and overtime, last twelve weeks."
					empty={data.weeks.length === 0}
				>
					<ChartContainer config={hoursConfig} className="h-56 w-full">
						<BarChart data={data.weeks} accessibilityLayer>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="label" tickLine={false} axisLine={false} />
							<YAxis tickLine={false} axisLine={false} width={32} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Bar
								dataKey="regularHours"
								stackId="h"
								fill="var(--color-regularHours)"
								radius={[0, 0, 4, 4]}
							/>
							<Bar
								dataKey="overtimeHours"
								stackId="h"
								fill="var(--color-overtimeHours)"
								radius={[4, 4, 0, 0]}
							/>
						</BarChart>
					</ChartContainer>
				</Panel>

				<Panel
					title="Punctuality"
					description="Average arrival against your scheduled start. Below the line is early."
					empty={data.weeks.every((w) => w.punctualityMinutes === null)}
				>
					<ChartContainer config={punctualityConfig} className="h-56 w-full">
						<LineChart data={data.weeks} accessibilityLayer>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="label" tickLine={false} axisLine={false} />
							<YAxis
								tickLine={false}
								axisLine={false}
								width={40}
								tickFormatter={(value) => `${value}m`}
							/>
							<ReferenceLine y={0} stroke="var(--border)" />
							<ChartTooltip content={<ChartTooltipContent />} />
							<Line
								dataKey="punctualityMinutes"
								type="monotone"
								stroke="var(--color-punctualityMinutes)"
								strokeWidth={2}
								dot={{ r: 3 }}
								connectNulls
							/>
						</LineChart>
					</ChartContainer>
				</Panel>

				<Panel
					title="Late and overtime by cutoff"
					description="The last six pay periods, in minutes."
					empty={data.periods.every(
						(p) => p.lateMinutes === 0 && p.overtimeMinutes === 0,
					)}
				>
					<ChartContainer config={trendConfig} className="h-56 w-full">
						<BarChart data={data.periods} accessibilityLayer>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="label" tickLine={false} axisLine={false} />
							<YAxis tickLine={false} axisLine={false} width={40} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Bar
								dataKey="lateMinutes"
								fill="var(--color-lateMinutes)"
								radius={4}
							/>
							<Bar
								dataKey="overtimeMinutes"
								fill="var(--color-overtimeMinutes)"
								radius={4}
							/>
						</BarChart>
					</ChartContainer>
				</Panel>

				<Panel
					title="Net pay and deductions"
					description="From finalized payslips only."
					empty={data.months.length === 0}
					emptyNote="Finalize a payslip to see earnings here."
				>
					<ChartContainer config={moneyConfig} className="h-56 w-full">
						<BarChart data={data.months} accessibilityLayer>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="label" tickLine={false} axisLine={false} />
							<YAxis tickLine={false} axisLine={false} width={52} />
							<ChartTooltip content={<ChartTooltipContent />} />
							<ChartLegend content={<ChartLegendContent />} />
							<Bar
								dataKey="netPesos"
								stackId="m"
								fill="var(--color-netPesos)"
								radius={[0, 0, 4, 4]}
							/>
							<Bar
								dataKey="deductionPesos"
								stackId="m"
								fill="var(--color-deductionPesos)"
								radius={[4, 4, 0, 0]}
							/>
						</BarChart>
					</ChartContainer>
				</Panel>
			</div>

			<Card className="mt-4">
				<CardHeader>
					<CardTitle className="font-serif text-base">Leave balances</CardTitle>
				</CardHeader>
				<CardContent>
					{data.leaveBalances.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No leave credits recorded yet.{" "}
							<Button variant="link" className="h-auto p-0" asChild>
								<Link to="/leave">Add credits</Link>
							</Button>
						</p>
					) : (
						<div className="grid gap-3 sm:grid-cols-3">
							{data.leaveBalances.map((balance) => (
								<div key={balance.code} className="rounded-lg border p-3">
									<div className="flex items-center justify-between">
										<span className="text-sm">{balance.name}</span>
										<Badge variant="outline">{balance.code}</Badge>
									</div>
									<p className="mt-1 font-serif text-xl font-semibold tabular-nums">
										{balance.balanceDays}
										<span className="ml-1 text-sm font-normal text-muted-foreground">
											of {balance.earnedDays} days
										</span>
									</p>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</>
	);
}

function Kpi({
	label,
	value,
	delta,
	goodWhen,
}: {
	label: string;
	value: string;
	delta?: number;
	goodWhen?: "up" | "down";
}) {
	const showDelta = delta !== undefined && delta !== 0;
	const isUp = (delta ?? 0) > 0;
	// Only colour the change where a direction is genuinely better or worse.
	const tone =
		goodWhen === undefined
			? "text-muted-foreground"
			: (goodWhen === "up") === isUp
				? "text-primary"
				: "text-destructive";

	return (
		<Card>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium text-muted-foreground">
					{label}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="font-serif text-2xl font-semibold tabular-nums">
					{value}
				</p>
				{showDelta ? (
					<p className={`mt-1 flex items-center gap-1 text-xs ${tone}`}>
						{isUp ? (
							<ArrowUp className="size-3" />
						) : (
							<ArrowDown className="size-3" />
						)}
						{formatDuration(Math.abs(delta))} vs last cutoff
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

function Panel({
	title,
	description,
	empty,
	emptyNote,
	children,
}: {
	title: string;
	description: string;
	empty: boolean;
	emptyNote?: string;
	children: React.ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="font-serif text-base">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{empty ? (
					<p className="py-12 text-center text-sm text-muted-foreground">
						{emptyNote ?? "Not enough data yet."}
					</p>
				) : (
					children
				)}
			</CardContent>
		</Card>
	);
}
