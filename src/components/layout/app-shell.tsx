import type { ReactNode } from "react";
import { AppSidebar } from "#/components/layout/app-sidebar.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import {
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "#/components/ui/sidebar.tsx";
import HeaderUser from "#/integrations/clerk/header-user.tsx";

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<SidebarProvider>
			<AppSidebar />
			<SidebarInset>
				<header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
					<SidebarTrigger className="-ml-1" />
					<Separator orientation="vertical" className="mr-2 h-4" />
					<div className="flex-1" />
					<HeaderUser />
				</header>
				<main className="flex-1 p-4 md:p-6">{children}</main>
			</SidebarInset>
		</SidebarProvider>
	);
}
