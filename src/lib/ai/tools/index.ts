import { toolDefinition } from "@tanstack/ai";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import {
	dailyTimeRecords,
	holidays,
	leaveLedger,
	leaveRequestDays,
	leaveRequests,
	leaveTypes,
	payPeriods,
	payslipLineItems,
	payslips,
} from "#/db/schema/index.ts";
import type { AssistantContext } from "#/lib/ai/context.ts";
import { readonlyDb } from "#/lib/ai/db-readonly.ts";
import { detectAnomalies } from "#/lib/payroll/anomalies.ts";
import { summarizeBalances } from "#/lib/payroll/leave.ts";
import { formatPeso } from "#/lib/payroll/money.ts";
import {
	assertIsoDate,
	type CutoffHalf,
	cutoffBounds,
	dayOfWeek,
	eachDate,
	formatDuration,
	formatHHmm,
} from "#/lib/payroll/time.ts";
import { dateRange, isoDate, MAX_ROWS, payPeriodRef } from "./schemas.ts";

/**
 * Read-only tools over the signed-in user's own records.
 *
 * Two principles shape every tool here.
 *
 * **Postgres computes, the model narrates.** A DTR row serialises to roughly 200
 * tokens, so a year is about 55,000 — but the real problem is not cost. Handing
 * the model rows hands it arithmetic, and every sum it gets wrong becomes a wrong
 * peso figure in a payroll app. Aggregate tools therefore return scalars, and
 * comparisons return pre-computed deltas so the model never subtracts.
 *
 * **Money crosses as formatted strings.** `"₱1,234.56"` rather than `1234.56`,
 * so the model quotes a value instead of re-rounding one.
 */

const money = (centavos: number) => formatPeso(centavos);

/** Resolves a period reference into concrete bounds. */
function boundsOf(period: { year: number; month: number; half: 1 | 2 }) {
	return cutoffBounds(period.year, period.month, period.half as CutoffHalf);
}

/* -------------------------------------------------------------------------- */

const getCurrentContext = toolDefinition({
	name: "get_current_context",
	description:
		"Today's date in Manila, the resolved current and previous pay periods, and the employment rates. Call this first whenever the question uses a relative reference such as 'this month', 'last cutoff', 'so far' or 'recently'.",
	inputSchema: z.object({}),
	outputSchema: z.object({
		todayManila: isoDate,
		currentPeriod: z.object({
			label: z.string(),
			startDate: isoDate,
			endDate: isoDate,
			dayCount: z.int(),
			isClosed: z.boolean(),
		}),
		previousPeriod: z.object({
			label: z.string(),
			startDate: isoDate,
			endDate: isoDate,
			dayCount: z.int(),
		}),
		employment: z.object({
			monthlyRatePhp: z.string(),
			dailyRatePhp: z.string(),
			hourlyRatePhp: z.string(),
			workingDaysFactor: z.number(),
			standardHoursPerDay: z.number(),
			isConfigured: z.boolean(),
		}),
	}),
}).server<AssistantContext>(async (_args, ctx) => {
	const { currentPeriod, previousPeriod, todayManila, employment } =
		ctx.context;
	const label = (b: typeof currentPeriod) =>
		`${b.start} to ${b.end}${b.half === 1 ? " (1st to 16th)" : " (17th to month end)"}`;
	return {
		todayManila,
		currentPeriod: {
			label: label(currentPeriod),
			startDate: currentPeriod.start,
			endDate: currentPeriod.end,
			dayCount: currentPeriod.dayCount,
			isClosed: todayManila > currentPeriod.end,
		},
		previousPeriod: {
			label: label(previousPeriod),
			startDate: previousPeriod.start,
			endDate: previousPeriod.end,
			dayCount: previousPeriod.dayCount,
		},
		employment,
	};
});

/* -------------------------------------------------------------------------- */

