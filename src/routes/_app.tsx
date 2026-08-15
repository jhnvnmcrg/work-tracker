import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "#/components/layout/app-shell.tsx";
import { authGuard } from "#/server/auth.ts";

/**
 * Pathless layout guarding every signed-in route. Children under `_app/`
 * inherit the check automatically, so a new page cannot be shipped unprotected
 * by forgetting a guard.
 */
export const Route = createFileRoute("/_app")({
	beforeLoad: async () => await authGuard(),
	component: AppLayout,
});

function AppLayout() {
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}
