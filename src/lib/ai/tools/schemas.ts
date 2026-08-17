import { z } from "zod";

/**
 * Shared input shapes for assistant tools.
 *
 * A hard rule holds across every schema in this directory: **no field may
 * identify a user.** The model is given no vocabulary to express "whose data",
 * so it cannot ask for someone else's even if instructed to. Identity arrives
 * separately, from the Clerk session, through `chat({ context })`.
 * `tools.test.ts` asserts this mechanically.
 */

export const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/)
	.meta({ description: "A date in Asia/Manila, formatted YYYY-MM-DD." });

export const payPeriodRef = z
	.object({
		year: z.int().min(2000).max(2100).meta({ description: "Calendar year." }),
		month: z.int().min(1).max(12).meta({ description: "Month, 1 to 12." }),
		half: z.union([z.literal(1), z.literal(2)]).meta({
			description:
				"Which cutoff. 1 is the 1st to the 16th. 2 is the 17th to the last day of the month, which is the 28th, 29th, 30th or 31st depending on the month.",
		}),
	})
	.meta({
		description:
			"A semi-monthly pay period. Never work out these dates yourself — pass the year, month and half, and the tool returns the resolved range.",
	});

export const dateRange = z
	.object({ from: isoDate, to: isoDate })
	.meta({ description: "An inclusive date range, at most 62 days." });

/** Cap on rows any tool will return, so the model cannot exhaust the context. */
export const MAX_ROWS = 62;
