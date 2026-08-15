import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
	dailyTimeRecords,
	employmentTerms,
	payPeriods,
	payslipLineItems,
	payslips,
	recurringAdjustments,
	statutoryBrackets,
	statutorySchedules,
} from "#/db/schema/index.ts";
import type {
	StatutoryBracketData,
	StatutoryKind,
	StatutoryScheduleData,
} from "#/lib/payroll/statutory.ts";

export type PayPeriodRow = typeof payPeriods.$inferSelect;
export type PayslipRow = typeof payslips.$inferSelect;
export type PayslipLineRow = typeof payslipLineItems.$inferSelect;
export type AdjustmentRow = typeof recurringAdjustments.$inferSelect;
export type StatutoryScheduleRow = typeof statutorySchedules.$inferSelect;
export type StatutoryBracketRow = typeof statutoryBrackets.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Statutory tables                                                            */
/* -------------------------------------------------------------------------- */

/** Seeded global schedules plus the user's own, each with its brackets. */
export async function findStatutorySchedules(
	userId: string,
): Promise<StatutoryScheduleData[]> {
	const schedules = await db
		.select()
		.from(statutorySchedules)
		.where(
			or(
				isNull(statutorySchedules.userId),
				eq(statutorySchedules.userId, userId),
			),
		)
		.orderBy(statutorySchedules.kind, desc(statutorySchedules.effectiveFrom));

	if (schedules.length === 0) return [];

	const brackets = await db
		.select()
		.from(statutoryBrackets)
		.where(
			inArray(
				statutoryBrackets.scheduleId,
				schedules.map((s) => s.id),
			),
		);

	return schedules.map((schedule) => ({
		id: schedule.id,
		userId: schedule.userId,
		kind: schedule.kind,
		name: schedule.name,
		effectiveFrom: schedule.effectiveFrom,
		effectiveTo: schedule.effectiveTo,
		ratePpm: schedule.ratePpm,
		employeeSharePpm: schedule.employeeSharePpm,
		floorCentavos: schedule.floorCentavos,
		ceilingCentavos: schedule.ceilingCentavos,
		sourceCitation: schedule.sourceCitation,
		verifiedAt: schedule.verifiedAt,
		brackets: brackets
			.filter((bracket) => bracket.scheduleId === schedule.id)
			.map(toBracketData),
	}));
}

function toBracketData(row: StatutoryBracketRow): StatutoryBracketData {
	return {
		id: row.id,
		periodType: row.periodType,
		rangeFromCentavos: row.rangeFromCentavos,
		rangeToCentavos: row.rangeToCentavos,
		salaryCreditCentavos: row.salaryCreditCentavos,
		employeeAmountCentavos: row.employeeAmountCentavos,
		employerAmountCentavos: row.employerAmountCentavos,
		employerEcAmountCentavos: row.employerEcAmountCentavos,
		employeeMpfCentavos: row.employeeMpfCentavos,
		employerMpfCentavos: row.employerMpfCentavos,
		employeeRatePpm: row.employeeRatePpm,
		employerRatePpm: row.employerRatePpm,
		capCentavos: row.capCentavos,
		baseAmountCentavos: row.baseAmountCentavos,
		excessRatePpm: row.excessRatePpm,
	};
}

export interface SaveScheduleInput {
	id?: number;
	kind: StatutoryKind;
	name: string;
	effectiveFrom: string;
	effectiveTo: string | null;
	ratePpm: number | null;
	employeeSharePpm: number | null;
	floorCentavos: number | null;
	ceilingCentavos: number | null;
	sourceCitation: string | null;
	verifiedAt: string | null;
	brackets: Array<Omit<StatutoryBracketData, "id">>;
}

/**
 * Writes a schedule and replaces its brackets wholesale.
 *
 * Brackets are replaced rather than merged because a published table is a single
 * document — editing one row of an old table and leaving the rest would produce
 * a schedule that never existed.
 */
