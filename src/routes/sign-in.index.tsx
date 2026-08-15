import { createFileRoute } from "@tanstack/react-router";
import { SignInPanel } from "#/components/auth/auth-panel.tsx";

export const Route = createFileRoute("/sign-in/")({
	component: SignInPanel,
});
