import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
	leaveLedger,
	leaveRequestDays,
	leaveRequests,
	leaveTypes,
} from "#/db/schema/index.ts";
import type { ExpandedLeaveDay } from "#/lib/payroll/leave.ts";

export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type LeaveRequestRow = typeof leaveRequests.$inferSelect;
export type LeaveLedgerRow = typeof leaveLedger.$inferSelect;

/**
 * The leave types every account starts with.
 *
 * Credits are deliberately zero. Entitlements are set by contract and by
 * employer policy, so the app asks rather than inventing a number that would
 * look authoritative and be wrong.
 */
export const DEFAULT_LEAVE_TYPES = [
	{ code: "VL", name: "Vacation leave", isPaid: true, sortOrder: 1 },
	{ code: "SL", name: "Sick leave", isPaid: true, sortOrder: 2 },
	{ code: "SIL", name: "Service incentive leave", isPaid: true, sortOrder: 3 },
	{ code: "EL", name: "Emergency leave", isPaid: true, sortOrder: 4 },
	{ code: "BL", name: "Bereavement leave", isPaid: true, sortOrder: 5 },
	{ code: "LWOP", name: "Leave without pay", isPaid: false, sortOrder: 6 },
] as const;

export async function findLeaveTypes(userId: string): Promise<LeaveTypeRow[]> {
	return db
		.select()
		.from(leaveTypes)
		.where(eq(leaveTypes.userId, userId))
		.orderBy(leaveTypes.sortOrder);
}

/** Creates the starting leave types for an account. Safe to call repeatedly. */
export async function ensureLeaveTypes(userId: string): Promise<void> {
	const existing = await db
		.select({ id: leaveTypes.id })
		.from(leaveTypes)
		.where(eq(leaveTypes.userId, userId))
		.limit(1);
	if (existing.length > 0) return;

	await db.insert(leaveTypes).values(
		DEFAULT_LEAVE_TYPES.map((type) => ({
			userId,
			code: type.code,
			name: type.name,
			isPaid: type.isPaid,
			sortOrder: type.sortOrder,
		})),
	);
}

export async function findLedger(userId: string): Promise<LeaveLedgerRow[]> {
	return db
		.select()
		.from(leaveLedger)
		.where(eq(leaveLedger.userId, userId))
		.orderBy(desc(leaveLedger.entryDate));
}

export async function findRequests(
	userId: string,
	limit = 50,
): Promise<LeaveRequestRow[]> {
	return db
		.select()
		.from(leaveRequests)
		.where(eq(leaveRequests.userId, userId))
		.orderBy(desc(leaveRequests.startDate))
		.limit(limit);
}

export async function findRequestDates(
	userId: string,
	requestId: number,
): Promise<string[]> {
	const rows = await db
		.select({ leaveDate: leaveRequestDays.leaveDate })
		.from(leaveRequestDays)
		.where(
			and(
				eq(leaveRequestDays.userId, userId),
				eq(leaveRequestDays.requestId, requestId),
			),
		);
	return rows.map((r) => r.leaveDate);
}

/** Dates in a range already claimed by a live request, to reject overlaps. */
export async function findClaimedDates(
	userId: string,
	from: string,
	to: string,
): Promise<string[]> {
	const rows = await db
		.select({ leaveDate: leaveRequestDays.leaveDate })
		.from(leaveRequestDays)
		.innerJoin(leaveRequests, eq(leaveRequestDays.requestId, leaveRequests.id))
		.where(
			and(
				eq(leaveRequestDays.userId, userId),
				gte(leaveRequestDays.leaveDate, from),
				lte(leaveRequestDays.leaveDate, to),
				inArray(leaveRequests.status, ["draft", "submitted", "approved"]),
			),
		);
	return rows.map((r) => r.leaveDate);
}

export interface CreateLeaveRequestInput {
	leaveTypeId: number;
	startDate: string;
	endDate: string;
	reason: string | null;
	days: ExpandedLeaveDay[];
	totalMinutes: number;
	creditYear: number;
}

/**
 * Writes the request, its days, and the ledger debit in one transaction.
 *
 * The ledger entry is what makes the balance move; there is no cached balance
 * column to keep in step. A partial unique index guarantees at most one `usage`
 * entry per request, so a retry cannot double-debit.
 */
export async function createLeaveRequest(
	userId: string,
	input: CreateLeaveRequestInput,
): Promise<LeaveRequestRow> {
	return db.transaction(async (tx) => {
		const [request] = await tx
			.insert(leaveRequests)
			.values({
				userId,
				leaveTypeId: input.leaveTypeId,
				startDate: input.startDate,
				endDate: input.endDate,
				totalMinutes: input.totalMinutes,
				status: "approved",
				reason: input.reason,
				filedAt: new Date(),
				decidedAt: new Date(),
			})
			.returning();

		await tx.insert(leaveRequestDays).values(
			input.days.map((day) => ({
				userId,
				requestId: request.id,
				leaveDate: day.leaveDate,
				portion: day.portion,
				minutes: day.minutes,
				startMinute: day.startMinute,
				endMinute: day.endMinute,
				isPaid: day.isPaid,
			})),
		);

		await tx.insert(leaveLedger).values({
			userId,
			leaveTypeId: input.leaveTypeId,
			entryDate: input.startDate,
			creditYear: input.creditYear,
			deltaMinutes: -input.totalMinutes,
			source: "usage",
			sourceRequestId: request.id,
		});

		return request;
	});
}

/**
 * Cancels a request and returns the ledger debit.
 *
 * The debit row is deleted rather than offset with a credit: an offsetting pair
 * would leave the "used" figure overstated for the year.
 */
export async function cancelLeaveRequest(
	userId: string,
	requestId: number,
): Promise<{ cancelled: boolean; dates: string[] }> {
	return db.transaction(async (tx) => {
		const [request] = await tx
			.select()
			.from(leaveRequests)
			.where(
				and(eq(leaveRequests.userId, userId), eq(leaveRequests.id, requestId)),
			)
			.limit(1);

		if (!request || request.status === "cancelled") {
			return { cancelled: false, dates: [] };
		}

		const dayRows = await tx
			.select({ leaveDate: leaveRequestDays.leaveDate })
			.from(leaveRequestDays)
			.where(
				and(
					eq(leaveRequestDays.userId, userId),
					eq(leaveRequestDays.requestId, requestId),
				),
			);

		await tx
			.delete(leaveLedger)
			.where(
				and(
					eq(leaveLedger.userId, userId),
					eq(leaveLedger.sourceRequestId, requestId),
					eq(leaveLedger.source, "usage"),
				),
			);

		await tx
			.delete(leaveRequestDays)
			.where(
				and(
					eq(leaveRequestDays.userId, userId),
					eq(leaveRequestDays.requestId, requestId),
				),
			);

		await tx
			.update(leaveRequests)
			.set({ status: "cancelled", decidedAt: new Date() })
			.where(
				and(eq(leaveRequests.userId, userId), eq(leaveRequests.id, requestId)),
			);

		return { cancelled: true, dates: dayRows.map((r) => r.leaveDate) };
	});
}

export async function addLedgerEntry(
	userId: string,
	entry: {
		leaveTypeId: number;
		entryDate: string;
		creditYear: number;
		deltaMinutes: number;
		source: "opening" | "accrual" | "adjustment" | "forfeiture" | "conversion";
		note: string | null;
	},
): Promise<void> {
	await db.insert(leaveLedger).values({ userId, ...entry });
}
