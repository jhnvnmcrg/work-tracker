import { createServerFn } from "@tanstack/react-start";
import { authedMiddleware } from "./auth.ts";

/**
 * The only supported way to create a server function in this codebase.
 *
 * Every handler built from this receives `context.userId` resolved from the
 * Clerk session, so a query or mutation cannot accidentally be written without
 * an owner. A Biome rule (`style/noRestrictedImports`) blocks importing
 * `createServerFn` anywhere except this file and `src/server/auth.ts`, which
 * turns the convention into a build failure rather than a review habit.
 *
 * @example
 * export const getThing = protectedFn({ method: "GET" })
 *   .validator(z.object({ id: z.number() }))
 *   .handler(async ({ data, context }) => findThing(context.userId, data.id));
 */
export const protectedFn = (opts?: { method?: "GET" | "POST" }) =>
	createServerFn({ method: opts?.method ?? "POST" }).middleware([
		authedMiddleware,
	]);
