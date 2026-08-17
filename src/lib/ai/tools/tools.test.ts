import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ASSISTANT_TOOL_NAMES, assistantTools } from "./index.ts";

/**
 * The load-bearing guarantee of the assistant, asserted mechanically.
 *
 * If no tool input schema can express "whose data", the model cannot request
 * another user's records — not because it was told not to, but because it has no
 * vocabulary for it. Identity arrives separately through `chat({ context })`,
 * sourced from the Clerk session.
 *
 * This test exists so that adding a `userId` parameter to a tool in six months
 * fails the build rather than quietly opening a hole.
 */

const IDENTIFIER_PATTERN =
	/user|employee|account|owner|person|staff|member|email/i;

function propertyNames(schema: unknown): string[] {
	const json = z.toJSONSchema(schema as z.ZodType, { io: "input" }) as {
		properties?: Record<string, unknown>;
	};
	const names: string[] = [];
	const walk = (node: unknown) => {
		if (typeof node !== "object" || node === null) return;
		const record = node as Record<string, unknown>;
		if (record.properties && typeof record.properties === "object") {
			for (const [key, value] of Object.entries(
				record.properties as Record<string, unknown>,
			)) {
				names.push(key);
				walk(value);
			}
		}
		if (record.items) walk(record.items);
		for (const key of ["anyOf", "oneOf", "allOf"]) {
			const branch = record[key];
			if (Array.isArray(branch)) for (const item of branch) walk(item);
		}
	};
	walk(json);
	return names;
}

describe("assistant tool contract", () => {
	it("exposes the expected tools", () => {
		expect(assistantTools.length).toBeGreaterThan(0);
		expect(ASSISTANT_TOOL_NAMES).toEqual(
			expect.arrayContaining([
				"get_current_context",
				"get_period_summary",
				"list_time_records",
				"get_payslip",
				"get_anomalies",
			]),
		);
	});

	it.each(
		assistantTools.map((tool) => [tool.name, tool] as const),
	)("%s takes no argument that could identify a user", (name, tool) => {
		const names = propertyNames(tool.inputSchema);
		for (const property of names) {
			expect(
				IDENTIFIER_PATTERN.test(property),
				`${name} exposes an identity-shaped input "${property}"`,
			).toBe(false);
		}
	});

	it("gives every tool a description the model can route on", () => {
		for (const tool of assistantTools) {
			expect(tool.description, tool.name).toBeTruthy();
			expect(tool.description.length, tool.name).toBeGreaterThan(40);
		}
	});

	it("uses unique, snake_case tool names", () => {
		expect(new Set(ASSISTANT_TOOL_NAMES).size).toBe(
			ASSISTANT_TOOL_NAMES.length,
		);
		for (const name of ASSISTANT_TOOL_NAMES) {
			expect(name, name).toMatch(/^[a-z][a-z0-9_]*$/);
		}
	});

	it("declares an output schema for every tool", () => {
		for (const tool of assistantTools) {
			expect(tool.outputSchema, tool.name).toBeDefined();
		}
	});
});