const periodSummaryShape = z.object({
	period: z.object({
		label: z.string(),
		startDate: isoDate,
		endDate: isoDate,
		dayCount: z.int(),
	}),
	days: z.object({
		scheduled: z.int(),
		worked: z.int(),
		onLeave: z.int(),
		absent: z.int(),
		withIncompletePunches: z.int(),
	}),
	hours: z.object({
		worked: z.string(),
		overtime: z.string(),
		paidLeave: z.string(),
	}),
	attendance: z.object({
		lateOccurrences: z.int(),
		lateTotal: z.string(),
		undertimeOccurrences: z.int(),
		undertimeTotal: z.string(),
	}),
	dataQuality: z.object({
		complete: z.boolean(),
		missingDates: z.array(isoDate),
	}),
});

async function summarisePeriod(
	userId: string,
	period: { year: number; month: number; half: 1 | 2 },
) {
	const bounds = boundsOf(period);
	const rows = await readonlyDb()
		.select()
		.from(dailyTimeRecords)
		.where(
			and(
				eq(dailyTimeRecords.userId, userId),
				gte(dailyTimeRecords.workDate, bounds.start),
				lte(dailyTimeRecords.workDate, bounds.end),
			),
		);

	const byDate = new Map(rows.map((r) => [r.workDate, r]));
	const missingDates: string[] = [];
	let scheduled = 0;

	for (const date of eachDate(bounds.start, bounds.end)) {
		const weekday = dayOfWeek(date);
		const record = byDate.get(date);
		const isRestDay = record?.isRestDay ?? (weekday === 0 || weekday === 6);
		if (isRestDay) continue;
		scheduled += 1;
		if (!record) missingDates.push(date);
	}

	const sum = (pick: (r: (typeof rows)[number]) => number) =>
		rows.reduce((total, row) => total + pick(row), 0);

	return {
		period: {
			label: `${bounds.start} to ${bounds.end}`,
			startDate: bounds.start,
			endDate: bounds.end,
			dayCount: bounds.dayCount,
		},
		days: {
			scheduled,
			worked: rows.filter((r) => r.workedMinutes > 0).length,
			onLeave: rows.filter((r) => r.paidLeaveMinutes > 0).length,
			absent: rows.filter((r) => r.unpaidMinutes > 0 && r.workedMinutes === 0)
				.length,
			withIncompletePunches: rows.filter((r) =>
				(r.flags ?? []).includes("missing_punch"),
			).length,
		},
		hours: {
			worked: formatDuration(sum((r) => r.workedMinutes)),
			overtime: formatDuration(sum((r) => r.overtimeMinutes)),
			paidLeave: formatDuration(sum((r) => r.paidLeaveMinutes)),
		},
		attendance: {
			lateOccurrences: rows.filter((r) => r.lateMinutes > 0).length,
			lateTotal: formatDuration(sum((r) => r.lateMinutes)),
			undertimeOccurrences: rows.filter((r) => r.undertimeMinutes > 0).length,
			undertimeTotal: formatDuration(sum((r) => r.undertimeMinutes)),
		},
		// Stated up front so an incomplete total is never presented as a fact.
		dataQuality: { complete: missingDates.length === 0, missingDates },
		rawLate: sum((r) => r.lateMinutes),
		rawOvertime: sum((r) => r.overtimeMinutes),
		rawWorked: sum((r) => r.workedMinutes),
	};
}

const getPeriodSummary = toolDefinition({
	name: "get_period_summary",
	description:
		"Totals for one semi-monthly pay period: hours, lateness, undertime, overtime and day counts. Use this for any 'how many hours', 'how late was I' or 'how many days' question. Returns totals only — call list_time_records if specific dates are needed. A calendar month spans two periods, so a question about a whole month needs two calls.",
	inputSchema: z.object({ period: payPeriodRef }),
	outputSchema: periodSummaryShape,
}).server<AssistantContext>(async ({ period }, ctx) => {
	const { rawLate, rawOvertime, rawWorked, ...summary } = await summarisePeriod(
		ctx.context.userId,
		period,
	);
	void rawLate;
	void rawOvertime;
	void rawWorked;
	return summary;
});

