import { createServerFn } from "@tanstack/react-start";
import {
	applyScheduleInput,
	clearDayInput,
	dayInputSchema,
	getDtrMonthInput,
	upsertDtrDaysInput,
} from "#/schemas/dtr.ts";
import { authedMiddleware } from "./auth.ts";
import {
	applyDefaultScheduleFor,
	clearDay,
	getDtrMonthFor,
	saveDays,
} from "./core/dtr.ts";

/**
 * DTR server functions.
 *
 * This module contains nothing but `protectedFn` definitions and type
 * re-exports. Client route files import it so the functions can be called, and
 * the TanStack Start plugin swaps each handler for a client RPC stub — but only
 * if there is nothing else here to keep alive. An ordinary exported function
 * would hold the module's imports open and drag the repo layer, drizzle and pg
 * into the browser bundle, where `pg` reaches for Node's `events` and takes
 * hydration down with it. The implementation lives in `./core/dtr.ts`.
 */

export type {
	DtrDayView,
	DtrMonthBundle,
	DtrTotals,
	SaveResult,
} from "./core/dtr.ts";

/** One round trip for a whole month: records, schedule, holidays, leave, totals. */
export const getDtrMonth = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.validator(getDtrMonthInput)
	.handler(({ data, context }) => getDtrMonthFor(context.userId, data.month));

export const upsertDtrDay = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(dayInputSchema)
	.handler(({ data, context }) => saveDays(context.userId, [data]));

/** Bulk path for fill-down and paste: one request, one transaction. */
export const upsertDtrDays = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(upsertDtrDaysInput)
	.handler(({ data, context }) => saveDays(context.userId, data.days));

export const clearDtrDay = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(clearDayInput)
	.handler(({ data, context }) => clearDay(context.userId, data.workDate));

export const applyDefaultSchedule = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(applyScheduleInput)
	.handler(({ data, context }) =>
		applyDefaultScheduleFor(context.userId, {
			month: data.month,
			half: data.half,
			onlyBlank: data.onlyBlank,
		}),
	);
