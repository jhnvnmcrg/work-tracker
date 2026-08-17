import { createServerFn } from "@tanstack/react-start";
import {
	createUserHoliday,
	deleteUserHoliday,
	findHolidaysInYear,
	findUserHolidayById,
	type HolidayRow,
	updateUserHoliday,
} from "#/db/repo/holidays.ts";
import { ensureUserBootstrap } from "#/db/repo/profile.ts";
import {
	PROCLAMATION_ONLY_HOLIDAYS,
	phHolidaysForYear,
} from "#/lib/payroll/ph-holidays.ts";
import {
	createHolidayInput,
	deleteHolidayInput,
	holidayYearInput,
	seedHolidaysInput,
	updateHolidayInput,
} from "#/schemas/holidays.ts";
import { authedMiddleware } from "./auth.ts";
import { recomputeDates } from "./core/dtr.ts";

export interface HolidayView {
	id: number;
	holidayDate: string;
	name: string;
	kind: HolidayRow["kind"];
	notes: string | null;
	sourceCitation: string | null;
	/** Seeded rows are read-only; only the user's own entries can be edited. */
	editable: boolean;
}

export interface HolidayYearBundle {
	year: number;
	holidays: HolidayView[];
	/** Holidays this app cannot determine — the user must add them by hand. */
	proclamationOnly: readonly string[];
}

function toView(row: HolidayRow): HolidayView {
	return {
		id: row.id,
		holidayDate: row.holidayDate,
		name: row.name,
		kind: row.kind,
		notes: row.notes,
		sourceCitation: row.proclamationRef,
		editable: row.userId !== null,
	};
}

export const getHolidayYear = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.validator(holidayYearInput)
	.handler(async ({ data, context }): Promise<HolidayYearBundle> => {
		await ensureUserBootstrap(context.userId);
		const rows = await findHolidaysInYear(context.userId, data.year);
		return {
			year: data.year,
			holidays: rows.map(toView),
			proclamationOnly: PROCLAMATION_ONLY_HOLIDAYS,
		};
	});

/**
 * Fills a year with the holidays that are determinate from the calendar.
 *
 * Only statutory fixed dates and rule-derived dates (Holy Week, National Heroes
 * Day) are written. Anything set by annual proclamation is deliberately left
 * out and reported back, because a plausible but wrong holiday silently changes
 * what a day is worth.
 */
export const seedHolidayYear = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(seedHolidaysInput)
	.handler(async ({ data, context }) => {
		await ensureUserBootstrap(context.userId);

		const existing = await findHolidaysInYear(context.userId, data.year);
		const seen = new Set(
			existing.map((row) => `${row.holidayDate}|${row.name}`),
		);

		const generated = phHolidaysForYear(data.year);
		const toCreate = generated.filter(
			(holiday) => !seen.has(`${holiday.holidayDate}|${holiday.name}`),
		);

		for (const holiday of toCreate) {
			await createUserHoliday(context.userId, {
				holidayDate: holiday.holidayDate,
				name: holiday.name,
				kind: holiday.kind,
				scope: "national",
				proclamationRef: holiday.citation,
				notes: null,
			});
		}

		// Existing records on those dates are now holidays and must be recomputed.
		await recomputeDates(
			context.userId,
			toCreate.map((h) => h.holidayDate),
		);

		return {
			added: toCreate.length,
			skipped: generated.length - toCreate.length,
			proclamationOnly: PROCLAMATION_ONLY_HOLIDAYS,
		};
	});

export const addHoliday = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(createHolidayInput)
	.handler(async ({ data, context }) => {
		await ensureUserBootstrap(context.userId);
		const row = await createUserHoliday(context.userId, {
			holidayDate: data.holidayDate,
			name: data.name,
			kind: data.kind,
			scope: "national",
			notes: data.notes,
		});
		await recomputeDates(context.userId, [data.holidayDate]);
		return toView(row);
	});

export const editHoliday = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(updateHolidayInput)
	.handler(async ({ data, context }) => {
		const { id, ...patch } = data;
		const updated = await updateUserHoliday(context.userId, id, patch);
		if (patch.holidayDate) {
			await recomputeDates(context.userId, [patch.holidayDate]);
		}
		return { updated };
	});

export const removeHoliday = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(deleteHolidayInput)
	.handler(async ({ data, context }) => {
		// Read the row first so the date is known for the recompute; scoping by
		// owner means another account's holiday is simply not found.
		const target = await findUserHolidayById(context.userId, data.id);
		const deleted = await deleteUserHoliday(context.userId, data.id);
		if (deleted && target) {
			await recomputeDates(context.userId, [target.holidayDate]);
		}
		return { deleted };
	});
