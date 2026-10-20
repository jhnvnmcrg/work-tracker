import {
	queryOptions,
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Table2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "#/components/layout/page-header.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import {
	formatPeso,
	pesosToCentavos,
	toPesoString,
} from "#/lib/payroll/money.ts";
import { deriveRateBasis } from "#/lib/payroll/rates.ts";
import { getSettings, updateSettings } from "#/server/settings.ts";

const settingsQuery = queryOptions({
	queryKey: ["settings"] as const,
	queryFn: () => getSettings(),
});

export const Route = createFileRoute("/_app/settings/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
	component: SettingsPage,
});

const WEEKDAYS = [
	{ value: 0, label: "Sun" },
	{ value: 1, label: "Mon" },
	{ value: 2, label: "Tue" },
	{ value: 3, label: "Wed" },
	{ value: 4, label: "Thu" },
	{ value: 5, label: "Fri" },
	{ value: 6, label: "Sat" },
];

const TIMINGS = [
	{ value: "first_cutoff", label: "On the 1–16 cutoff" },
	{ value: "second_cutoff", label: "On the 17–end cutoff" },
	{ value: "split_even", label: "Split across both" },
];

const FACTORS = [
	{ value: 31_300, label: "313 — six-day week" },
	{ value: 26_100, label: "261 — five-day week" },
	{ value: 36_500, label: "365 — every calendar day" },
];

