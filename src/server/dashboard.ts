import { createServerFn } from "@tanstack/react-start";
import { authedMiddleware } from "./auth.ts";
import { buildDashboard } from "./core/dashboard.ts";

/**
 * Dashboard server function.
 *
 * Definition only — see the note in `./dtr.ts` for why `buildDashboard` lives
 * in `./core/dashboard.ts` rather than here.
 */

export type {
	DashboardData,
	MonthMoneyPoint,
	PeriodPoint,
	WeekPoint,
} from "./core/dashboard.ts";

export const getDashboard = createServerFn({ method: "GET" })
	.middleware([authedMiddleware])
	.handler(({ context }) => buildDashboard(context.userId));