/* -------------------------------------------------------------------------- */

const comparePeriods = toolDefinition({
	name: "compare_periods",
	description:
		"Compares two pay periods and returns the differences already computed. Use this for 'was I late more this month than last' and similar. The deltas are worked out here, so do not subtract anything yourself.",
	inputSchema: z.object({ periodA: payPeriodRef, periodB: payPeriodRef }),
	outputSchema: z.object({
		a: periodSummaryShape,
		b: periodSummaryShape,
		deltas: z
			.object({
				lateMinutes: z.int(),
				overtimeMinutes: z.int(),
				workedMinutes: z.int(),
			})
			.meta({
				description:
					"B minus A, in minutes. A negative value means B is lower than A.",
			}),
		narrative: z.array(z.string()).meta({
			description:
				"Factual comparison lines, already computed. Safe to quote verbatim.",
		}),
	}),
}).server<AssistantContext>(async ({ periodA, periodB }, ctx) => {
	const a = await summarisePeriod(ctx.context.userId, periodA);
	const b = await summarisePeriod(ctx.context.userId, periodB);

	const deltas = {
		lateMinutes: b.rawLate - a.rawLate,
		overtimeMinutes: b.rawOvertime - a.rawOvertime,
		workedMinutes: b.rawWorked - a.rawWorked,
	};

	const describe = (label: string, delta: number) => {
		if (delta === 0) return `${label} was the same in both periods.`;
		const direction = delta > 0 ? "more" : "less";
		return `${label} was ${formatDuration(Math.abs(delta))} ${direction} in ${b.period.label} than in ${a.period.label}.`;
	};

	const { rawLate: _al, rawOvertime: _ao, rawWorked: _aw, ...aOut } = a;
	const { rawLate: _bl, rawOvertime: _bo, rawWorked: _bw, ...bOut } = b;

	return {
		a: aOut,
		b: bOut,
		deltas,
		narrative: [
			describe("Lateness", deltas.lateMinutes),
			describe("Overtime", deltas.overtimeMinutes),
			describe("Time worked", deltas.workedMinutes),
		],
	};
});

/* -------------------------------------------------------------------------- */

const listTimeRecords = toolDefinition({
	name: "list_time_records",
	description:
		"Day-by-day time records for a date range. By default only days with something notable are returned — lateness, undertime, overtime, incomplete punches, absence or leave. Set onlyExceptions to false only when a full day-by-day listing is explicitly asked for.",
	inputSchema: z.object({
		range: dateRange,
		onlyExceptions: z.boolean().default(true).meta({
			description:
				"When true (the default), returns only days with something notable rather than every ordinary day.",
		}),
	}),
	outputSchema: z.object({
		rows: z.array(
			z.object({
				date: isoDate,
				dayOfWeek: z.string(),
				amIn: z.string().nullable(),
				amOut: z.string().nullable(),
				pmIn: z.string().nullable(),
				pmOut: z.string().nullable(),
				worked: z.string(),
				late: z.string(),
				undertime: z.string(),
				overtime: z.string(),
				status: z.string(),
				flags: z.array(z.string()),
			}),
		),
		returned: z.int(),
		matched: z.int(),
		truncated: z.boolean(),
		hint: z.string().nullable(),
	}),
}).server<AssistantContext>(async ({ range, onlyExceptions }, ctx) => {
	const rows = await readonlyDb()
		.select()
		.from(dailyTimeRecords)
		.where(
			and(
				eq(dailyTimeRecords.userId, ctx.context.userId),
				gte(dailyTimeRecords.workDate, range.from),
				lte(dailyTimeRecords.workDate, range.to),
			),
		)
		.orderBy(dailyTimeRecords.workDate);

	const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const interesting = rows.filter(
		(r) =>
			r.lateMinutes > 0 ||
			r.undertimeMinutes > 0 ||
			r.overtimeMinutes > 0 ||
			r.unpaidMinutes > 0 ||
			r.paidLeaveMinutes > 0 ||
			(r.flags ?? []).length > 0,
	);

	const matched = onlyExceptions ? interesting : rows;
	const capped = matched.slice(0, MAX_ROWS);

	return {
		rows: capped.map((r) => ({
			date: r.workDate,
			dayOfWeek: names[dayOfWeek(assertIsoDate(r.workDate))],
			amIn: r.amInMinute === null ? null : formatHHmm(r.amInMinute),
			amOut: r.amOutMinute === null ? null : formatHHmm(r.amOutMinute),
			pmIn: r.pmInMinute === null ? null : formatHHmm(r.pmInMinute),
			pmOut: r.pmOutMinute === null ? null : formatHHmm(r.pmOutMinute),
			worked: formatDuration(r.workedMinutes),
			late: formatDuration(r.lateMinutes),
			undertime: formatDuration(r.undertimeMinutes),
			overtime: formatDuration(r.overtimeMinutes),
			status: r.status,
			flags: r.flags ?? [],
		})),
		returned: capped.length,
		matched: matched.length,
		truncated: matched.length > capped.length,
		hint:
			matched.length > capped.length
				? "More days matched than were returned. Use get_period_summary for totals rather than asking for a longer listing."
				: null,
	};
});

