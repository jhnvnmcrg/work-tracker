import { auth } from "@clerk/tanstack-react-start/server";
import {
	chat,
	chatParamsFromRequest,
	maxIterations,
	toServerSentEventsResponse,
} from "@tanstack/ai";
import { openRouterText } from "@tanstack/ai-openrouter";
import { createFileRoute } from "@tanstack/react-router";
import { resolveAssistantContext } from "#/lib/ai/context.ts";
import { MODELS } from "#/lib/ai/models.ts";
import { buildSystemPrompts } from "#/lib/ai/system-prompt.ts";
import { assistantTools } from "#/lib/ai/tools/index.ts";

/**
 * Streaming endpoint for the assistant.
 *
 * A server route rather than a server function: `useChat` connects with
 * `fetchServerSentEvents(url)`, which wants a plain URL emitting SSE, whereas a
 * server function is seroval-encoded RPC that would have to be fought to stream.
 *
 * Note the CSRF middleware in `src/start.ts` validates every non-GET request,
 * so this POST is covered — an unauthenticated or cross-site call to an endpoint
 * that spends money and reads payroll data would be a genuine incident.
 */

/** Keeps a long conversation from ballooning the prompt. */
const MAX_TURNS = 12;

type ChatMessage = Awaited<
	ReturnType<typeof chatParamsFromRequest>
>["messages"][number];

/**
 * Trims history before it reaches the model.
 *
 * Every turn resends the whole transcript including prior tool results, so a
 * long thread grows from a few thousand tokens to tens of thousands. Older tool
 * results are dropped while their text is kept: the conversation stays coherent
 * and the figures are re-fetched if they are needed again, which is also safer
 * than letting the model quote a stale total.
 */
interface WithParts {
	parts: Array<{ type: string }>;
}

/** A message carries `parts` only in the UI shape, not the model shape. */
function hasParts(message: unknown): message is WithParts {
	return (
		typeof message === "object" &&
		message !== null &&
		Array.isArray((message as WithParts).parts)
	);
}

function trimHistory(messages: ChatMessage[]): ChatMessage[] {
	const recent = messages.slice(-MAX_TURNS);
	const lastIndex = recent.length - 1;

	return recent.map((message, index) => {
		if (index === lastIndex || !hasParts(message)) return message;
		const parts = message.parts.filter(
			(part) => part.type !== "tool-result" && part.type !== "tool-call",
		);
		return parts.length === message.parts.length
			? message
			: ({ ...message, parts } as ChatMessage);
	});
}

export const Route = createFileRoute("/api/assistant/chat")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				// Identity comes from the Clerk session, never from the request body.
				const { isAuthenticated, userId } = await auth();
				if (!isAuthenticated || !userId) {
					return new Response("Unauthorized", { status: 401 });
				}

				const params = await chatParamsFromRequest(request);
				const context = await resolveAssistantContext(userId);

				const abortController = new AbortController();
				request.signal.addEventListener("abort", () => abortController.abort());

				const stream = chat({
					adapter: openRouterText(MODELS.chat.id),
					messages: trimHistory(params.messages as ChatMessage[]),
					systemPrompts: buildSystemPrompts(context),
					tools: assistantTools,
					// Required by the type checker because every tool declares it needs
					// an AssistantContext. Deleting this line fails the build, which is
					// what makes user scoping structural rather than remembered.
					context,
					agentLoopStrategy: maxIterations(8),
					modelOptions: {
						// Zero temperature: this is lookup and narration, not writing.
						temperature: 0,
						parallelToolCalls: true,
					},
					threadId: params.threadId,
					abortController,
				});

				return toServerSentEventsResponse(stream, { abortController });
			},
		},
	},
});
