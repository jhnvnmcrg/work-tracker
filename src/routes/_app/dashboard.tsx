import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "#/components/layout/coming-soon.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";

export const Route = createFileRoute("/_app/dashboard")({
	component: DashboardPage,
});

function DashboardPage() {
	return (
		<>
			<PageHeader
				title="Dashboard"
				description="Hours, punctuality, overtime and year-to-date earnings."
			/>
			<ComingSoon feature="Dashboard & analytics" phase="Phase 6">
				KPI tiles, hours-per-week and punctuality charts, overtime trend,
				year-to-date earnings vs deductions, and a “needs attention” list that
				flags blank workdays before payroll closes.
			</ComingSoon>
		</>
	);
}
