import { createFileRoute } from "@tanstack/react-router";
import { AssistantChat } from "#/components/assistant/assistant-chat.tsx";
import { PageHeader } from "#/components/layout/page-header.tsx";

export const Route = createFileRoute("/_app/assistant")({
	// No loader: the conversation streams client-side.
	component: AssistantPage,
});

function AssistantPage() {
	return (
		<>
			<PageHeader
				title="Assistant"
				description="Ask about your own hours, payslips and leave."
			/>
			<AssistantChat />
		</>
	);
}
