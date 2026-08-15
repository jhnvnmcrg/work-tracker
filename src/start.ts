import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

// The scaffold validated only `serverFn`, leaving server routes — including the
// AI streaming endpoint, which spends money and reads payroll data — unguarded.
// Server routes share handlerType 'router' with document navigations, so the
// method is the discriminator: navigations are GET/HEAD and must pass through
// (a cross-site link or address-bar visit sends Sec-Fetch-Site cross-site/none
// and would otherwise 403), while mutating API calls get validated.
const csrfMiddleware = createCsrfMiddleware({
	filter: (context) =>
		context.handlerType === "serverFn" ||
		(context.request.method !== "GET" && context.request.method !== "HEAD"),
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, clerkMiddleware()],
}));
