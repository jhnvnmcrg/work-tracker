import {
	deleteRecord,
	findLeaveDaysInRange,
	findRecordsInRange,
	type LeaveDayRow,
	type TimeRecordInsert,
	type TimeRecordRow,
	upsertRecords,
} from "#/db/repo/dtr.ts";
import {
	ensureUserBootstrap,
	findEmploymentTerms,
	findHolidays,
	findSchedules,
	type HolidayRow,
	holidayToDayKind,
	toPunchPolicy,
	toScheduleSnapshot,
} from "#/db/repo/profile.ts";
import { computeDailyMinutes } from "#/lib/payroll/daily.ts";
import { resolveEffective } from "#/lib/payroll/effective.ts";
import {
	assertIsoDate,
	cutoffBounds,
	dayOfWeek,
	eachDate,
	type IsoDate,
	parseMonthKey,
	todayInManila,
} from "#/lib/payroll/time.ts";
import { type DtrTotals, sumTotals } from "#/lib/payroll/totals.ts";
import {
	type AttendanceStatus,
	type DailyMinutes,
	type DayKind,
	DEFAULT_PUNCH_POLICY,
	type LeaveContext,
	type PunchPolicy,
	type PunchSet,
	type ScheduleSnapshot,
} from "#/lib/payroll/types.ts";
import {
	applyScheduleInput,
	clearDayInput,
	type DayInput,
	dayInputSchema,
	getDtrMonthInput,
	upsertDtrDaysInput,
} from "#/schemas/dtr.ts";
import { protectedFn } from "./fn.ts";

export interface DtrDayView {
	date: string;
	weekday: number;
	dayKind: DayKind;
	status: AttendanceStatus;
	isRestDay: boolean;
	punches: PunchSet;
	minutes: DailyMinutes;
	remarks: string | null;
	approvedOvertimeMinutes: number | null;
	schedule: ScheduleSnapshot | null;
	holiday: { name: string; kind: HolidayRow["kind"] } | null;
	leave: { code: string; name: string; portion: string } | null;
	/** False for days the user has not entered — the grid still renders them. */
	hasRecord: boolean;
	locked: boolean;
}

export type { DtrTotals };

export interface DtrMonthBundle {
	month: string;
	today: string;
	days: DtrDayView[];
	totals: DtrTotals;
	cutoffs: Array<{ half: 1 | 2; start: string; end: string; dayCount: number }>;
	/** True once employment terms carry a real monthly rate. */
	isConfigured: boolean;
	/**
	 * Shipped to the client so an optimistic edit can recompute totals with the
	 * exact same pure function the server used. Anything less and the totals bar
	 * disagrees with the server on every keystroke.
	 */
	policy: PunchPolicy;
}

/**
 * Everything needed to compute a month, loaded once.
 *
 * Effective-dated rows are resolved per date in memory rather than with a query
 * per day, so a month costs a handful of round trips regardless of its length.
 */
async function loadMonthContext(userId: string, from: IsoDate, to: IsoDate) {
	const [terms, schedules, holidays, records, leaveDays] = await Promise.all([
		findEmploymentTerms(userId),
		findSchedules(userId),
		findHolidays(userId, from, to),
		findRecordsInRange(userId, from, to),
		findLeaveDaysInRange(userId, from, to),
	]);

	const holidayByDate = new Map<string, HolidayRow>();
	for (const holiday of holidays) {
		// A user's own entry wins over the seeded global one for the same date.
		const existing = holidayByDate.get(holiday.holidayDate);
		if (!existing || (existing.userId === null && holiday.userId !== null)) {
			holidayByDate.set(holiday.holidayDate, holiday);
		}
	}

	return {
		terms,
		schedules,
		holidayByDate,
		recordByDate: new Map(records.map((r) => [r.workDate, r])),
		leaveByDate: new Map(leaveDays.map((l) => [l.leaveDate, l])),
	};
}

type MonthContext = Awaited<ReturnType<typeof loadMonthContext>>;

function scheduleFor(
	context: MonthContext,
	date: IsoDate,
): ScheduleSnapshot | null {
	const schedule = resolveEffective(context.schedules, date);
	if (!schedule) return null;
	const weekday = dayOfWeek(date);
	return toScheduleSnapshot(
		schedule,
		schedule.days.find((d) => d.weekday === weekday),
	);
}

