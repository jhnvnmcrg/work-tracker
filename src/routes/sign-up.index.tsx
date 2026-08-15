import { createFileRoute } from "@tanstack/react-router";
import { SignUpPanel } from "#/components/auth/auth-panel.tsx";

export const Route = createFileRoute("/sign-up/")({
	component: SignUpPanel,
});
