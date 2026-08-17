/**
 * Why there is no `protectedFn()` helper any more.
 *
 * There used to be one:
 *
 *   export const protectedFn = (opts) =>
 *     createServerFn(opts).middleware([authedMiddleware]);
 *
 * It read well and made the auth middleware hard to forget. It also silently
 * broke the build in a way nothing caught for six phases.
 *
 * The TanStack Start Vite plugin finds server functions by matching
 * `createServerFn(...).handler(...)` in the AST and replacing the handler with a
 * client RPC stub. It cannot see through a wrapper: `protectedFn(...).handler(...)`
 * is just an unknown call, so the handler body was left intact and shipped to the
 * browser — along with every module it touched. That meant the repo layer,
 * drizzle and `pg` all reached the client, where `pg` reaches for Node's `events`,
 * Vite stubs it, and the exception takes hydration down. Every page rendered from
 * SSR and then sat there completely unclickable.
 *
 * So server functions now call `createServerFn` directly and attach the
 * middleware at the call site:
 *
 *   export const getThing = createServerFn({ method: "GET" })
 *     .middleware([authedMiddleware])
 *     .validator(schema)
 *     .handler(({ data, context }) => getThingFor(context.userId, data.id));
 *
 * `server-functions.test.ts` enforces that every one of them attaches
 * `authedMiddleware`, which is the guarantee the helper was there to provide.
 */

export { authedMiddleware } from "./auth.ts";
