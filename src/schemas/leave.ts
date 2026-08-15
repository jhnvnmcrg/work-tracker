import { z } from "zod";
import { dateKeySchema } from "./dtr.ts";

export const fileLeaveInput = z
	.object({
		leaveTypeId: z.number().int().positive(),
		startDate: dateKeySchema,
		endDate: dateKeySchema,
		/** Leave begins at midday on the first working day of the range. */
		halfDayStart: z.boolean().default(false),
		/** Leave ends at midday on the last working day of the range. */
		halfDayEnd: z.boolean().default(false),
		reason: z.string().max(500).nullable().default(null),
	})
	.refine((value) => value.endDate >= value.startDate, {
		message: "The end date cannot be before the start date",
		path: ["endDate"],
	});

export const cancelLeaveInput = z.object({
	requestId: z.number().int().positive(),
});

export const grantCreditsInput = z.object({
	leaveTypeId: z.number().int().positive(),
	creditYear: z.number().int().min(2000).max(2100),
	/** Days rather than minutes — leave credits are spoken of in days. */
	days: z.number().min(-365).max(365),
	note: z.string().max(200).nullable().default(null),
});

export const leaveYearInput = z.object({
	year: z.number().int().min(2000).max(2100),
});