export async function saveStatutorySchedule(
	userId: string,
	input: SaveScheduleInput,
): Promise<number> {
	return db.transaction(async (tx) => {
		let scheduleId = input.id ?? null;

		const values = {
			userId,
			kind: input.kind,
			name: input.name,
			effectiveFrom: input.effectiveFrom,
			effectiveTo: input.effectiveTo,
			ratePpm: input.ratePpm,
			employeeSharePpm: input.employeeSharePpm,
			floorCentavos: input.floorCentavos,
			ceilingCentavos: input.ceilingCentavos,
			sourceCitation: input.sourceCitation,
			verifiedAt: input.verifiedAt,
		};

		if (scheduleId === null) {
			const [created] = await tx
				.insert(statutorySchedules)
				.values(values)
				.returning({ id: statutorySchedules.id });
			scheduleId = created.id;
		} else {
			// Scoped by owner, so a guessed id cannot touch a global or foreign row.
			const updated = await tx
				.update(statutorySchedules)
				.set(values)
				.where(
					and(
						eq(statutorySchedules.userId, userId),
						eq(statutorySchedules.id, scheduleId),
					),
				)
				.returning({ id: statutorySchedules.id });
			if (updated.length === 0) throw new Error("Schedule not found");

			await tx
				.delete(statutoryBrackets)
				.where(eq(statutoryBrackets.scheduleId, scheduleId));
		}

		if (input.brackets.length > 0) {
			await tx.insert(statutoryBrackets).values(
				input.brackets.map((bracket, index) => ({
					scheduleId: scheduleId as number,
					...bracket,
					sortOrder: index,
				})),
			);
		}

		return scheduleId;
	});
}

