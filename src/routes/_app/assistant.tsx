import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "#/components/layout/coming-soon.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";

export const Route = createFileRoute("/_app/assistant")({
	component: AssistantPage,
});

function AssistantPage() {
	return (
		<>
			<PageHeader
				title="Assistant"
				description="Ask about your own hours, payslips, and leave."
			/>
			<ComingSoon feature="AI assistant" phase="Phase 7">
				Answers grounded in your records via tool calls — never an invented
				figure — plus payslip explanations and flagged gaps in your time
				records. Read-only: it cannot change a punch or a payslip.
			</ComingSoon>
		</>
	);
}
