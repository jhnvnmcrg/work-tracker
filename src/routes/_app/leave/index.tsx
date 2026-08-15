import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "#/components/layout/coming-soon.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";

export const Route = createFileRoute("/_app/leave/")({
	component: LeavePage,
});

function LeavePage() {
	return (
		<>
			<PageHeader
				title="Leave"
				description="Credits, filed leave, and the running balance ledger."
			/>
			<ComingSoon feature="Leave tracking" phase="Phase 4">
				Balances computed from an append-only ledger, half-day support, and
				filing across a date range that skips rest days and holidays.
			</ComingSoon>
		</>
	);
}
