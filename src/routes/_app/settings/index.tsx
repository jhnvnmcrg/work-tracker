import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "#/components/layout/coming-soon.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";

export const Route = createFileRoute("/_app/settings/")({
	component: SettingsPage,
});

function SettingsPage() {
	return (
		<>
			<PageHeader
				title="Settings"
				description="Employment terms, work schedule, and pay rates."
			/>
			<ComingSoon feature="Employment settings" phase="Phase 2">
				Monthly rate, the 313-day working-days factor with a live preview of the
				derived daily and hourly rates, work schedule per weekday, and the
				cutoff each statutory contribution is withheld on.
			</ComingSoon>
		</>
	);
}
