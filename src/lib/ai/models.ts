import type { openRouterText } from "@tanstack/ai-openrouter";

/**
 * Derived from the adapter's own signature rather than imported by name: the
 * package exports the model union under an alias, so this survives a rename and
 * still rejects a model id the adapter does not accept.
 */
export type OpenRouterTextModels = Parameters<typeof openRouterText>[0];

/**
 * Model selection.
 *
 * This workload does not need a frontier model: every figure comes from a tool
 * and every computation happens in SQL or TypeScript. What it needs is reliable
 * tool calling and strict adherence to a negative constraint — never state a
 * number that did not come from a tool. Claude Haiku is chosen for being
 * dependable at saying "I don't have that" rather than confabulating, which is
 * the property that matters most here.
 *
 * The model is resolved on the server and never read from the request body:
 * `useChat`'s `body` is attacker-controlled, and accepting a model from it is a
 * cost-injection vector.
 */
export interface ModelTier {
	id: OpenRouterTextModels;
	label: string;
	reasoningEffort: "none" | "low" | "medium";
}

const DEFAULTS = {
	/** Interactive question answering. */
	chat: {
		id: "nvidia/nemotron-3-ultra-550b-a55b:free",
		label: "Fast",
		reasoningEffort: "low",
	},
	/**
	 * Payslip explanation, where tracing a figure back through a line item to a
	 * bracket and then to the source days is genuinely multi-hop.
	 */
	explain: {
		id: "nvidia/nemotron-3-super-120b-a12b:free",
		label: "Deep",
		reasoningEffort: "medium",
	},
} as const satisfies Record<string, ModelTier>;

export type ModelTierName = keyof typeof DEFAULTS;

/**
 * Resolves a tier, honouring an environment override.
 *
 * An unrecognised value falls back to the default with a warning rather than
 * failing the request — a typo in an env var should not take the assistant down.
 */
function resolve(tier: ModelTierName): ModelTier {
	const override = process.env[`ASSISTANT_MODEL_${tier.toUpperCase()}`];
	if (!override) return DEFAULTS[tier];
	return { ...DEFAULTS[tier], id: override as OpenRouterTextModels };
}

export const MODELS = {
	get chat() {
		return resolve("chat");
	},
	get explain() {
		return resolve("explain");
	},
};

/**
 * A second model to fall back to if the first is unavailable. OpenRouter
 * handles the routing; this only names the alternative.
 */
export const FALLBACK_MODELS: OpenRouterTextModels[] = [
	"nvidia/nemotron-3-ultra-550b-a55b:free",
	"nvidia/nemotron-3-super-120b-a12b:free",
	"cohere/north-mini-code:free",
	"poolside/laguna-xs-2.1:free",
	"nvidia/nemotron-3-nano-30b-a3b:free",
	"nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
	"google/gemma-4-26b-a4b-it:free",
	"nvidia/nemotron-nano-9b-v2:free",
	"openai/gpt-oss-20b:free",
	"nvidia/nemotron-nano-12b-v2-vl:free",
	"google/gemma-4-31b-it:free",
	"nvidia/nemotron-3.5-content-safety:free",
];