function leaveContextFrom(row: LeaveDayRow | undefined): LeaveContext | null {
	if (!row) return null;
	return {
		portion: row.portion,
		minutes: row.minutes,
		startMinute: row.startMinute,
		endMinute: row.endMinute,
		isPaid: row.isPaid,
	};
}

/**
 * Builds the view for one date, computing from whatever exists.
 *
 * Days with no stored record still produce a row: the grid needs the whole month
 * visible to make gaps obvious, which is the point of a month grid over a week
 * view for backfilling.
 */
function buildDay(
	context: MonthContext,
	date: IsoDate,
	today: IsoDate,
): DtrDayView {
	const record = context.recordByDate.get(date);
	const holiday = context.holidayByDate.get(date) ?? null;
	const leaveRow = context.leaveByDate.get(date);
	const schedule = scheduleFor(context, date);
	const terms = resolveEffective(context.terms, date);

	const isRestDay = record?.isRestDay ?? schedule?.isRestDay ?? false;

	const dayKind: DayKind = holiday
		? holidayToDayKind(holiday.kind)
		: isRestDay
			? "rest_day"
			: "regular_workday";

	const status: AttendanceStatus =
		record?.status ??
		(leaveRow ? "on_leave" : isRestDay || holiday ? "no_work" : "present");

	const punches: PunchSet = {
		amIn: record?.amInMinute ?? null,
		amOut: record?.amOutMinute ?? null,
		pmIn: record?.pmInMinute ?? null,
		pmOut: record?.pmOutMinute ?? null,
	};

	const { minutes } = computeDailyMinutes({
		date,
		today,
		punches,
		schedule,
		dayKind,
		status,
		isRestDay,
		leave: leaveContextFrom(leaveRow),
		// Terms always exist after bootstrap; the fallback keeps a half-migrated
		// account rendering rather than throwing on a read-only page.
		policy: terms ? toPunchPolicy(terms) : DEFAULT_PUNCH_POLICY,
		approvedOvertimeMinutes: record?.approvedOvertimeMinutes ?? null,
	});

	return {
		date,
		weekday: dayOfWeek(date),
		dayKind,
		status,
		isRestDay,
		punches,
		minutes,
		remarks: record?.remarks ?? null,
		approvedOvertimeMinutes: record?.approvedOvertimeMinutes ?? null,
		schedule,
		holiday: holiday ? { name: holiday.name, kind: holiday.kind } : null,
		leave: leaveRow
			? { code: leaveRow.code, name: leaveRow.name, portion: leaveRow.portion }
			: null,
		hasRecord: record !== undefined,
		locked: record?.lockedByPayslipId != null,
	};
}

/* -------------------------------------------------------------------------- */
/* Server functions                                                            */
/* -------------------------------------------------------------------------- */

/** One round trip for a whole month: records, schedule, holidays, leave, totals. */
export const getDtrMonth = protectedFn({ method: "GET" })
	.validator(getDtrMonthInput)
	.handler(async ({ data, context }): Promise<DtrMonthBundle> => {
		await ensureUserBootstrap(context.userId);

		const { year, month } = parseMonthKey(data.month);
		const first = cutoffBounds(year, month, 1);
		const second = cutoffBounds(year, month, 2);
		const today = todayInManila();

		const ctx = await loadMonthContext(context.userId, first.start, second.end);
		const days = eachDate(first.start, second.end).map((date) =>
			buildDay(ctx, date, today),
		);

		const activeTerms = resolveEffective(ctx.terms, today);

		return {
			month: data.month,
			today,
			days,
			totals: sumTotals(days),
			cutoffs: [
				{
					half: 1,
					start: first.start,
					end: first.end,
					dayCount: first.dayCount,
				},
				{
					half: 2,
					start: second.start,
					end: second.end,
					dayCount: second.dayCount,
				},
			],
			isConfigured: (activeTerms?.monthlyRateCentavos ?? 0) > 0,
			policy: activeTerms ? toPunchPolicy(activeTerms) : DEFAULT_PUNCH_POLICY,
		};
	});

/**
 * Turns validated day input into a persistable row, running it through the
 * engine so stored derived values always match the punches beside them.
 */
