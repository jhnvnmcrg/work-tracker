import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "#/db/index.ts";
import {
	employmentTerms,
	holidays,
	userProfiles,
	workScheduleDays,
	workSchedules,
} from "#/db/schema/index.ts";
import type { PunchPolicy, ScheduleSnapshot } from "#/lib/payroll/types.ts";

/**
 * Every function here takes `userId` as the first positional argument and every
 * `where` clause starts with it. That makes an unscoped query awkward to write
 * by accident rather than merely discouraged.
 */

export type EmploymentTermsRow = typeof employmentTerms.$inferSelect;
export type WorkScheduleRow = typeof workSchedules.$inferSelect;
export type WorkScheduleDayRow = typeof workScheduleDays.$inferSelect;
export type HolidayRow = typeof holidays.$inferSelect;

export async function findProfile(userId: string) {
	const rows = await db
		.select()
		.from(userProfiles)
		.where(eq(userProfiles.userId, userId))
		.limit(1);
	return rows[0] ?? null;
}

export async function findEmploymentTerms(
	userId: string,
): Promise<EmploymentTermsRow[]> {
	return db
		.select()
		.from(employmentTerms)
		.where(eq(employmentTerms.userId, userId));
}

export async function findSchedules(
	userId: string,
): Promise<Array<WorkScheduleRow & { days: WorkScheduleDayRow[] }>> {
	const schedules = await db
		.select()
		.from(workSchedules)
		.where(eq(workSchedules.userId, userId));
	if (schedules.length === 0) return [];

	const days = await db
		.select()
		.from(workScheduleDays)
		.where(eq(workScheduleDays.userId, userId));

	return schedules.map((schedule) => ({
		...schedule,
		days: days.filter((d) => d.scheduleId === schedule.id),
	}));
}

/** Global holidays plus this user's own, for a date range. */
export async function findHolidays(
	userId: string,
	from: string,
	to: string,
): Promise<HolidayRow[]> {
	const rows = await db
		.select()
		.from(holidays)
		.where(or(isNull(holidays.userId), eq(holidays.userId, userId)));
	return rows.filter((h) => h.holidayDate >= from && h.holidayDate <= to);
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                   */
/* -------------------------------------------------------------------------- */

/** Monday–Friday, 08:00–12:00 and 13:00–17:00, with Saturday and Sunday off. */
const DEFAULT_SCHEDULE_DAYS = [
	{ weekday: 0, isRestDay: true },
	{ weekday: 1, isRestDay: false },
	{ weekday: 2, isRestDay: false },
	{ weekday: 3, isRestDay: false },
	{ weekday: 4, isRestDay: false },
	{ weekday: 5, isRestDay: false },
	{ weekday: 6, isRestDay: true },
] as const;

/** The seven weekday rows a schedule must always have, given its rest days. */
function scheduleDayRows(
	userId: string,
	scheduleId: number,
	restDays: ReadonlySet<number>,
) {
	return [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
		const isRestDay = restDays.has(weekday);
		return {
			userId,
			scheduleId,
			weekday,
			isRestDay,
			amInMinute: isRestDay ? null : 480,
			amOutMinute: isRestDay ? null : 720,
			pmInMinute: isRestDay ? null : 780,
			pmOutMinute: isRestDay ? null : 1020,
			standardWorkMinutes: isRestDay ? 0 : 480,
			breakMinutes: isRestDay ? 0 : 60,
		};
	});
}

/**
 * Creates the rows a new account needs, idempotently.
 *
 * Called lazily from the first authenticated request rather than a Clerk
 * webhook: a webhook would add an endpoint, a signing secret, tunnel setup in
 * development, and a race where the user reaches the dashboard before it fires.
 */