/* -------------------------------------------------------------------------- */

const getPayslip = toolDefinition({
	name: "get_payslip",
	description:
		"A finalized payslip for one pay period, with every line item and the derivation recorded when it was computed. Use this to explain any figure on a payslip. The computation and rule reference on each line were captured at computation time, so they describe the rules that were actually applied rather than today's.",
	inputSchema: z.object({ period: payPeriodRef }),
	outputSchema: z.object({
		found: z.boolean(),
		payslip: z
			.object({
				period: z.string(),
				payDate: isoDate,
				status: z.string(),
				grossPhp: z.string(),
				totalDeductionsPhp: z.string(),
				netPayPhp: z.string(),
				taxableCompensationPhp: z.string(),
				monthlyRatePhp: z.string(),
				dailyRatePhp: z.string(),
				hourlyRatePhp: z.string(),
			})
			.nullable(),
		lineItems: z.array(
			z.object({
				code: z.string(),
				label: z.string(),
				section: z.string(),
				amountPhp: z.string(),
				computation: z.string(),
				ruleReference: z.string().nullable(),
				sourceDates: z.array(isoDate),
				reducesTaxableGross: z.boolean(),
			}),
		),
		note: z.string().nullable(),
	}),
}).server<AssistantContext>(async ({ period }, ctx) => {
	const bounds = boundsOf(period);
	const periodRows = await readonlyDb()
		.select()
		.from(payPeriods)
		.where(
			and(
				eq(payPeriods.userId, ctx.context.userId),
				eq(payPeriods.year, period.year),
				eq(payPeriods.month, period.month),
				eq(payPeriods.half, period.half === 1 ? "first" : "second"),
			),
		)
		.limit(1);

	if (periodRows.length === 0) {
		return {
			found: false,
			payslip: null,
			lineItems: [],
			note: `No payslip has been finalized for ${bounds.start} to ${bounds.end}.`,
		};
	}

	const slipRows = await readonlyDb()
		.select()
		.from(payslips)
		.where(
			and(
				eq(payslips.userId, ctx.context.userId),
				eq(payslips.payPeriodId, periodRows[0].id),
				eq(payslips.status, "finalized"),
			),
		)
		.limit(1);

	if (slipRows.length === 0) {
		return {
			found: false,
			payslip: null,
			lineItems: [],
			note: `The period ${bounds.start} to ${bounds.end} exists but no payslip has been finalized for it yet.`,
		};
	}

	const slip = slipRows[0];
	const lines = await readonlyDb()
		.select()
		.from(payslipLineItems)
		.where(
			and(
				eq(payslipLineItems.userId, ctx.context.userId),
				eq(payslipLineItems.payslipId, slip.id),
			),
		)
		.orderBy(payslipLineItems.sortOrder);

	return {
		found: true,
		payslip: {
			period: `${bounds.start} to ${bounds.end}`,
			payDate: periodRows[0].payDate,
			status: slip.status,
			grossPhp: money(slip.grossPayCentavos),
			totalDeductionsPhp: money(slip.totalDeductionsCentavos),
			netPayPhp: money(slip.netPayCentavos),
			taxableCompensationPhp: money(slip.taxableGrossCentavos),
			monthlyRatePhp: money(slip.monthlyRateCentavos),
			dailyRatePhp: money(slip.dailyRateCentavos),
			hourlyRatePhp: money(slip.hourlyRateCentavos),
		},
		lineItems: lines.map((line) => ({
			code: line.code,
			label: line.label,
			section: line.section,
			amountPhp: money(line.amountCentavos),
			computation: line.computation?.computation ?? "",
			ruleReference: line.computation?.ruleReference ?? null,
			sourceDates: line.computation?.sourceDates ?? [],
			reducesTaxableGross: line.reducesTaxableGross,
		})),
		note: null,
	};
});

