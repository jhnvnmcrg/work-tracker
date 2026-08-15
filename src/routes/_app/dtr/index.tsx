import { createFileRoute, redirect } from "@tanstack/react-router";
import { monthKeyOf, todayInManila } from "#/lib/payroll/time.ts";

/** `/dtr` always lands on the current Manila month. */
export const Route = createFileRoute("/_app/dtr/")({
	beforeLoad: () => {
		throw redirect({
			to: "/dtr/$month",
			params: { month: monthKeyOf(todayInManila()) },
		});
	},
});
