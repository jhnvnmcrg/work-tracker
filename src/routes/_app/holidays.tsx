import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "#/components/layout/coming-soon.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";

export const Route = createFileRoute("/_app/holidays")({
	component: HolidaysPage,
});

function HolidaysPage() {
	return (
		<>
			<PageHeader
				title="Holidays"
				description="Regular holidays and special non-working days."
			/>
			<ComingSoon feature="Holiday calendar" phase="Phase 4">
				Seeded Philippine holidays per year plus your own additions, shown as
				banner rows in the DTR grid so a holiday is never mistaken for an
				absence.
			</ComingSoon>
		</>
	);
}
