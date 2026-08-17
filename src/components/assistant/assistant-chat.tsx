import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { Check, Loader2, SendHorizontal, Sparkles, Square } from "lucide-react";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/ui/collapsible.tsx";
import { Input } from "#/components/ui/input.tsx";
import { cn } from "#/lib/utils.ts";

/** Human phrasing for a tool call, so the trace reads as an action. */
const TOOL_LABELS: Record<string, string> = {
	get_current_context: "Checked today's date and pay period",
	get_period_summary: "Read attendance totals for a pay period",
	compare_periods: "Compared two pay periods",
	list_time_records: "Read individual time records",
	get_payslip: "Read a payslip and its line items",
	get_leave_and_holidays: "Read leave balances and holidays",
	get_anomalies: "Checked for problems in the time record",
};

const SUGGESTIONS = [
	"How many hours did I work this cutoff?",
	"Was I late more this cutoff than last?",
	"Are there any gaps in my time record?",
	"Explain the deductions on my latest payslip.",
];

interface MessagePart {
	type: string;
	content?: string;
	id?: string;
	name?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
}

export function AssistantChat() {
	const [draft, setDraft] = useState("");
	const { messages, sendMessage, isLoading, error, stop } = useChat({
		connection: fetchServerSentEvents("/api/assistant/chat"),
	});

	const submit = (text: string) => {
		const trimmed = text.trim();
		if (trimmed === "" || isLoading) return;
		setDraft("");
		void sendMessage(trimmed);
	};

	return (
		<div className="flex h-[calc(100svh-12rem)] flex-col">
			<div className="flex-1 space-y-4 overflow-y-auto pr-1">
				{messages.length === 0 ? (
					<div className="rounded-xl border bg-card p-6">
						<Sparkles className="size-5 text-primary" />
						<h2 className="mt-3 font-serif text-lg font-semibold">
							Ask about your own records
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Every figure comes from your time records and payslips by way of a
							lookup — never an estimate. The assistant is read-only and cannot
							change a punch, a payslip or a setting.
						</p>
						<div className="mt-4 flex flex-wrap gap-2">
							{SUGGESTIONS.map((suggestion) => (
								<Button
									key={suggestion}
									variant="outline"
									size="sm"
									onClick={() => submit(suggestion)}
								>
									{suggestion}
								</Button>
							))}
						</div>
					</div>
				) : null}

				{messages.map((message) => {
					const parts = (message.parts ?? []) as MessagePart[];
					const toolCalls = parts.filter((part) => part.type === "tool-call");

					return (
						<div
							key={message.id}
							className={cn(
								"rounded-xl border p-4",
								message.role === "user"
									? "ml-auto max-w-[85%] bg-muted/50"
									: "bg-card",
							)}
						>
							{/* Shown by default, not hidden behind a debug flag: for a
							    payroll assistant, seeing which records were read is what
							    makes the answer checkable. */}
							{toolCalls.length > 0 ? (
								<div className="mb-3 grid gap-1">
									{toolCalls.map((part) => (
										<Collapsible key={part.id ?? part.name}>
											<CollapsibleTrigger className="flex w-full items-center gap-2 text-left text-xs text-muted-foreground hover:text-foreground">
												{part.state === "complete" ? (
													<Check className="size-3 shrink-0 text-primary" />
												) : (
													<Loader2 className="size-3 shrink-0 animate-spin" />
												)}
												{TOOL_LABELS[part.name ?? ""] ?? part.name}
											</CollapsibleTrigger>
											<CollapsibleContent>
												<pre className="mt-1 max-h-56 overflow-auto rounded-md bg-muted/60 p-2 text-[11px] leading-snug">
													{JSON.stringify(
														{ input: part.input, output: part.output },
														null,
														2,
													)}
												</pre>
											</CollapsibleContent>
										</Collapsible>
									))}
								</div>
							) : null}

							{parts
								.filter((part) => part.type === "text" && part.content)
								.map((part, index) => (
									<div
										// biome-ignore lint/suspicious/noArrayIndexKey: text parts are positional within a message
										key={index}
										className="prose prose-sm dark:prose-invert max-w-none"
									>
										<Streamdown>{part.content ?? ""}</Streamdown>
									</div>
								))}

							{toolCalls.length > 0 && message.role === "assistant" ? (
								<p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
									Based on:{" "}
									{[
										...new Set(
											toolCalls.map(
												(part) => TOOL_LABELS[part.name ?? ""] ?? part.name,
											),
										),
									].join(" · ")}
								</p>
							) : null}
						</div>
					);
				})}

				{error ? (
					<div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 text-sm">
						Something went wrong reaching the assistant. Your records are
						unaffected — try again.
					</div>
				) : null}
			</div>

			<form
				className="mt-4 flex items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					submit(draft);
				}}
			>
				<Input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Ask about your hours, leave or payslips…"
					aria-label="Message the assistant"
					disabled={isLoading}
				/>
				{isLoading ? (
					<Button type="button" variant="outline" onClick={() => stop()}>
						<Square className="size-4" />
						Stop
					</Button>
				) : (
					<Button type="submit" disabled={draft.trim() === ""}>
						<SendHorizontal className="size-4" />
						Send
					</Button>
				)}
			</form>

			<p className="mt-2 text-center text-xs text-muted-foreground">
				<Badge variant="outline" className="mr-1 font-normal">
					Read-only
				</Badge>
				The assistant can read your records but cannot change them.
			</p>
		</div>
	);
}
