import { z } from "zod";
import {
	ATTENDANCE_STATUSES,
	DAY_KINDS,
	MINUTES_PER_DAY,
} from "#/schemas/_re-exports.ts";

/**
 * Dates cross the wire as "YYYY-MM-DD" strings, never as `Date`.
 *
 * The moment a JS `Date` touches a business date, a server running in UTC
 * renders "2026-08-01" as 31 July. Keeping them as strings end to end removes
 * the failure mode entirely.
 */
export const dateKeySchema = z
	.string()
	.regex(
		/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
		"Expected YYYY-MM-DD",
	);

export const monthKeySchema = z
	.string()
	.regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM");

export const periodKeySchema = z
	.string()
	.regex(/^\d{4}-(0[1-9]|1[0-2])-[12]$/, "Expected YYYY-MM-H");

/**
 * Minutes since local midnight of the work date.
 *
 * The upper bound is two days rather than one so a shift clocking out after
 * midnight stays anchored to the date it began.
 */
export const punchSchema = z
	.number()
	.int()
	.min(0)
	.max(2 * MINUTES_PER_DAY)
	.nullable();

export const dayKindSchema = z.enum(DAY_KINDS);
export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const dayInputSchema = z.object({
	workDate: dateKeySchema,
	amIn: punchSchema.default(null),
	amOut: punchSchema.default(null),
	pmIn: punchSchema.default(null),
	pmOut: punchSchema.default(null),
	status: attendanceStatusSchema.default("present"),
	remarks: z.string().max(280).nullable().default(null),
	approvedOvertimeMinutes: z
		.number()
		.int()
		.min(0)
		.max(720)
		.nullable()
		.default(null),
});

export type DayInput = z.infer<typeof dayInputSchema>;

export const getDtrMonthInput = z.object({ month: monthKeySchema });

export const upsertDtrDaysInput = z.object({
	days: z.array(dayInputSchema).min(1).max(31),
});

export const applyScheduleInput = z.object({
	month: monthKeySchema,
	half: z.enum(["1", "2", "all"]).default("all"),
	/** Only fill days that have no punches yet — never overwrite real entries. */
	onlyBlank: z.boolean().default(true),
});

export const clearDayInput = z.object({ workDate: dateKeySchema });
