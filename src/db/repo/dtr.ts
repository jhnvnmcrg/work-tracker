import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
	dailyTimeRecords,
	leaveRequestDays,
	leaveRequests,
	leaveTypes,
} from "#/db/schema/index.ts";

export type TimeRecordRow = typeof dailyTimeRecords.$inferSelect;
export type TimeRecordInsert = typeof dailyTimeRecords.$inferInsert;

/** Every query starts its `where` with the owner. */
export async function findRecordsInRange(
	userId: string,
	from: string,
	to: string,
): Promise<TimeRecordRow[]> {
	return db
		.select()
		.from(dailyTimeRecords)
		.where(
			and(
				eq(dailyTimeRecords.userId, userId),
				gte(dailyTimeRecords.workDate, from),
				lte(dailyTimeRecords.workDate, to),
			),
		)
		.orderBy(dailyTimeRecords.workDate);
}

export interface LeaveDayRow {
	leaveDate: string;
	portion: "full" | "am" | "pm" | "custom";
	minutes: number;
	startMinute: number | null;
	endMinute: number | null;
	isPaid: boolean;
	code: string;
	name: string;
}

/** Approved or pending leave days overlapping a range, joined to their type. */
export async function findLeaveDaysInRange(
	userId: string,
	from: string,
	to: string,
): Promise<LeaveDayRow[]> {
	return db
		.select({
			leaveDate: leaveRequestDays.leaveDate,
			portion: leaveRequestDays.portion,
			minutes: leaveRequestDays.minutes,
			startMinute: leaveRequestDays.startMinute,
			endMinute: leaveRequestDays.endMinute,
			isPaid: leaveRequestDays.isPaid,
			code: leaveTypes.code,
			name: leaveTypes.name,
		})
		.from(leaveRequestDays)
		.innerJoin(leaveRequests, eq(leaveRequestDays.requestId, leaveRequests.id))
		.innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
		.where(
			and(
				eq(leaveRequestDays.userId, userId),
				gte(leaveRequestDays.leaveDate, from),
				lte(leaveRequestDays.leaveDate, to),
				inArray(leaveRequests.status, ["approved", "submitted"]),
			),
		);
}

/**
 * Replaces a batch of days in one transaction.
 *
 * Implemented as delete-then-insert rather than `ON CONFLICT ... DO UPDATE SET
 * x = excluded.x`. With `casing: "snake_case"`, drizzle applies the column-name
 * transform when it builds the query and the column objects still carry their
 * TypeScript names, so any hand-built `excluded.<name>` clause emits camelCase
 * and fails at runtime with "column excluded.amInMinute does not exist". Two
 * statements inside one transaction avoid depending on that transform at all.
 *
 * `createdAt` is carried across so replacing a row does not reset when it was
 * first recorded. Row ids do change, which is safe because rows locked by a
 * finalized payslip — the only ones a payslip references — are never touched.
 *
 * Locked rows are skipped and reported rather than silently overwritten;
 * changing one requires an explicit, audited unlock.
 */
export async function upsertRecords(
	userId: string,
	rows: TimeRecordInsert[],
): Promise<{ saved: TimeRecordRow[]; skippedLocked: string[] }> {
	if (rows.length === 0) return { saved: [], skippedLocked: [] };

	return db.transaction(async (tx) => {
		const dates = rows.map((r) => r.workDate as string);
		const existing = await tx
			.select({
				workDate: dailyTimeRecords.workDate,
				lockedByPayslipId: dailyTimeRecords.lockedByPayslipId,
				createdAt: dailyTimeRecords.createdAt,
			})
			.from(dailyTimeRecords)
			.where(
				and(
					eq(dailyTimeRecords.userId, userId),
					inArray(dailyTimeRecords.workDate, dates),
				),
			);

		const locked = new Set(
			existing
				.filter((r) => r.lockedByPayslipId !== null)
				.map((r) => r.workDate),
		);
		const createdAtByDate = new Map(
			existing.map((r) => [r.workDate, r.createdAt]),
		);

		const writable = rows.filter((r) => !locked.has(r.workDate as string));
		if (writable.length === 0) {
			return { saved: [], skippedLocked: [...locked] };
		}

		const writableDates = writable.map((r) => r.workDate as string);
		await tx
			.delete(dailyTimeRecords)
			.where(
				and(
					eq(dailyTimeRecords.userId, userId),
					inArray(dailyTimeRecords.workDate, writableDates),
					isNull(dailyTimeRecords.lockedByPayslipId),
				),
			);

		const now = new Date();
		const saved = await tx
			.insert(dailyTimeRecords)
			.values(
				writable.map((r) => ({
					...r,
					userId,
					createdAt: createdAtByDate.get(r.workDate as string) ?? now,
					updatedAt: now,
				})),
			)
			.returning();

		return { saved, skippedLocked: [...locked] };
	});
}

/** Removes a day's record. Locked rows are left alone and reported as false. */
export async function deleteRecord(
	userId: string,
	workDate: string,
): Promise<boolean> {
	const deleted = await db
		.delete(dailyTimeRecords)
		.where(
			and(
				eq(dailyTimeRecords.userId, userId),
				eq(dailyTimeRecords.workDate, workDate),
				isNull(dailyTimeRecords.lockedByPayslipId),
			),
		)
		.returning({ id: dailyTimeRecords.id });
	return deleted.length > 0;
}
