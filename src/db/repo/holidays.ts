import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "#/db/index.ts";
import { holidays } from "#/db/schema/index.ts";

export type HolidayRow = typeof holidays.$inferSelect;
export type HolidayInsert = typeof holidays.$inferInsert;

/** Seeded global holidays plus the user's own, for one year. */
export async function findHolidaysInYear(
	userId: string,
	year: number,
): Promise<HolidayRow[]> {
	return db
		.select()
		.from(holidays)
		.where(
			and(
				or(isNull(holidays.userId), eq(holidays.userId, userId)),
				gte(holidays.holidayDate, `${year}-01-01`),
				lte(holidays.holidayDate, `${year}-12-31`),
			),
		)
		.orderBy(asc(holidays.holidayDate));
}

/** Scoped by owner, so a guessed id simply returns nothing. */
export async function findUserHolidayById(
	userId: string,
	id: number,
): Promise<HolidayRow | null> {
	const rows = await db
		.select()
		.from(holidays)
		.where(and(eq(holidays.userId, userId), eq(holidays.id, id)))
		.limit(1);
	return rows[0] ?? null;
}

export async function createUserHoliday(
	userId: string,
	input: Omit<HolidayInsert, "userId" | "id">,
): Promise<HolidayRow> {
	const [row] = await db
		.insert(holidays)
		.values({ ...input, userId })
		.returning();
	return row;
}

export async function updateUserHoliday(
	userId: string,
	id: number,
	patch: Partial<Omit<HolidayInsert, "userId" | "id">>,
): Promise<boolean> {
	// The userId predicate means a guessed id returns "not found" rather than
	// touching another account's row.
	const updated = await db
		.update(holidays)
		.set(patch)
		.where(and(eq(holidays.userId, userId), eq(holidays.id, id)))
		.returning({ id: holidays.id });
	return updated.length > 0;
}

/** Only the user's own entries can be removed; seeded global rows are read-only. */
export async function deleteUserHoliday(
	userId: string,
	id: number,
): Promise<boolean> {
	const deleted = await db
		.delete(holidays)
		.where(and(eq(holidays.userId, userId), eq(holidays.id, id)))
		.returning({ id: holidays.id });
	return deleted.length > 0;
}