/* -------------------------------------------------------------------------- */

const getLeaveAndHolidays = toolDefinition({
	name: "get_leave_and_holidays",
	description:
		"Leave balances, filed leave, and holidays in a date range. Leave and holidays usually answer the same question — why hours were lower than expected — so both come back together.",
	inputSchema: z.object({ range: dateRange }),
	outputSchema: z.object({
		balances: z.array(
			z.object({
				code: z.string(),
				name: z.string(),
				grantedDays: z.string(),
				usedDays: z.string(),
				remainingDays: z.string(),
			}),
		),
		leaveDays: z.array(
			z.object({
				date: isoDate,
				type: z.string(),
				portion: z.string(),
				paid: z.boolean(),
			}),
		),
		holidays: z.array(
			z.object({ date: isoDate, name: z.string(), kind: z.string() }),
		),
	}),
}).server<AssistantContext>(async ({ range }, ctx) => {
	const userId = ctx.context.userId;
	const year = Number(range.from.slice(0, 4));

	const [types, ledger, days, holidayRows] = await Promise.all([
		readonlyDb().select().from(leaveTypes).where(eq(leaveTypes.userId, userId)),
		readonlyDb()
			.select()
			.from(leaveLedger)
			.where(eq(leaveLedger.userId, userId)),
		readonlyDb()
			.select({
				date: leaveRequestDays.leaveDate,
				portion: leaveRequestDays.portion,
				paid: leaveRequestDays.isPaid,
				code: leaveTypes.code,
			})
			.from(leaveRequestDays)
			.innerJoin(
				leaveRequests,
				eq(leaveRequestDays.requestId, leaveRequests.id),
			)
			.innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
			.where(
				and(
					eq(leaveRequestDays.userId, userId),
					gte(leaveRequestDays.leaveDate, range.from),
					lte(leaveRequestDays.leaveDate, range.to),
					inArray(leaveRequests.status, ["approved", "submitted"]),
				),
			),
		readonlyDb()
			.select()
			.from(holidays)
			.where(
				and(
					gte(holidays.holidayDate, range.from),
					lte(holidays.holidayDate, range.to),
				),
			),
	]);

	const byId = new Map(types.map((t) => [t.id, t]));
	const standard = 480;
	const toDays = (minutes: number) => (minutes / standard).toFixed(2);

	return {
		balances: summarizeBalances(
			ledger.filter((e) => e.creditYear === year),
		).flatMap((balance) => {
			const type = byId.get(balance.leaveTypeId);
			if (!type) return [];
			return [
				{
					code: type.code,
					name: type.name,
					grantedDays: toDays(balance.earnedMinutes),
					usedDays: toDays(balance.usedMinutes),
					remainingDays: toDays(balance.balanceMinutes),
				},
			];
		}),
		leaveDays: days.map((d) => ({
			date: d.date,
			type: d.code,
			portion: d.portion,
			paid: d.paid,
		})),
		holidays: holidayRows
			.filter((h) => h.userId === null || h.userId === userId)
			.map((h) => ({ date: h.holidayDate, name: h.name, kind: h.kind })),
	};
});

