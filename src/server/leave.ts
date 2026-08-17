import { createServerFn } from "@tanstack/react-start";
import {
	cancelLeaveInput,
	fileLeaveInput,
	grantCreditsInput,
	leaveYearInput,
} from "#/schemas/leave.ts";
import { authedMiddleware } from "./auth.ts";
import {
	buildLeaveOverview,
	cancelLeaveFor,
	fileLeaveFor,
	grantCreditsFor,
} from "./core/leave.ts";

/**
 * Leave server functions.
 *
 * Definitions only — see the note in `./dtr.ts` for why the implementation sits
 * in `./core/leave.ts` rather than here.
 */

export type {
	FileLeaveResult,
	LeaveBalanceView,
	LeaveOverview,
	LeaveRequestView,
} from "./core/leave.ts";

export const getLeaveOverview = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.validator(leaveYearInput)
	.handler(({ data, context }) =>
		buildLeaveOverview(context.userId, data.year),
	);

export const fileLeave = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(fileLeaveInput)
	.handler(({ data, context }) => fileLeaveFor(context.userId, data));

export const cancelLeave = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(cancelLeaveInput)
	.handler(({ data, context }) =>
		cancelLeaveFor(context.userId, data.requestId),
	);

export const grantLeaveCredits = createServerFn({ method: "POST" })
	.middleware([authedMiddleware])
	.validator(grantCreditsInput)
	.handler(({ data, context }) => grantCreditsFor(context.userId, data));
