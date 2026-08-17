/**
 * Implementation for leave.
 *
 * Deliberately separate from `src/server/leave.ts`. Client route files import
 * that module so their server functions can be called, and the TanStack Start
 * plugin replaces a `createServerFn` handler with a client RPC stub — but it
 * cannot strip an ordinary exported function, so any module-level import it
 * needs (the repo layer, and through it drizzle and pg) would ride along into
 * the browser bundle. Keeping the implementation here means the client never
 * reaches it.
 */
import { findHolidaysInYear } from "#/db/repo/holidays.ts";
import {
	addLedgerEntry,
	cancelLeaveRequest,
	createLeaveRequest,
	ensureLeaveTypes,
	findClaimedDates,
	findLeaveTypes,
	findLedger,
	findRequests,
	type LeaveRequestRow,
	type LeaveTypeRow,
} from "#/db/repo/leave.ts";
import {
	ensureUserBootstrap,
	findSchedules,
	toScheduleSnapshot,
} from "#/db/repo/profile.ts";
import { resolveEffective } from "#/lib/payroll/effective.ts";
import {
	expandLeaveRange,
	type LeaveBalance,
	summarizeBalances,
} from "#/lib/payroll/leave.ts";
import {
	assertIsoDate,
	dayOfWeek,
	type IsoDate,
	todayInManila,
} from "#/lib/payroll/time.ts";
import type { ScheduleSnapshot } from "#/lib/payroll/types.ts";
import { materializeLeaveDates, recomputeDates } from "./dtr.ts";

export interface LeaveBalanceView extends LeaveBalance {
	code: string;
	name: string;
	isPaid: boolean;
}

export interface LeaveRequestView {
	id: number;
	leaveTypeId: number;
	code: string;
	name: string;
	startDate: string;
	endDate: string;
	totalMinutes: number;
	status: LeaveRequestRow["status"];
	reason: string | null;
}

export interface LeaveOverview {
	year: number;
	types: Array<{ id: number; code: string; name: string; isPaid: boolean }>;
	balances: LeaveBalanceView[];
	requests: LeaveRequestView[];
	standardWorkMinutes: number;
}

/** Builds a date -> schedule lookup for a year, resolved once. */
export async function scheduleLookup(userId: string) {
	const schedules = await findSchedules(userId);
	return (date: IsoDate): ScheduleSnapshot | null => {
		const schedule = resolveEffective(schedules, date);
		if (!schedule) return null;
		const weekday = dayOfWeek(date);
		return toScheduleSnapshot(
			schedule,
			schedule.days.find((day) => day.weekday === weekday),
		);
	};
}

function typeIndex(types: LeaveTypeRow[]) {
	return new Map(types.map((type) => [type.id, type]));
}

export interface FileLeaveResult {
	requestId: number | null;
	daysCharged: number;
	minutesCharged: number;
	skipped: Array<{ date: string; reason: string }>;
	error: string | null;
}

export interface FileLeaveArgs {
	leaveTypeId: number;
	startDate: string;
	endDate: string;
	halfDayStart: boolean;
	halfDayEnd: boolean;
	reason: string | null;
}

/**
 * Files leave across a date range.
 *
 * Rest days and holidays inside the range are skipped rather than charged, and
 * the affected DTR rows are written so the leave shows up in the month grid.
 *
 * Kept as a plain function so `npm run verify:leave` exercises this exact code
 * path against a real database rather than a copy of it that could drift; the
 * server function below is a thin wrapper.
 */