export async function deleteStatutorySchedule(
	userId: string,
	id: number,
): Promise<boolean> {
	const deleted = await db
		.delete(statutorySchedules)
		.where(
			and(eq(statutorySchedules.userId, userId), eq(statutorySchedules.id, id)),
		)
		.returning({ id: statutorySchedules.id });
	return deleted.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Pay periods and payslips                                                    */
/* -------------------------------------------------------------------------- */

export async function ensurePayPeriod(
	userId: string,
	period: {
		year: number;
		month: number;
		half: "first" | "second";
		startDate: string;
		endDate: string;
		payDate: string;
		dayCount: number;
	},
): Promise<PayPeriodRow> {
	const existing = await db
		.select()
		.from(payPeriods)
		.where(
			and(
				eq(payPeriods.userId, userId),
				eq(payPeriods.year, period.year),
				eq(payPeriods.month, period.month),
				eq(payPeriods.half, period.half),
			),
		)
		.limit(1);
	if (existing[0]) return existing[0];

	const [created] = await db
		.insert(payPeriods)
		.values({ userId, ...period })
		.returning();
	return created;
}

export async function findPayslipByPeriod(
	userId: string,
	payPeriodId: number,
): Promise<{ payslip: PayslipRow; lines: PayslipLineRow[] } | null> {
	const rows = await db
		.select()
		.from(payslips)
		.where(
			and(
				eq(payslips.userId, userId),
				eq(payslips.payPeriodId, payPeriodId),
				eq(payslips.type, "regular"),
			),
		)
		.limit(1);

	const payslip = rows.find((row) => row.status !== "voided");
	if (!payslip) return null;

	const lines = await db
		.select()
		.from(payslipLineItems)
		.where(
			and(
				eq(payslipLineItems.userId, userId),
				eq(payslipLineItems.payslipId, payslip.id),
			),
		)
		.orderBy(payslipLineItems.sortOrder);

	return { payslip, lines };
}

export async function listPayslips(
	userId: string,
	limit = 24,
): Promise<Array<PayslipRow & { period: PayPeriodRow }>> {
	const rows = await db
		.select({ payslip: payslips, period: payPeriods })
		.from(payslips)
		.innerJoin(payPeriods, eq(payslips.payPeriodId, payPeriods.id))
		.where(and(eq(payslips.userId, userId), eq(payslips.status, "finalized")))
		.orderBy(desc(payPeriods.startDate))
		.limit(limit);
	return rows.map((row) => ({ ...row.payslip, period: row.period }));
}

export interface PersistPayslipInput {
	payPeriodId: number;
	header: Omit<typeof payslips.$inferInsert, "userId" | "payPeriodId">;
	lines: Array<
		Omit<typeof payslipLineItems.$inferInsert, "userId" | "payslipId">
	>;
	/** DTR dates to lock against further edits. */
	lockDates: string[];
}

/**
 * Writes a finalized payslip and locks the days behind it.
 *
 * Locking is what makes the payslip a record rather than a view: editing a day
 * afterwards would silently change what was already paid, so those rows require
 * an explicit void first.
 */
export async function persistFinalizedPayslip(
	userId: string,
	input: PersistPayslipInput,
): Promise<PayslipRow> {
	return db.transaction(async (tx) => {
		// Void any previous live payslip for the period so the partial unique
		// index stays satisfied.
		await tx
			.update(payslips)
			.set({ status: "voided", voidedAt: new Date(), voidReason: "Superseded" })
			.where(
				and(
					eq(payslips.userId, userId),
					eq(payslips.payPeriodId, input.payPeriodId),
					eq(payslips.status, "finalized"),
				),
			);

		const [payslip] = await tx
			.insert(payslips)
			.values({ userId, payPeriodId: input.payPeriodId, ...input.header })
			.returning();

		if (input.lines.length > 0) {
			await tx.insert(payslipLineItems).values(
				input.lines.map((line) => ({
					userId,
					payslipId: payslip.id,
					...line,
				})),
			);
		}

		if (input.lockDates.length > 0) {
			await tx
				.update(dailyTimeRecords)
				.set({ lockedByPayslipId: payslip.id })
				.where(
					and(
						eq(dailyTimeRecords.userId, userId),
						inArray(dailyTimeRecords.workDate, input.lockDates),
					),
				);
		}

		await tx
			.update(payPeriods)
			.set({ status: "locked", lockedAt: new Date() })
			.where(
				and(
					eq(payPeriods.userId, userId),
					eq(payPeriods.id, input.payPeriodId),
				),
			);

		return payslip;
	});
}

/** Voids a payslip and releases the days it locked. */
export async function voidPayslip(
	userId: string,
	payslipId: number,
	reason: string,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const voided = await tx
			.update(payslips)
			.set({ status: "voided", voidedAt: new Date(), voidReason: reason })
			.where(
				and(
					eq(payslips.userId, userId),
					eq(payslips.id, payslipId),
					eq(payslips.status, "finalized"),
				),
			)
			.returning({ id: payslips.id, payPeriodId: payslips.payPeriodId });

		if (voided.length === 0) return false;

		await tx
			.update(dailyTimeRecords)
			.set({ lockedByPayslipId: null })
			.where(
				and(
					eq(dailyTimeRecords.userId, userId),
					eq(dailyTimeRecords.lockedByPayslipId, payslipId),
				),
			);

		await tx
			.update(payPeriods)
			.set({ status: "open", lockedAt: null })
			.where(
				and(
					eq(payPeriods.userId, userId),
					eq(payPeriods.id, voided[0].payPeriodId),
				),
			);

		return true;
	});
}

/* -------------------------------------------------------------------------- */

export async function findActiveAdjustments(
	userId: string,
	onDate: string,
): Promise<AdjustmentRow[]> {
	const rows = await db
		.select()
		.from(recurringAdjustments)
		.where(
			and(
				eq(recurringAdjustments.userId, userId),
				eq(recurringAdjustments.isActive, true),
			),
		);
	return rows.filter(
		(row) =>
			row.effectiveFrom <= onDate &&
			(row.effectiveTo === null || row.effectiveTo >= onDate),
	);
}

export async function updateEmploymentTerms(
	userId: string,
	id: number,
	patch: Partial<typeof employmentTerms.$inferInsert>,
): Promise<boolean> {
	const updated = await db
		.update(employmentTerms)
		.set(patch)
		.where(and(eq(employmentTerms.userId, userId), eq(employmentTerms.id, id)))
		.returning({ id: employmentTerms.id });
	return updated.length > 0;
}
