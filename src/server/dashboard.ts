import { findRecordsInRange } from "#/db/repo/dtr.ts";
import { findHolidaysInYear } from "#/db/repo/holidays.ts";
import { findLeaveTypes, findLedger } from "#/db/repo/leave.ts";
import { listPayslips } from "#/db/repo/payroll.ts";
import {
	ensureUserBootstrap,
	findEmploymentTerms,
	findSchedules,
	toScheduleSnapshot,
} from "#/db/repo/profile.ts";
import {
	type Anomaly,
	type AnomalyDay,
	detectAnomalies,
} from "#/lib/payroll/anomalies.ts";
import { resolveEffective } from "#/lib/payroll/effective.ts";
import { summarizeBalances } from "#/lib/payroll/leave.ts";
import {
	addDays,
	assertIsoDate,
	cutoffBounds,
	cutoffForDate,
	dayOfWeek,
	eachDate,
	type IsoDate,
	previousCutoff,
	todayInManila,
} from "#/lib/payroll/time.ts";
import { protectedFn } from "./fn.ts";

export interface WeekPoint {
	/** Monday of the week, as "YYYY-MM-DD". */
	week: string;
	label: string;
	regularHours: number;
	overtimeHours: number;
	/** Average arrival against the scheduled start, in minutes. */
	punctualityMinutes: number | null;
}

export interface PeriodPoint {
	periodKey: string;
	label: string;
	lateMinutes: number;
	overtimeMinutes: number;
}

export interface MonthMoneyPoint {
	month: string;
	label: string;
	netPesos: number;
	deductionPesos: number;
}

export interface DashboardData {
	today: string;
	currentPeriodKey: string;
	kpis: {
		periodWorkedMinutes: number;
		periodLateMinutes: number;
		periodOvertimeMinutes: number;
		previousPeriodWorkedMinutes: number;
		previousPeriodLateMinutes: number;
		previousPeriodOvertimeMinutes: number;
		ytdGrossCentavos: number;
		ytdDeductionsCentavos: number;
		ytdNetCentavos: number;
	};
	weeks: WeekPoint[];
	periods: PeriodPoint[];
	months: MonthMoneyPoint[];
	leaveBalances: Array<{
		code: string;
		name: string;
		balanceDays: number;
		earnedDays: number;
	}>;
	anomalies: Anomaly[];
	isConfigured: boolean;
}