async function toRecordInsert(
	userId: string,
	input: DayInput,
	ctx: MonthContext,
	today: IsoDate,
): Promise<TimeRecordInsert> {
	const date = assertIsoDate(input.workDate);
	const schedule = scheduleFor(ctx, date);
	const terms = resolveEffective(ctx.terms, date);
	const holiday = ctx.holidayByDate.get(date) ?? null;
	const leaveRow = ctx.leaveByDate.get(date);
	const isRestDay = schedule?.isRestDay ?? false;

	const dayKind: DayKind = holiday
		? holidayToDayKind(holiday.kind)
		: isRestDay
			? "rest_day"
			: "regular_workday";

	const { punches, minutes } = computeDailyMinutes({
		date,
		today,
		punches: {
			amIn: input.amIn,
			amOut: input.amOut,
			pmIn: input.pmIn,
			pmOut: input.pmOut,
		},
		schedule,
		dayKind,
		status: input.status,
		isRestDay,
		leave: leaveContextFrom(leaveRow),
		policy: terms ? toPunchPolicy(terms) : DEFAULT_PUNCH_POLICY,
		approvedOvertimeMinutes: input.approvedOvertimeMinutes,
	});

	return {
		userId,
		workDate: date,
		// Normalized punches, so a midnight crossing is stored resolved.
		amInMinute: punches.amIn,
		amOutMinute: punches.amOut,
		pmInMinute: punches.pmIn,
		pmOutMinute: punches.pmOut,
		dayKind,
		status: input.status,
		isRestDay,
		holidayId: holiday?.id ?? null,
		scheduleId: schedule?.scheduleId ?? null,
		scheduleSnapshot: schedule,
		workedMinutes: minutes.workedMinutes,
		creditedRegularMinutes: minutes.creditedRegularMinutes,
		lateMinutes: minutes.lateMinutes,
		undertimeMinutes: minutes.undertimeMinutes,
		overtimeMinutes: minutes.overtimeMinutes,
		approvedOvertimeMinutes: input.approvedOvertimeMinutes,
		nightDiffMinutes: minutes.nightDiffMinutes,
		nightDiffOvertimeMinutes: minutes.nightDiffOvertimeMinutes,
		paidLeaveMinutes: minutes.paidLeaveMinutes,
		unpaidMinutes: minutes.unpaidMinutes,
		flags: minutes.flags,
		remarks: input.remarks,
		computedAt: new Date(),
	};
}

export interface SaveResult {
	saved: string[];
	skippedLocked: string[];
}

async function saveDays(
	userId: string,
	inputs: DayInput[],
): Promise<SaveResult> {
	await ensureUserBootstrap(userId);
	const today = todayInManila();
	const dates = inputs.map((i) => assertIsoDate(i.workDate)).sort();
	const ctx = await loadMonthContext(userId, dates[0], dates[dates.length - 1]);

	const rows: TimeRecordInsert[] = [];
	for (const input of inputs) {
		rows.push(await toRecordInsert(userId, input, ctx, today));
	}

	const { saved, skippedLocked } = await upsertRecords(userId, rows);
	return { saved: saved.map((r: TimeRecordRow) => r.workDate), skippedLocked };
}

/**
 * Recomputes stored rows for specific dates against current context.
 *
 * Called after leave is filed or cancelled, and after a holiday changes: those
 * events alter what a day means without the punches changing, and the stored
 * derived values have to follow. Only dates that already have a record are
 * touched, so this never invents attendance.
 */
export async function recomputeDates(
	userId: string,
	dates: string[],
): Promise<string[]> {
	if (dates.length === 0) return [];
	const sorted = [...dates].sort();
	const today = todayInManila();
	const ctx = await loadMonthContext(
		userId,
		assertIsoDate(sorted[0]),
		assertIsoDate(sorted[sorted.length - 1]),
	);

	const rows: TimeRecordInsert[] = [];
	for (const date of sorted) {
		const existing = ctx.recordByDate.get(date);
		if (!existing) continue;
		const leaveRow = ctx.leaveByDate.get(date);
		rows.push(
			await toRecordInsert(
				userId,
				{
					workDate: date,
					amIn: existing.amInMinute,
					amOut: existing.amOutMinute,
					pmIn: existing.pmInMinute,
					pmOut: existing.pmOutMinute,
					// Leave presence drives the status; removing leave returns the day
					// to a plain workday rather than leaving a stale "on leave" label.
					status: leaveRow
						? leaveRow.portion === "full"
							? "on_leave"
							: "half_day_leave"
						: existing.status === "on_leave" ||
								existing.status === "half_day_leave"
							? "present"
							: existing.status,
					remarks: existing.remarks,
					approvedOvertimeMinutes: existing.approvedOvertimeMinutes,
				},
				ctx,
				today,
			),
		);
	}

	const { saved } = await upsertRecords(userId, rows);
	return saved.map((r: TimeRecordRow) => r.workDate);
}

