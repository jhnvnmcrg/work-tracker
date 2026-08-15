import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Deliberately separate from vite.config.ts.
 *
 * The app config loads the React compiler plugin and the Neon Launchpad plugin,
 * which claims a database on startup. Neither is wanted here: the payroll engine
 * is pure and must be testable without a database or a browser environment.
 * Vitest prefers this file over vite.config.ts when it exists.
 */
export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^#\//,
				replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/`,
			},
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		clearMocks: true,
	},
});