/* -------------------------------------------------------------------------- */

const getAnomalies = toolDefinition({
	name: "get_anomalies",
	description:
		"Problems found in the time record for the current pay period: missing punches, unfilled workdays, implausible durations. These are detected by the application, not by you. Report only what this returns and cite only the figures in each entry's facts.",
	inputSchema: z.object({}),
	outputSchema: z.object({
		anomalies: z.array(
			z.object({
				code: z.string(),
				severity: z.string(),
				title: z.string(),
				dates: z.array(isoDate),
				facts: z.record(z.string(), z.string()).meta({
					description:
						"Pre-computed values. These are the only figures you may cite for this finding.",
				}),
				message: z.string(),
			}),
		),
		scannedRange: z.object({ from: isoDate, to: isoDate }),
		totalCount: z.int(),
	}),
}).server<AssistantContext>(async (_args, ctx) => {
	const { userId, currentPeriod, todayManila } = ctx.context;

	const rows = await readonlyDb()
		.select()
		.from(dailyTimeRecords)
		.where(
			and(
				eq(dailyTimeRecords.userId, userId),
				gte(dailyTimeRecords.workDate, currentPeriod.start),
				lte(dailyTimeRecords.workDate, currentPeriod.end),
			),
		);

	const byDate = new Map(rows.map((r) => [r.workDate, r]));
	const days = eachDate(currentPeriod.start, currentPeriod.end).map((date) => {
		const record = byDate.get(date);
		const weekday = dayOfWeek(date);
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
				nightDiffMinutes: 0,
				nightDiffOvertimeMinutes: 0,
				paidLeaveMinutes: record?.paidLeaveMinutes ?? 0,
				unpaidMinutes: record?.unpaidMinutes ?? 0,
				flags: record?.flags ?? [],
			},
			hasRecord: record !== undefined,
			isScheduledWorkday:
				record?.isRestDay === false || (weekday !== 0 && weekday !== 6),
		};
	});

	const anomalies = detectAnomalies({
		today: todayManila,
		days,
		currentCutoff: {
			start: currentPeriod.start,
			end: currentPeriod.end,
			daysRemaining: Math.max(
				0,
				Math.round(
					(Date.parse(`${currentPeriod.end}T00:00:00Z`) -
						Date.parse(`${todayManila}T00:00:00Z`)) /
						86_400_000,
				),
			),
		},
		baseline: { lateMinutes: [], overtimeMinutes: [] },
		periodLateMinutes: 0,
		periodOvertimeMinutes: 0,
		leaveBalances: [],
		standardWorkMinutes: 480,
	});

	return {
		anomalies: anomalies.map((a) => ({
			code: a.code,
			severity: a.severity,
			title: a.title,
			dates: a.dates,
			facts: a.facts,
			message: a.defaultMessage,
		})),
		scannedRange: { from: currentPeriod.start, to: currentPeriod.end },
		totalCount: anomalies.length,
	};
});

/* -------------------------------------------------------------------------- */

export const assistantTools = [
	getCurrentContext,
	getPeriodSummary,
	comparePeriods,
	listTimeRecords,
	getPayslip,
	getLeaveAndHolidays,
	getAnomalies,
];

export const ASSISTANT_TOOL_NAMES = assistantTools.map((tool) => tool.name);