export async function fileLeaveFor(
	userId: string,
	data: FileLeaveArgs,
): Promise<FileLeaveResult> {
	await ensureUserBootstrap(userId);
	await ensureLeaveTypes(userId);

	const types = await findLeaveTypes(userId);
	const type = types.find((t) => t.id === data.leaveTypeId);
	if (!type) {
		return {
			requestId: null,
			daysCharged: 0,
			minutesCharged: 0,
			skipped: [],
			error: "That leave type does not exist.",
		};
	}

	const startYear = Number(data.startDate.slice(0, 4));
	const [scheduleFor, holidays, claimed] = await Promise.all([
		scheduleLookup(userId),
		findHolidaysInYear(userId, startYear),
		findClaimedDates(userId, data.startDate, data.endDate),
	]);

	const holidayDates = new Set(holidays.map((h) => h.holidayDate));
	const expansion = expandLeaveRange({
		startDate: assertIsoDate(data.startDate),
		endDate: assertIsoDate(data.endDate),
		halfDayStart: data.halfDayStart,
		halfDayEnd: data.halfDayEnd,
		isPaid: type.isPaid,
		scheduleFor,
		isHoliday: (date) => holidayDates.has(date),
	});

	if (expansion.days.length === 0) {
		return {
			requestId: null,
			daysCharged: 0,
			minutesCharged: 0,
			skipped: expansion.skipped,
			error:
				"That range contains no working days — every day in it is a rest day or a holiday.",
		};
	}

	const overlap = expansion.days.filter((day) =>
		claimed.includes(day.leaveDate),
	);
	if (overlap.length > 0) {
		return {
			requestId: null,
			daysCharged: 0,
			minutesCharged: 0,
			skipped: expansion.skipped,
			error: `Leave is already filed for ${overlap[0].leaveDate}.`,
		};
	}

	const request = await createLeaveRequest(userId, {
		leaveTypeId: data.leaveTypeId,
		startDate: data.startDate,
		endDate: data.endDate,
		reason: data.reason,
		days: expansion.days,
		totalMinutes: expansion.totalMinutes,
		creditYear: startYear,
	});

	// Write DTR rows so the leave is visible in the month grid.
	await materializeLeaveDates(
		userId,
		expansion.days.map((day) => day.leaveDate),
	);

	return {
		requestId: request.id,
		daysCharged: expansion.days.length,
		minutesCharged: expansion.totalMinutes,
		skipped: expansion.skipped,
		error: null,
	};
}

/** Cancelling returns the credit and puts those DTR days back to plain workdays. */
export async function cancelLeaveFor(userId: string, requestId: number) {
	const result = await cancelLeaveRequest(userId, requestId);
	if (result.cancelled) {
		await recomputeDates(userId, result.dates);
	}
	return result;
}

/** Types, balances and filed leave for one credit year. */
export async function buildLeaveOverview(
	userId: string,
	year: number,
): Promise<LeaveOverview> {
	await ensureUserBootstrap(userId);
	await ensureLeaveTypes(userId);

	const [types, ledger, requests, scheduleFor] = await Promise.all([
		findLeaveTypes(userId),
		findLedger(userId),
		findRequests(userId),
		scheduleLookup(userId),
	]);

	const byId = typeIndex(types);

	const balances: LeaveBalanceView[] = summarizeBalances(
		ledger.filter((entry) => entry.creditYear === year),
	).flatMap((balance) => {
		const type = byId.get(balance.leaveTypeId);
		return type
			? [{ ...balance, code: type.code, name: type.name, isPaid: type.isPaid }]
			: [];
	});

	// Show every type, including those with no ledger activity yet.
	for (const type of types) {
		if (!balances.some((b) => b.leaveTypeId === type.id)) {
			balances.push({
				leaveTypeId: type.id,
				creditYear: year,
				earnedMinutes: 0,
				usedMinutes: 0,
				balanceMinutes: 0,
				code: type.code,
				name: type.name,
				isPaid: type.isPaid,
			});
		}
	}
	balances.sort((a, b) => a.code.localeCompare(b.code));

	const schedule = scheduleFor(assertIsoDate(todayInManila()));

	return {
		year,
		types: types.map((type) => ({
			id: type.id,
			code: type.code,
			name: type.name,
			isPaid: type.isPaid,
		})),
		balances,
		requests: requests.flatMap((request) => {
			const type = byId.get(request.leaveTypeId);
			return type
				? [
						{
							id: request.id,
							leaveTypeId: request.leaveTypeId,
							code: type.code,
							name: type.name,
							startDate: request.startDate,
							endDate: request.endDate,
							totalMinutes: request.totalMinutes,
							status: request.status,
							reason: request.reason,
						},
					]
				: [];
		}),
		standardWorkMinutes: schedule?.standardWorkMinutes ?? 480,
	};
}

/**
 * Adds or removes leave credits.
 *
 * Entitlements come from contract and employer policy, so the app never invents
 * them — this is how an opening balance gets set.
 */
export async function grantCreditsFor(
	userId: string,
	args: {
		leaveTypeId: number;
		creditYear: number;
		days: number;
		note: string | null;
	},
) {
	await ensureLeaveTypes(userId);
	const scheduleFor = await scheduleLookup(userId);
	const today = todayInManila();
	const standard =
		scheduleFor(assertIsoDate(today))?.standardWorkMinutes ?? 480;

	await addLedgerEntry(userId, {
		leaveTypeId: args.leaveTypeId,
		entryDate: today,
		creditYear: args.creditYear,
		deltaMinutes: Math.round(args.days * standard),
		source: args.days >= 0 ? "opening" : "adjustment",
		note: args.note,
	});

	return { ok: true };
}