export async function ensureUserBootstrap(
	userId: string,
	details: { email?: string | null; displayName?: string | null } = {},
	effectiveFrom = "2000-01-01",
): Promise<void> {
	await db.transaction(async (tx) => {
		await tx
			.insert(userProfiles)
			.values({
				userId,
				email: details.email ?? null,
				displayName: details.displayName ?? null,
			})
			.onConflictDoNothing();

		const existingTerms = await tx
			.select({ id: employmentTerms.id })
			.from(employmentTerms)
			.where(eq(employmentTerms.userId, userId))
			.limit(1);

		if (existingTerms.length === 0) {
			// Rate 0 until the user completes setup. The payroll engine refuses to
			// finalize against a zero rate, so this cannot quietly produce a payslip.
			await tx.insert(employmentTerms).values({
				userId,
				effectiveFrom,
				monthlyRateCentavos: 0,
			});
		}

		const existingSchedule = await tx
			.select({ id: workSchedules.id })
			.from(workSchedules)
			.where(eq(workSchedules.userId, userId))
			.limit(1);

		const defaultRestDays = new Set(
			DEFAULT_SCHEDULE_DAYS.filter((day) => day.isRestDay).map(
				(day) => day.weekday,
			),
		);

		if (existingSchedule.length === 0) {
			const [schedule] = await tx
				.insert(workSchedules)
				.values({ userId, name: "Default", effectiveFrom })
				.returning({ id: workSchedules.id });
			await tx
				.insert(workScheduleDays)
				.values(scheduleDayRows(userId, schedule.id, defaultRestDays));
		} else {
			// A schedule can exist with no weekday rows — an interrupted setup, or a
			// cascade that took the children with it. Left alone the account is
			// stuck: every day looks like a working day, so the factor warning fires
			// and rest days cannot be saved. Heal it rather than skipping.
			const hasDays = await tx
				.select({ id: workScheduleDays.id })
				.from(workScheduleDays)
				.where(
					and(
						eq(workScheduleDays.userId, userId),
						eq(workScheduleDays.scheduleId, existingSchedule[0].id),
					),
				)
				.limit(1);

			if (hasDays.length === 0) {
				await tx
					.insert(workScheduleDays)
					.values(
						scheduleDayRows(userId, existingSchedule[0].id, defaultRestDays),
					);
			}
		}
	});
}

/**
 * Rewrites which weekdays are rest days on a schedule.
 *
 * Lives here rather than inline in a server module: anything under
 * `src/server/` is imported by client route files so its server-function
 * definitions can be called, and a direct `#/db` import there drags drizzle and
 * the whole schema into the browser bundle.
 */
export async function updateScheduleRestDays(
	userId: string,
	scheduleId: number,
	restDays: readonly number[],
): Promise<void> {
	// Delete-then-insert, not update. An update-only version silently did nothing
	// when the weekday rows were missing: ticking a rest day looked saved, the
	// schedule stayed at seven working days, and the factor warning never cleared.
	// Replacing the set makes what is stored a function of the input alone.
	//
	// Past records are unaffected: each daily_time_records row carries its own
	// frozen scheduleSnapshot.
	await db.transaction(async (tx) => {
		await tx
			.delete(workScheduleDays)
			.where(
				and(
					eq(workScheduleDays.userId, userId),
					eq(workScheduleDays.scheduleId, scheduleId),
				),
			);
		await tx
			.insert(workScheduleDays)
			.values(scheduleDayRows(userId, scheduleId, new Set(restDays)));
	});
}

/* -------------------------------------------------------------------------- */
/* Mapping to engine types                                                     */
/* -------------------------------------------------------------------------- */

export function toScheduleSnapshot(
	schedule: WorkScheduleRow,
	day: WorkScheduleDayRow | undefined,
): ScheduleSnapshot | null {
	if (!day) return null;
	return {
		scheduleId: schedule.id,
		amIn: day.amInMinute,
		amOut: day.amOutMinute,
		pmIn: day.pmInMinute,
		pmOut: day.pmOutMinute,
		standardWorkMinutes: day.standardWorkMinutes,
		breakMinutes: day.breakMinutes,
		isRestDay: day.isRestDay,
	};
}

export function toPunchPolicy(terms: EmploymentTermsRow): PunchPolicy {
	return {
		graceMinutes: terms.graceMinutes,
		graceForfeits: terms.graceForfeits,
		allowTwoPunchDay: terms.allowTwoPunchDay,
		punchRoundingMinutes: terms.punchRoundingMinutes,
		punchRoundingMode: terms.punchRoundingMode,
		missingPunchPolicy: terms.missingPunchPolicy,
		minOvertimeMinutes: terms.minOvertimeMinutes,
		overtimeRequiresApproval: terms.overtimeRequiresApproval,
		countPreShiftOvertime: terms.countPreShiftOvertime,
		nightDiffEnabled: terms.nightDiffEnabled,
		nightDiffStartMinute: terms.nightDiffStartMinute,
		nightDiffEndMinute: terms.nightDiffEndMinute,
		premiumsEnabled: terms.premiumsEnabled,
	};
}

/** Holiday kind mapped onto the engine's day classification. */
export function holidayToDayKind(kind: HolidayRow["kind"]) {
	switch (kind) {
		case "regular":
			return "regular_holiday" as const;
		case "special_non_working":
			return "special_non_working" as const;
		case "special_working":
			return "special_working" as const;
	}
}

export { and, eq };