function SettingsPage() {
	const { data } = useSuspenseQuery(settingsQuery);
	const queryClient = useQueryClient();

	const [monthly, setMonthly] = useState(
		toPesoString(data.monthlyRateCentavos),
	);
	const [factor, setFactor] = useState(String(data.workingDaysFactorX100));
	const [dailyHours, setDailyHours] = useState(String(data.dailyHours));
	const [grace, setGrace] = useState(String(data.graceMinutes));
	const [graceForfeits, setGraceForfeits] = useState(data.graceForfeits);
	const [minOt, setMinOt] = useState(String(data.minOvertimeMinutes));
	const [otApproval, setOtApproval] = useState(data.overtimeRequiresApproval);
	const [restDays, setRestDays] = useState<number[]>(data.restDays);
	const [sssTiming, setSssTiming] = useState(data.sssTiming);
	const [phicTiming, setPhicTiming] = useState(data.philhealthTiming);
	const [hdmfTiming, setHdmfTiming] = useState(data.pagibigTiming);
	const [taxExempt, setTaxExempt] = useState(data.taxExempt);

	const save = useMutation({
		mutationFn: () =>
			updateSettings({
				data: {
					monthlyRateCentavos: pesosToCentavos(monthly),
					workingDaysFactorX100: Number(factor),
					dailyHours: Number(dailyHours),
					graceMinutes: Number(grace),
					graceForfeits,
					minOvertimeMinutes: Number(minOt),
					overtimeRequiresApproval: otApproval,
					sssTiming: sssTiming as never,
					philhealthTiming: phicTiming as never,
					pagibigTiming: hdmfTiming as never,
					taxExempt,
					restDays,
				},
			}),
		onSuccess: () => toast.success("Settings saved."),
		onError: () => toast.error("Could not save those settings."),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["settings"] });
			queryClient.invalidateQueries({ queryKey: ["dtr"] });
			queryClient.invalidateQueries({ queryKey: ["payslip"] });
		},
	});

	/* A live preview, so the effect of changing the factor is visible before
	   saving rather than surfacing later as a wrong deduction. */
	let preview = { dailyCentavos: 0, hourlyCentavos: 0 };
	try {
		const rates = deriveRateBasis({
			monthlyRateCentavos: pesosToCentavos(monthly),
			workingDaysFactorX100: Number(factor),
			dailyHours: Number(dailyHours) || 8,
			rateRoundingMode: "amounts_only",
		});
		preview = rates;
	} catch {
		// An in-progress edit; the preview simply stays blank.
	}

	const workdaysPerWeek = 7 - restDays.length;
	const impliedFactor = 365 - restDays.length * 52;
	const factorDisagrees =
		Math.abs(impliedFactor - Number(factor) / 100) > 8 && workdaysPerWeek > 0;

	return (
		<>
			<PageHeader
				title="Settings"
				description="Employment terms, work schedule and pay rates."
				actions={
					<Button variant="outline" asChild>
						<Link to="/settings/statutory">
							<Table2 className="size-4" />
							Contribution tables
						</Link>
					</Button>
				}
			/>

			{factorDisagrees ? (
				<Alert variant="destructive" className="mb-4">
					<AlertTriangle className="size-4" />
					<AlertTitle>
						Your working-days factor does not match your schedule
					</AlertTitle>
					<AlertDescription>
						You work {workdaysPerWeek} day(s) a week, which implies a factor of
						about {impliedFactor}, but {Number(factor) / 100} is selected. Base
						pay is earned per scheduled workday while absences are deducted at
						the factor-derived daily rate, so the two will not balance — an
						absence will be over- or under-deducted every time.
					</AlertDescription>
				</Alert>
			) : null}

			<div className="grid gap-4 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="text-base">Pay</CardTitle>
						<CardDescription>
							Base pay is half the monthly rate on each cutoff, regardless of
							cutoff length.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="monthly">Monthly rate</Label>
							<Input
								id="monthly"
								inputMode="decimal"
								value={monthly}
								onChange={(e) => setMonthly(e.target.value)}
							/>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="factor">Working-days factor</Label>
							<Select value={factor} onValueChange={setFactor}>
								<SelectTrigger id="factor">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{FACTORS.map((option) => (
										<SelectItem key={option.value} value={String(option.value)}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="hours">Hours per day</Label>
							<Input
								id="hours"
								type="number"
								min={1}
								max={24}
								value={dailyHours}
								onChange={(e) => setDailyHours(e.target.value)}
							/>
						</div>

						<dl className="rounded-lg border bg-muted/40 p-3 text-sm">
							<div className="flex justify-between">
								<dt className="text-muted-foreground">Daily rate</dt>
								<dd className="font-medium tabular-nums">
									{formatPeso(preview.dailyCentavos)}
								</dd>
							</div>
							<div className="mt-1 flex justify-between">
								<dt className="text-muted-foreground">Hourly rate</dt>
								<dd className="font-medium tabular-nums">
									{formatPeso(preview.hourlyCentavos)}
								</dd>
							</div>
							<div className="mt-1 flex justify-between">
								<dt className="text-muted-foreground">Base pay per cutoff</dt>
								<dd className="font-medium tabular-nums">
									{formatPeso(Math.floor(pesosToCentavos(monthly || "0") / 2))}
								</dd>
							</div>
						</dl>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="text-base">Schedule</CardTitle>
						<CardDescription>
							Rest days are never charged against leave and never counted as
							absence.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4">
						<fieldset className="grid gap-2">
							<legend className="mb-2 text-sm font-medium">Rest days</legend>
							<div className="flex flex-wrap gap-3">
								{WEEKDAYS.map((day) => (
									<div key={day.value} className="flex items-center gap-2">
										<Checkbox
											id={`rest-${day.value}`}
											checked={restDays.includes(day.value)}
											onCheckedChange={(checked) =>
												setRestDays((current) =>
													checked === true
														? [...current, day.value]
														: current.filter((d) => d !== day.value),
												)
											}
										/>
										<Label
											htmlFor={`rest-${day.value}`}
											className="font-normal"
										>
											{day.label}
										</Label>
									</div>
								))}
							</div>
						</fieldset>

						<div className="grid grid-cols-2 gap-3">
							<div className="grid gap-2">
								<Label htmlFor="grace">Grace (minutes)</Label>
								<Input
									id="grace"
									type="number"
									min={0}
									value={grace}
									onChange={(e) => setGrace(e.target.value)}
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="minot">Minimum overtime</Label>
								<Input
									id="minot"
									type="number"
									min={0}
									value={minOt}
									onChange={(e) => setMinOt(e.target.value)}
								/>
							</div>
						</div>

						<div className="flex items-center gap-2">
							<Checkbox
								id="grace-forfeits"
								checked={graceForfeits}
								onCheckedChange={(v) => setGraceForfeits(v === true)}
							/>
							<Label htmlFor="grace-forfeits" className="font-normal">
								Exceeding grace forfeits it entirely
							</Label>
						</div>

						<div className="flex items-center gap-2">
							<Checkbox
								id="ot-approval"
								checked={otApproval}
								onCheckedChange={(v) => setOtApproval(v === true)}
							/>
							<Label htmlFor="ot-approval" className="font-normal">
								Overtime must be approved to be paid
							</Label>
						</div>
					</CardContent>
				</Card>

				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle className="text-base">Statutory deductions</CardTitle>
						<CardDescription>
							Which cutoff each monthly contribution is withheld on. Withholding
							tax is always computed per cutoff.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 sm:grid-cols-3">
						{(
							[
								["SSS", sssTiming, setSssTiming],
								["PhilHealth", phicTiming, setPhicTiming],
								["Pag-IBIG", hdmfTiming, setHdmfTiming],
							] as const
						).map(([label, value, setter]) => (
							<div key={label} className="grid gap-2">
								<Label htmlFor={`timing-${label}`}>{label}</Label>
								<Select value={value} onValueChange={setter}>
									<SelectTrigger id={`timing-${label}`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{TIMINGS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						))}
						<div className="flex items-center gap-2 sm:col-span-3">
							<Checkbox
								id="tax-exempt"
								checked={taxExempt}
								onCheckedChange={(v) => setTaxExempt(v === true)}
							/>
							<Label htmlFor="tax-exempt" className="font-normal">
								Exempt from withholding tax
							</Label>
						</div>
					</CardContent>
				</Card>
			</div>

			<div className="mt-4 flex justify-end">
				<Button onClick={() => save.mutate()} disabled={save.isPending}>
					{save.isPending ? "Saving…" : "Save settings"}
				</Button>
			</div>
		</>
	);
}