/** Monday of the week containing `date`. */
function weekStart(date: IsoDate): IsoDate {
	const weekday = dayOfWeek(date);
	// Sunday is 0, so it belongs to the week that began six days earlier.
	return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

const WEEK_LABEL = new Intl.DateTimeFormat("en-PH", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

const MONTH_LABEL = new Intl.DateTimeFormat("en-PH", {
	month: "short",
	timeZone: "UTC",
});

const toHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
const toPesos = (centavos: number) => Math.round(centavos) / 100;

/**
 * One call returning everything the dashboard shows.
 *
 * Aggregation happens here rather than in the browser so the page ships numbers
 * instead of a year of raw rows, and so the figures come from the same records
 * the DTR and payslip screens read.
 */
export async function buildDashboard(userId: string): Promise<DashboardData> {
	await ensureUserBootstrap(userId);

	const today = todayInManila();
	const year = Number(today.slice(0, 4));
	const current = cutoffForDate(today);
	const previous = previousCutoff(current);

	// Twelve weeks of history is enough for trends without pulling a whole year.
	const windowStart = addDays(today, -84);
	const yearStart = assertIsoDate(`${year}-01-01`);
	const historyStart = windowStart < yearStart ? windowStart : yearStart;

	const [terms, schedules, records, ledger, leaveTypes, payslips, holidays] =
		await Promise.all([
			findEmploymentTerms(userId),
			findSchedules(userId),
			findRecordsInRange(userId, historyStart, current.end),
			findLedger(userId),
			findLeaveTypes(userId),
			listPayslips(userId),
			findHolidaysInYear(userId, year),
		]);

	const activeTerms = resolveEffective(terms, today);
	const holidayDates = new Set(holidays.map((h) => h.holidayDate));
	const recordByDate = new Map(records.map((r) => [r.workDate, r]));

	const scheduleFor = (date: IsoDate) => {
		const schedule = resolveEffective(schedules, date);
		if (!schedule) return null;
		return toScheduleSnapshot(
			schedule,
			schedule.days.find((d) => d.weekday === dayOfWeek(date)),
		);
	};

	/* ------------------------------ KPI tiles --------------------------- */

	const sumRange = (from: string, to: string) => {
		let worked = 0;
		let late = 0;
		let overtime = 0;
		for (const record of records) {
			if (record.workDate < from || record.workDate > to) continue;
			worked += record.workedMinutes;
			late += record.lateMinutes;
			overtime += record.overtimeMinutes;
		}
		return { worked, late, overtime };
	};

	const currentTotals = sumRange(current.start, current.end);
	const previousTotals = sumRange(previous.start, previous.end);

	/* -------------------------- weekly series --------------------------- */

	const weekMap = new Map<
		string,
		{ regular: number; overtime: number; arrivals: number[] }
	>();

	for (const date of eachDate(windowStart, today)) {
		const record = recordByDate.get(date);
		if (!record) continue;
		const key = weekStart(date);
		let bucket = weekMap.get(key);
		if (!bucket) {
			bucket = { regular: 0, overtime: 0, arrivals: [] };
			weekMap.set(key, bucket);
		}
		bucket.regular += Math.max(
			0,
			record.workedMinutes - record.overtimeMinutes,
		);
		bucket.overtime += record.overtimeMinutes;

		// Punctuality is arrival relative to the scheduled start, so a person
		// on an 07:00 shift is comparable with one on 09:00.
		const snapshot = scheduleFor(date);
		if (
			snapshot?.amIn !== null &&
			snapshot?.amIn !== undefined &&
			record.amInMinute !== null
		) {
			bucket.arrivals.push(record.amInMinute - snapshot.amIn);
		}
	}

	const weeks: WeekPoint[] = [...weekMap.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([week, bucket]) => ({
			week,
			label: WEEK_LABEL.format(new Date(`${week}T00:00:00Z`)),
			regularHours: toHours(bucket.regular),
			overtimeHours: toHours(bucket.overtime),
			punctualityMinutes:
				bucket.arrivals.length === 0
					? null
					: Math.round(
							bucket.arrivals.reduce((a, b) => a + b, 0) /
								bucket.arrivals.length,
						),
		}));

	/* -------------------------- period series --------------------------- */

	const periods: PeriodPoint[] = [];
	let cursor = current;
	for (let i = 0; i < 6; i++) {
		const totals = sumRange(cursor.start, cursor.end);
		periods.unshift({
			periodKey: cursor.periodKey,
			label: `${MONTH_LABEL.format(new Date(Date.UTC(cursor.year, cursor.month - 1, 1)))} ${cursor.half === 1 ? "1–16" : "17+"}`,
			lateMinutes: totals.late,
			overtimeMinutes: totals.overtime,
		});
		cursor = previousCutoff(cursor);
	}

	/* --------------------------- money series --------------------------- */

	const monthMoney = new Map<string, { net: number; deductions: number }>();
	for (const payslip of payslips) {
		const key = `${payslip.period.year}-${String(payslip.period.month).padStart(2, "0")}`;
		const bucket = monthMoney.get(key) ?? { net: 0, deductions: 0 };
		bucket.net += payslip.netPayCentavos;
		bucket.deductions += payslip.totalDeductionsCentavos;
		monthMoney.set(key, bucket);
	}

	const months: MonthMoneyPoint[] = [...monthMoney.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([month, bucket]) => ({
			month,
			label: MONTH_LABEL.format(new Date(`${month}-01T00:00:00Z`)),
			netPesos: toPesos(bucket.net),
			deductionPesos: toPesos(bucket.deductions),
		}));

	const ytd = payslips
		.filter((p) => p.period.year === year)
		.reduce(
			(acc, p) => ({
				gross: acc.gross + p.grossPayCentavos,
				deductions: acc.deductions + p.totalDeductionsCentavos,
				net: acc.net + p.netPayCentavos,
			}),
			{ gross: 0, deductions: 0, net: 0 },
		);

	/* ------------------------------- leave ------------------------------ */

	const typeById = new Map(leaveTypes.map((type) => [type.id, type]));
	const standardWorkMinutes = scheduleFor(today)?.standardWorkMinutes || 480;
	const leaveBalances = summarizeBalances(
		ledger.filter((entry) => entry.creditYear === year),
	).flatMap((balance) => {
		const type = typeById.get(balance.leaveTypeId);
		if (!type) return [];
		return [
			{
				code: type.code,
				name: type.name,
				balanceDays:
					Math.round((balance.balanceMinutes / standardWorkMinutes) * 10) / 10,
				earnedDays:
					Math.round((balance.earnedMinutes / standardWorkMinutes) * 10) / 10,
			},
		];
	});

	/* ----------------------------- anomalies ---------------------------- */

	const anomalyDays: AnomalyDay[] = eachDate(current.start, current.end).map(
		(date) => {
			const record = recordByDate.get(date);
			const snapshot = scheduleFor(date);
			return {
				date,
				punches: {
					amIn: record?.amInMinute ?? null,
					amOut: record?.amOutMinute ?? null,
					pmIn: record?.pmInMinute ?? null,
					pmOut: record?.pmOutMinute ?? null,
				},
				minutes: {
					workedMinutes: record?.workedMinutes ?? 0,
					creditedRegularMinutes: record?.creditedRegularMinutes ?? 0,
					lateMinutes: record?.lateMinutes ?? 0,
					undertimeMinutes: record?.undertimeMinutes ?? 0,
					overtimeMinutes: record?.overtimeMinutes ?? 0,
					nightDiffMinutes: record?.nightDiffMinutes ?? 0,
					nightDiffOvertimeMinutes: record?.nightDiffOvertimeMinutes ?? 0,
					paidLeaveMinutes: record?.paidLeaveMinutes ?? 0,
					unpaidMinutes: record?.unpaidMinutes ?? 0,
					flags: record?.flags ?? [],
				},
				hasRecord: record !== undefined,
				isScheduledWorkday:
					snapshot !== null && !snapshot.isRestDay && !holidayDates.has(date),
			};
		},
	);

	const daysRemaining = Math.max(
		0,
		Math.round(
			(Date.parse(`${current.end}T00:00:00Z`) -
				Date.parse(`${today}T00:00:00Z`)) /
				86_400_000,
		),
	);

	const anomalies = detectAnomalies({
		today,
		days: anomalyDays,
		currentCutoff: {
			start: current.start,
			end: current.end,
			daysRemaining,
		},
		// Exclude the period in progress from its own baseline.
		baseline: {
			lateMinutes: periods.slice(0, -1).map((p) => p.lateMinutes),
			overtimeMinutes: periods.slice(0, -1).map((p) => p.overtimeMinutes),
		},
		periodLateMinutes: currentTotals.late,
		periodOvertimeMinutes: currentTotals.overtime,
		leaveBalances: leaveBalances.map((balance) => ({
			code: balance.code,
			name: balance.name,
			balanceMinutes: Math.round(balance.balanceDays * standardWorkMinutes),
			// Credits are per calendar year unless a policy says otherwise.
			expiresOn: `${year}-12-31`,
		})),
		standardWorkMinutes,
	});

	return {
		today,
		currentPeriodKey: cutoffBounds(current.year, current.month, current.half)
			.periodKey,
		kpis: {
			periodWorkedMinutes: currentTotals.worked,
			periodLateMinutes: currentTotals.late,
			periodOvertimeMinutes: currentTotals.overtime,
			previousPeriodWorkedMinutes: previousTotals.worked,
			previousPeriodLateMinutes: previousTotals.late,
			previousPeriodOvertimeMinutes: previousTotals.overtime,
			ytdGrossCentavos: ytd.gross,
			ytdDeductionsCentavos: ytd.deductions,
			ytdNetCentavos: ytd.net,
		},
		weeks,
		periods,
		months,
		leaveBalances,
		anomalies,
		isConfigured: (activeTerms?.monthlyRateCentavos ?? 0) > 0,
	};
}

/** Thin wrapper, so `npm run verify:dashboard` exercises the same code path. */
export const getDashboard = protectedFn({ method: "GET" }).handler(
	({ context }) => buildDashboard(context.userId),
);
