import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the two rules that keep server code off the client and every server
 * function authenticated.
 *
 * These were previously enforced by a `protectedFn()` wrapper. That helper hid
 * `createServerFn` from the Vite plugin's AST matcher, so handler bodies were
 * never extracted and the whole server import graph shipped to the browser —
 * breaking hydration on every page. The wrapper is gone; these assertions
 * replace the guarantee it was supposed to give.
 */

const SERVER_DIR = join(process.cwd(), "src", "server");

const moduleFiles = readdirSync(SERVER_DIR)
	.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
	.filter((name) => name !== "fn.ts" && name !== "auth.ts");

const read = (name: string) => readFileSync(join(SERVER_DIR, name), "utf8");

describe("server function modules", () => {
	it.each(
		moduleFiles,
	)("%s calls createServerFn directly so the plugin can extract the handler", (name) => {
		const source = read(name);
		// A wrapper defeats the AST match and ships the handler to the browser.
		expect(source).not.toMatch(/\bprotectedFn\s*\(/);
	});

	it.each(moduleFiles)("%s authenticates every server function", (name) => {
		const source = read(name);
		const definitions = source.match(/createServerFn\s*\([^)]*\)/g) ?? [];
		for (const _ of definitions) {
			// Each createServerFn must be followed by the auth middleware.
			const withoutMiddleware = source.match(
				/createServerFn\s*\([^)]*\)\s*(?!\s*\.middleware\(\[authedMiddleware\]\))\s*\.(validator|handler)/g,
			);
			expect(
				withoutMiddleware,
				`${name} has a server function without .middleware([authedMiddleware])`,
			).toBeNull();
		}
		if (definitions.length > 0) {
			expect(source).toContain("authedMiddleware");
		}
	});

	it.each(
		moduleFiles,
	)("%s keeps its implementation out of the client graph", (name) => {
		const source = read(name);
		// Anything exported that is not a server function or a type keeps the
		// module's imports alive after the handler bodies are stripped.
		const plainExports =
			source.match(/^export\s+(async\s+)?function\s+\w+/gm) ?? [];
		expect(
			plainExports,
			`${name} exports a plain function; move it to src/server/core/ or the repo layer`,
		).toEqual([]);
	});

	it.each(moduleFiles)("%s does not import the database directly", (name) => {
		const source = read(name);
		expect(
			/from "#\/db\/(index|schema)/.test(source),
			`${name} imports the db layer; go through src/db/repo/ instead`,
		).toBe(false);
	});
});