/**
 * Ensures a record exists for each date so leave is visible in the grid, then
 * recomputes. Used when filing leave over days that were never filled in.
 */
export async function materializeLeaveDates(
	userId: string,
	dates: string[],
): Promise<void> {
	if (dates.length === 0) return;
	const sorted = [...dates].sort();
	const today = todayInManila();
	const ctx = await loadMonthContext(
		userId,
		assertIsoDate(sorted[0]),
		assertIsoDate(sorted[sorted.length - 1]),
	);

	const rows: TimeRecordInsert[] = [];
	for (const date of sorted) {
		const existing = ctx.recordByDate.get(date);
		const leaveRow = ctx.leaveByDate.get(date);
		rows.push(
			await toRecordInsert(
				userId,
				{
					workDate: date,
					amIn: existing?.amInMinute ?? null,
					amOut: existing?.amOutMinute ?? null,
					pmIn: existing?.pmInMinute ?? null,
					pmOut: existing?.pmOutMinute ?? null,
					status: leaveRow
						? leaveRow.portion === "full"
							? "on_leave"
							: "half_day_leave"
						: "present",
					remarks: existing?.remarks ?? null,
					approvedOvertimeMinutes: existing?.approvedOvertimeMinutes ?? null,
				},
				ctx,
				today,
			),
		);
	}

	await upsertRecords(userId, rows);
}

export const upsertDtrDay = protectedFn()
	.validator(dayInputSchema)
	.handler(({ data, context }) => saveDays(context.userId, [data]));

/** Bulk path for fill-down and paste: one request, one transaction. */
export const upsertDtrDays = protectedFn()
	.validator(upsertDtrDaysInput)
	.handler(({ data, context }) => saveDays(context.userId, data.days));

export const clearDtrDay = protectedFn()
	.validator(clearDayInput)
	.handler(async ({ data, context }) => ({
		cleared: await deleteRecord(context.userId, data.workDate),
	}));

/**
 * Writes the default schedule across a month so only exceptions need editing.
 *
 * This is what turns a hundred-odd punch entries into a handful of corrections,
 * and it is the reason the grid shows a whole month at once.
 */
export const applyDefaultSchedule = protectedFn()
	.validator(applyScheduleInput)
	.handler(async ({ data, context }): Promise<SaveResult> => {
		await ensureUserBootstrap(context.userId);
		const { year, month } = parseMonthKey(data.month);
		const today = todayInManila();

		const range =
			data.half === "all"
				? {
						start: cutoffBounds(year, month, 1).start,
						end: cutoffBounds(year, month, 2).end,
					}
				: cutoffBounds(year, month, data.half === "1" ? 1 : 2);

		const ctx = await loadMonthContext(context.userId, range.start, range.end);

		const inputs: DayInput[] = [];
		for (const date of eachDate(range.start, range.end)) {
			const schedule = scheduleFor(ctx, date);
			// Never invent attendance for a rest day, a holiday, a day already
			// filled in, or a day that has not happened yet.
			if (!schedule || schedule.isRestDay) continue;
			if (ctx.holidayByDate.has(date)) continue;
			if (ctx.leaveByDate.has(date)) continue;
			if (date > today) continue;

			const existing = ctx.recordByDate.get(date);
			const hasPunches =
				existing !== undefined &&
				(existing.amInMinute !== null ||
					existing.amOutMinute !== null ||
					existing.pmInMinute !== null ||
					existing.pmOutMinute !== null);
			if (data.onlyBlank && hasPunches) continue;

			inputs.push({
				workDate: date,
				amIn: schedule.amIn,
				amOut: schedule.amOut,
				pmIn: schedule.pmIn,
				pmOut: schedule.pmOut,
				status: "present",
				remarks: existing?.remarks ?? null,
				approvedOvertimeMinutes: existing?.approvedOvertimeMinutes ?? null,
			});
		}

		if (inputs.length === 0) return { saved: [], skippedLocked: [] };
		return saveDays(context.userId, inputs);
	});
