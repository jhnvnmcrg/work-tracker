import { auth } from "@clerk/tanstack-react-start/server";
import { redirect } from "@tanstack/react-router";
import { createMiddleware, createServerFn } from "@tanstack/react-start";

/**
 * Route-level guard for `beforeLoad`. Throws a redirect for signed-out users,
 * and returns the Clerk user id into route context for rendering and cache keys.
 *
 * The returned `userId` reaches the client. Never pass it back to a server
 * function as an argument — server-side identity always comes from
 * {@link authedMiddleware}.
 */
export const authGuard = createServerFn({ method: "GET" }).handler(async () => {
	const { isAuthenticated, userId } = await auth();
	if (!isAuthenticated || !userId) {
		throw redirect({ to: "/sign-in" });
	}
	return { userId };
});

/**
 * Non-throwing session probe for public routes, so the landing page can send a
 * signed-in visitor straight to their records.
 */
export const getOptionalUserId = createServerFn({ method: "GET" }).handler(
	async () => {
		const { isAuthenticated, userId } = await auth();
		return { userId: isAuthenticated && userId ? userId : null };
	},
);

/**
 * Server-function middleware resolving the Clerk session and injecting `userId`
 * into handler context.
 *
 * This is the only trusted source of user identity for data access.
 */
export const authedMiddleware = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		const { isAuthenticated, userId } = await auth();
		if (!isAuthenticated || !userId) {
			throw new Error("UNAUTHORIZED");
		}
		return next({ context: { userId } });
	},
);
