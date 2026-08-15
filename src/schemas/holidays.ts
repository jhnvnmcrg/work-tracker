import { z } from "zod";
import { dateKeySchema } from "./dtr.ts";

export const holidayKindSchema = z.enum([
	"regular",
	"special_non_working",
	"special_working",
]);

export const holidayYearInput = z.object({
	year: z.number().int().min(2000).max(2100),
});

export const createHolidayInput = z.object({
	holidayDate: dateKeySchema,
	name: z.string().min(1).max(120),
	kind: holidayKindSchema,
	notes: z.string().max(280).nullable().default(null),
});

export const updateHolidayInput = createHolidayInput.partial().extend({
	id: z.number().int().positive(),
});

export const deleteHolidayInput = z.object({
	id: z.number().int().positive(),
});

export const seedHolidaysInput = z.object({
	year: z.number().int().min(2000).max(2100),
});
